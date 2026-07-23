import '@blocknote/core/fonts/inter.css'
import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs } from '@blocknote/core'
import '@blocknote/mantine/style.css'
import { BlockNoteView } from '@blocknote/mantine'
import {
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  TextAlignButton,
  getFormattingToolbarItems,
  useCreateBlockNote,
} from '@blocknote/react'
import type { DocumentView } from '@bn/schema'
import { useEffect, useRef, useState } from 'react'
import { isDarkTheme } from './theme'
import { trpc } from './trpc'

// The stock code block ships with no `supportedLanguages`, so BlockNote draws
// no language selector at all — leaving no way to tag a block as `mermaid`,
// which is the one flag the publish renderer and the diagram preview both key
// off. Give it a curated list (mermaid + the languages highlight.ts actually
// colours). No `createHighlighter`: editor-side Shiki would be a heavy bundle,
// and published pages get their own lightweight highlighting at render time.
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec({
      defaultLanguage: 'text',
      supportedLanguages: {
        text: { name: 'Plain Text', aliases: ['text', 'plain'] },
        mermaid: { name: 'Mermaid', aliases: ['mermaid'] },
        javascript: { name: 'JavaScript', aliases: ['js'] },
        typescript: { name: 'TypeScript', aliases: ['ts'] },
        python: { name: 'Python', aliases: ['py'] },
        bash: { name: 'Shell', aliases: ['sh', 'shell', 'zsh', 'console'] },
        json: { name: 'JSON' },
        yaml: { name: 'YAML', aliases: ['yml'] },
        sql: { name: 'SQL' },
        html: { name: 'HTML', aliases: ['xml'] },
        css: { name: 'CSS' },
        markdown: { name: 'Markdown', aliases: ['md'] },
      },
    }),
  },
})

export type SaveState = 'saved' | 'saving' | 'conflict' | 'error'

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
      return Array.isArray(blocks) && blocks.length > 0 ? blocks : undefined
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

  const dark = isDarkTheme()

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
      <div className="-mx-4 lg:-mx-[54px]">
        <BlockNoteView
          editor={editor}
          onChange={scheduleSave}
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
    </div>
  )
}

export function SaveBadge(props: { state: SaveState }) {
  const map: Record<SaveState, { label: string; color: string }> = {
    saved: { label: 'Saved', color: 'var(--live)' },
    saving: { label: 'Saving…', color: 'var(--text-3)' },
    conflict: { label: 'Conflict', color: 'var(--danger)' },
    error: { label: 'Save failed — retrying on next edit', color: 'var(--danger)' },
  }
  const m = map[props.state]
  return (
    <span className="text-xs whitespace-nowrap" style={{ color: m.color }}>
      {m.label}
    </span>
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
