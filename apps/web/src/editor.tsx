import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import type { BlockNoteEditor } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import {
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  TextAlignButton,
  getFormattingToolbarItems,
  useCreateBlockNote,
} from '@blocknote/react'
import { COLLAB_FRAGMENT, editorSchema as schema } from '@bn/editor'
import type { DocumentView } from '@bn/schema'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { isDarkTheme } from './theme'
import { trpc } from './trpc'

export type SaveState =
  | 'saved'
  | 'saving'
  | 'conflict'
  | 'error'
  | 'live'
  | 'connecting'
  | 'offline'

/**
 * Give every block a document-unique id, children included. BlockNote resolves
 * blocks by id and throws "Block type does not match" if two share one — a page
 * merge could leave duplicates behind, so we repair them before the editor sees
 * the content. First to claim an id keeps it; later clashes get a suffix.
 */
function dedupeBlockIds(blocks: unknown[], seen: Set<string> = new Set()): unknown[] {
  return blocks.map((b) => {
    if (!b || typeof b !== 'object') return b
    const block = b as { id?: unknown; children?: unknown }
    let id = typeof block.id === 'string' && block.id ? block.id : 'block'
    if (seen.has(id)) {
      let k = 1
      while (seen.has(`${id}-${k}`)) k++
      id = `${id}-${k}`
    }
    seen.add(id)
    return {
      ...block,
      id,
      children: Array.isArray(block.children)
        ? dedupeBlockIds(block.children, seen)
        : block.children,
    }
  })
}

