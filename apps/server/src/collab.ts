import { blocksToYXmlFragment, yXmlFragmentToBlocks } from '@blocknote/core/yjs'
/**
 * Live co-editing: several people in one page at once (feature: collab.live).
 *
 * Browsers edit a shared Yjs document over a WebSocket (Hocuspocus protocol)
 * instead of autosaving whole pages. The page's saved content stays the
 * source of truth for everything else — tasks, tags, links, search, publish,
 * export — so this module keeps the two in step:
 *
 * - load: a page's live state is restored if it still matches the saved
 *   content; otherwise it is rebuilt from that content;
 * - store: a few seconds after edits settle, the live document is converted
 *   back to blocks, saved like any other edit, and reindexed;
 * - outside writes (ticking a task from the agenda, the API, a merge, a
 *   template) are pushed into the open document, so nobody keeps editing a
 *   stale copy.
 *
 * Who may join is decided per page with the same rules as everything else:
 * access.ts (viewers join read-only) and password locks.
 */
import { COLLAB_FRAGMENT, headlessEditor } from '@bn/editor'
import { Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
import type { AccessService } from './access'
import { reconcileLinks } from './links'
import type { LockService } from './locks'
import type { Repo, UserRow } from './repo'
import { reconcileTags } from './tags'
import { reconcileTasks } from './tasks'

export type CollabContext = { user: UserRow; sessionToken: string | null }

/** Thrown into Hocuspocus to refuse a page; the message reaches the client. */
class Refused extends Error {}

const OUTSIDE = 'outside-write'

export function createCollab(deps: {
  repo: Repo
  access: AccessService
  locks: LockService
  /** is the feature on right now */
  enabled: () => boolean
  now?: () => Date
  log?: { warn: (msg: string) => void; error: (err: unknown, msg?: string) => void }
  /** store delay after the last edit, and the longest it may wait (ms) */
  debounce?: number
  maxDebounce?: number
}) {
  const now = deps.now ?? (() => new Date())
  const editor = headlessEditor()

  function parseBlocks(content: string): any[] {
    try {
      const blocks = JSON.parse(content)
      return Array.isArray(blocks) ? blocks : []
    } catch {
      return []
    }
  }

  /** Put these blocks into a live document's fragment, replacing what's there. */
  function fill(doc: Y.Doc, blocks: any[]) {
    const fragment = doc.getXmlFragment(COLLAB_FRAGMENT)
    if (fragment.length > 0) fragment.delete(0, fragment.length)
    if (blocks.length > 0) blocksToYXmlFragment(editor, blocks, fragment)
  }

  const contentOf = (doc: Y.Doc) =>
    JSON.stringify(yXmlFragmentToBlocks(editor, doc.getXmlFragment(COLLAB_FRAGMENT)))

  const hocuspocus = new Hocuspocus<CollabContext>({
    name: 'beyond-notes',
    quiet: true,
    debounce: deps.debounce ?? 2_000,
    maxDebounce: deps.maxDebounce ?? 10_000,

    /** Every page a connection opens is checked on its own. */
    async onConnect({ context, documentName, connectionConfig }) {
      if (!deps.enabled()) throw new Refused('Live editing is not available here.')
      const page = await deps.repo.getPage(documentName)
      if (!page || page.trashedAt) throw new Refused('Page not found.')
      const space = await deps.repo.getSpace(page.spaceId)
      const role = space ? await deps.access.role(space, context.user) : null
      if (!role) throw new Refused('Page not found.')
      // a locked page stays shut until this session unlocks it
      await deps.locks.assertPageOpen(context.sessionToken, page)
      if (role === 'viewer') connectionConfig.readOnly = true
    },

    async onLoadDocument({ document, documentName }) {
      const saved = await deps.repo.getDocument(documentName)
      if (!saved) throw new Refused('Page not found.')
      const live = await deps.repo.getLiveState(documentName)
      if (live && live.contentAt.getTime() === saved.updatedAt.getTime()) {
        Y.applyUpdate(document, live.state)
      } else {
        // first time live, or something else has written the page since
        document.transact(() => fill(document, parseBlocks(saved.content)), OUTSIDE)
      }
      return document
    },

    async onStoreDocument({ document, documentName }) {
      const page = await deps.repo.getPage(documentName)
      const saved = await deps.repo.getDocument(documentName)
      // gone or trashed while open: nothing to keep
      if (!page || page.trashedAt || !saved) return
      const content = contentOf(document)
      let at = saved.updatedAt
      if (content !== saved.content) {
        at = now()
        await deps.repo.updateDocument(documentName, content, at, 'collab')
        await deps.repo.updatePage(documentName, { updatedAt: at })
        await reconcileTasks(deps.repo, documentName, content, at)
        await reconcileTags(deps.repo, documentName, content)
        await reconcileLinks(deps.repo, documentName, content)
      }
      await deps.repo.putLiveState(documentName, Y.encodeStateAsUpdate(document), at)
    },
  })

  // something other than live editing wrote a page: bring any open copy along
  deps.repo.onDocumentWritten((pageId, content) => {
    const doc = hocuspocus.documents.get(pageId)
    if (!doc) return
    try {
      doc.transact(() => fill(doc, parseBlocks(content)), OUTSIDE)
    } catch (err) {
      deps.log?.error(err, `live copy of ${pageId} could not take an outside change`)
    }
  })

  return {
    hocuspocus,
    /**
     * Hand an authenticated WebSocket (the `ws` library's, as @fastify/websocket
     * gives it) to the collaboration server. Hocuspocus 4 doesn't listen to the
     * socket itself: its integrations pass messages and the close event in.
     */
    connect(
      socket: {
        on(event: 'message', fn: (data: Buffer | ArrayBuffer | Buffer[]) => void): unknown
        on(event: 'close', fn: (code: number, reason: Buffer) => void): unknown
        send(data: any): void
        close(code?: number, reason?: string): void
        readyState: number
      },
      request: Request,
      context: CollabContext,
    ) {
      const connection = hocuspocus.handleConnection(socket as never, request, context)
      socket.on('message', (data) => {
        const bytes = Array.isArray(data)
          ? new Uint8Array(Buffer.concat(data))
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        connection.handleMessage(bytes)
      })
      socket.on('close', (code, reason) =>
        connection.handleClose({ code, reason: reason.toString() }),
      )
      return connection
    },
    /** Pages open right now (for status and tests). */
    openPages: () => [...hocuspocus.documents.keys()],
    /** Save everything pending and drop all connections (shutdown). */
    async close() {
      hocuspocus.flushPendingStores()
      hocuspocus.closeConnections()
      deps.repo.onDocumentWritten(null)
    },
  }
}

export type CollabService = ReturnType<typeof createCollab>
