/**
 * The page editor's document model, shared by the web editor and the server.
 *
 * The server needs the exact schema the browser edits with: live co-editing
 * turns saved page content into a collaborative (Yjs) document and back, and
 * that conversion is only lossless with the same block definitions. This is
 * @blocknote/core only — no React, no DOM — so it runs headless in Node.
 */
import {
  BlockNoteEditor,
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
} from '@blocknote/core'

// The stock code block ships with no `supportedLanguages`, so BlockNote draws
// no language selector at all — leaving no way to tag a block as `mermaid`,
// which is the one flag the publish renderer and the diagram preview both key
// off. Give it a curated list (mermaid + the languages highlight.ts actually
// colours). No `createHighlighter`: editor-side Shiki would be a heavy bundle,
// and published pages get their own lightweight highlighting at render time.
export const editorSchema = BlockNoteSchema.create({
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

/** The Y.XmlFragment a page's blocks live in, on both ends of a live session. */
export const COLLAB_FRAGMENT = 'document-store'

/** An editor with no view, for converting documents on the server. */
export function headlessEditor() {
  return BlockNoteEditor.create({ schema: editorSchema, _headless: true })
}
