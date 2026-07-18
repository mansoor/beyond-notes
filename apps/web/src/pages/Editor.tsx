import type { PageMeta } from '@bn/schema'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { DocumentEditor, SaveBadge, type SaveState } from '../editor'
import { trpc } from '../trpc'

export function EditorPage() {
  const { pageId } = useParams({ from: '/app/p/$pageId' })
  const q = trpc.pages.get.useQuery({ pageId })

  if (q.isLoading) {
    return (
      <div className="p-10 text-sm" style={{ color: 'var(--text-3)' }}>
        Loading page…
      </div>
    )
  }
  if (q.error || !q.data) {
    return (
      <div className="p-10 text-sm" style={{ color: 'var(--danger)' }}>
        {q.error?.message ?? 'Page not found.'}
      </div>
    )
  }
  return <PageView key={`${pageId}:${q.data.doc.updatedAt}`} page={q.data.page} doc={q.data.doc} />
}

function PageView(props: { page: PageMeta; doc: Parameters<typeof DocumentEditor>[0]['doc'] }) {
  const utils = trpc.useUtils()
  const rename = trpc.pages.rename.useMutation()
  const [title, setTitle] = useState(props.page.title)
  const [state, setState] = useState<SaveState>('saved')

  const commitTitle = async () => {
    const next = title.trim() || 'Untitled'
    setTitle(next)
    if (next !== props.page.title) {
      await rename.mutateAsync({ pageId: props.page.id, title: next })
      await utils.pages.tree.invalidate({ spaceId: props.page.spaceId })
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-10 py-8">
      <div className="flex items-center gap-3 mb-2">
        <input
          className="flex-1 bg-transparent text-3xl font-bold outline-none"
          value={title}
          placeholder="Untitled"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <SaveBadge state={state} />
      </div>
      <DocumentEditor
        pageId={props.page.id}
        doc={props.doc}
        onStateChange={setState}
        onReload={() => utils.pages.get.invalidate({ pageId: props.page.id })}
      />
    </div>
  )
}
