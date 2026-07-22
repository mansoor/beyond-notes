import { useNavigate, useParams } from '@tanstack/react-router'
import { trpc } from '../trpc'

/**
 * What the content area shows when a space has no pages left — most often
 * because you just deleted the one that was open. Without this the editor sat
 * on the deleted page and went on saving into it.
 *
 * The wording matches the sidebar's own empty state on purpose: the same
 * sentence in both places reads as one fact about the space, not two.
 */
export function SpaceEmptyPage() {
  const { spaceId } = useParams({ from: '/app/space/$spaceId' })
  const navigate = useNavigate()
  const spaces = trpc.spaces.list.useQuery()
  const tree = trpc.pages.tree.useQuery({ spaceId })
  const utils = trpc.useUtils()
  const create = trpc.pages.create.useMutation()

  const space = (spaces.data ?? []).find((s) => s.id === spaceId)
  const pages = tree.data ?? []

  const addPage = async () => {
    const page = await create.mutateAsync({ spaceId, parentId: null, title: '' })
    await utils.pages.tree.invalidate({ spaceId })
    navigate({ to: '/p/$pageId', params: { pageId: page.id } })
  }

  // it filled up again in another tab, or the query simply resolved late
  if (pages.length > 0) {
    return (
      <div className="p-10 text-sm" style={{ color: 'var(--text-3)' }}>
        Pick a page in the sidebar.
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-10 py-16">
      <h1 className="text-xl font-semibold mb-1">{space?.name ?? 'Empty'}</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
        empty —{' '}
        <button
          type="button"
          className="underline"
          onClick={addPage}
          disabled={create.isPending}
          style={{ color: 'var(--accent)' }}
        >
          add a page
        </button>
      </p>
      {create.error && (
        <p className="text-sm" style={{ color: 'var(--danger)' }}>
          {create.error.message}
        </p>
      )}
    </div>
  )
}