export async function uploadFile(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Upload failed (${res.status})`)
  const json = (await res.json()) as { url: string }
  return json.url
}

/**
 * BlockNote + debounced autosave behind the optimistic lock. Mount with a key
 * that includes doc.updatedAt so a reload replaces the editor instance.
 */
export function DocumentEditor(props: {
  pageId: string
  doc: DocumentView
  onReload: () => void
  onStateChange?: (s: SaveState) => void
  /**
   * The document JSON just written, handed back after each successful save.
   * Lets a sibling (e.g. the mermaid preview) reflect saved content without
   * re-fetching the page — a refetch would bump doc.updatedAt, change this
   * editor's remount key, and throw away the cursor mid-typing.
   */
  onSaved?: (content: string) => void
  /** a space shared with this person read-only: show the page, take no edits */
  readOnly?: boolean
}) {
  const save = trpc.pages.saveDoc.useMutation()
  const utils = trpc.useUtils()
  const [state, setStateRaw] = useState<SaveState>('saved')
  const baseRef = useRef(props.doc.updatedAt)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setState = (s: SaveState) => {
    setStateRaw(s)
    props.onStateChange?.(s)
  }

  const parsed = (() => {
    try {
      const blocks = JSON.parse(props.doc.content)
      // Heal duplicate block ids before handing them to BlockNote — two blocks
      // sharing an id makes it throw "Block type does not match" and the page
      // won't open. A page merge could produce that; this repairs it on load.
      return Array.isArray(blocks) && blocks.length > 0
        ? (dedupeBlockIds(blocks) as typeof blocks)
        : undefined
    } catch {
      return undefined
    }
  })()

  const editor = useCreateBlockNote({ schema, initialContent: parsed, uploadFile })

  // clear any pending save only on unmount — an empty deps array is load-bearing
  // (without it, every render clears the debounce timer and saves never fire)
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const scheduleSave = () => {
    if (state === 'conflict') return
    setState('saving')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try {
        const content = JSON.stringify(editor.document)
        const res = await save.mutateAsync({
          pageId: props.pageId,
          content,
          baseUpdatedAt: baseRef.current,
        })
        baseRef.current = res.updatedAt
        setState('saved')
        props.onSaved?.(content)
      } catch (err) {
        const message = err instanceof Error ? err.message : ''
        setState(message.includes('another window') ? 'conflict' : 'error')
      }
    }, 800)
  }

  return (
    <div>
      {state === 'conflict' && (
        <div
          className="rounded-lg border px-3 py-2 mb-3 text-sm flex items-center justify-between"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          This page changed in another window. Reload to pick up the latest version.
          <button type="button" className="underline" onClick={props.onReload}>
            Reload
          </button>
        </div>
      )}
      {/* BlockNote pads its editor 54px inline for the block side-menu; the
          negative margin pulls the text back to the page edge. On desktop
          (lg+, container px-10) that's -54; below lg the gutter shrinks to
          16px (see .bn-editor override in styles.css) and the margin only
          cancels the container's px-4, so the editor is exactly viewport-wide
          instead of overflowing 108px and forcing a horizontal scroll. */}
      <EditorSurface
        editor={editor}
        readOnly={props.readOnly}
        onChange={props.readOnly ? undefined : scheduleSave}
      />
    </div>
  )
}

export function SaveBadge(props: { state: SaveState; others?: number }) {
  const map: Record<SaveState, { label: string; color: string }> = {
    saved: { label: 'Saved', color: 'var(--live)' },
    saving: { label: 'Saving…', color: 'var(--text-3)' },
    conflict: { label: 'Conflict', color: 'var(--danger)' },
    error: { label: 'Save failed — retrying on next edit', color: 'var(--danger)' },
    live: { label: 'Live', color: 'var(--live)' },
    connecting: { label: 'Connecting…', color: 'var(--text-3)' },
    offline: { label: 'Offline — your changes sync when you reconnect', color: 'var(--danger)' },
  }
  const m = map[props.state]
  return (
    <span className="text-xs whitespace-nowrap" style={{ color: m.color }}>
      {m.label}
      {props.state === 'live' && props.others
        ? ` · ${props.others} other${props.others === 1 ? '' : 's'} here`
        : ''}
    </span>
  )
}

type Editor = BlockNoteEditor<
  typeof schema.blockSchema,
  typeof schema.inlineContentSchema,
  typeof schema.styleSchema
>

/** The editor itself, with our toolbar and @-mentions, for both editing modes. */
function EditorSurface(props: { editor: Editor; readOnly?: boolean; onChange?: () => void }) {
  const utils = trpc.useUtils()
  const editor = props.editor
  const dark = isDarkTheme()
  return (
    <>
      {/* BlockNote pads its editor 54px inline for the block side-menu; the
          negative margin pulls the text back to the page edge. On desktop
          (lg+, container px-10) that's -54; below lg the gutter shrinks to
          16px (see .bn-editor override in styles.css) and the margin only
          cancels the container's px-4, so the editor is exactly viewport-wide
          instead of overflowing 108px and forcing a horizontal scroll. */}
      <div className="-mx-4 lg:-mx-[54px]">
        <BlockNoteView
          editor={editor}
          editable={!props.readOnly}
          onChange={props.onChange}
          theme={dark ? 'dark' : 'light'}
          formattingToolbar={false}
        >
          {/* default toolbar plus a Justify align button (BlockNote ships every
          other alignment but not this one) */}
          <FormattingToolbarController
            formattingToolbar={() => (
              <FormattingToolbar>
                {...getFormattingToolbarItems()}
                <TextAlignButton key="justify" textAlignment="justify" />
              </FormattingToolbar>
            )}
          />
          {/* @-mention: link to another page; the link index derives from these */}
          <SuggestionMenuController
            triggerCharacter="@"
            minQueryLength={2}
            getItems={async (query) => {
              if (query.trim().length < 2) return []
              const results = await utils.client.search.all.query({ q: query })
              return results
                .filter((r) => r.kind === 'page')
                .slice(0, 8)
                .map((r) => ({
                  title: r.title || 'Untitled',
                  subtext: r.context,
                  onItemClick: () => {
                    editor.insertInlineContent([
                      { type: 'link', href: `/p/${r.id}`, content: r.title || 'Untitled' },
                      ' ',
                    ])
                  },
                }))
            }}
          />
        </BlockNoteView>
      </div>
    </>
  )
}

/** A stable, readable cursor colour per person. */
const CURSOR_COLOURS = [
  '#2f6fd0',
  '#c2410c',
  '#15803d',
  '#a21caf',
  '#0e7490',
  '#b45309',
  '#be123c',
  '#4d7c0f',
]
function colourFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return CURSOR_COLOURS[h % CURSOR_COLOURS.length] as string
}

/**
 * Live co-editing (server: collab.ts): the page is a shared document edited
 * over a WebSocket, and the server saves it. There is no autosave and no
 * conflict here. If the server won't open the page live (the feature is off,
 * or anything else), `onFallback` switches the page back to the classic
 * editor before anyone has typed into this one.
 */
export function LiveDocumentEditor(props: {
  pageId: string
  me: { id: string; name: string }
  readOnly?: boolean
  onStateChange?: (s: SaveState, others: number) => void
  /** the document as blocks JSON after edits settle (mermaid preview) */
  onSaved?: (content: string) => void
  onFallback: () => void
}) {
  const [live] = useState(() => {
    const doc = new Y.Doc()
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const provider = new HocuspocusProvider({
      url: `${scheme}://${window.location.host}/api/collab`,
      name: props.pageId,
      document: doc,
    })
    return { doc, provider }
  })
  const [synced, setSynced] = useState(false)
  const fallbackRef = useRef(props.onFallback)
  fallbackRef.current = props.onFallback
  const stateRef = useRef(props.onStateChange)
  stateRef.current = props.onStateChange

  useEffect(() => {
    const { provider } = live
    let isSynced = false
    const report = () => {
      const others = Math.max(0, provider.awareness ? provider.awareness.getStates().size - 1 : 0)
      const status = provider.configuration.websocketProvider.status
      stateRef.current?.(
        status === 'connected'
          ? isSynced
            ? 'live'
            : 'connecting'
          : status === 'connecting'
            ? 'connecting'
            : 'offline',
        others,
      )
    }
    const onSynced = ({ state }: { state: boolean }) => {
      if (state) {
        isSynced = true
        setSynced(true)
      }
      report()
    }
    provider.on('synced', onSynced)
    provider.on('status', report)
    provider.awareness?.on('change', report)
    report()
    // never opened live: go back to the classic editor
    const giveUp = setTimeout(() => {
      if (!isSynced) fallbackRef.current()
    }, 6000)
    return () => {
      clearTimeout(giveUp)
      provider.off('synced', onSynced)
      provider.off('status', report)
      provider.awareness?.off('change', report)
      provider.destroy()
    }
  }, [live])

  const editor = useCreateBlockNote(
    {
      schema,
      uploadFile,
      collaboration: {
        // BlockNote only needs the provider's awareness (for cursors)
        provider: { awareness: live.provider.awareness ?? undefined } as never,
        fragment: live.doc.getXmlFragment(COLLAB_FRAGMENT),
        user: { name: props.me.name, color: colourFor(props.me.id) },
        showCursorLabels: 'activity',
      },
    },
    [live],
  )

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChange = () => {
    if (!props.onSaved) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => props.onSaved?.(JSON.stringify(editor.document)), 600)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <div style={{ opacity: synced ? 1 : 0.6 }}>
      <EditorSurface editor={editor} readOnly={props.readOnly || !synced} onChange={onChange} />
    </div>
  )
}

// ---- local-date helpers shared by the daily surfaces ----

export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayKey(): string {
  return toDateKey(new Date())
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function shiftDateKey(key: string, days: number): string {
  const d = parseDateKey(key)
  d.setDate(d.getDate() + days)
  return toDateKey(d)
}

export function prettyDate(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
