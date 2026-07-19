import type { PageMeta, SpaceCategory, SpaceView } from '@bn/schema'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { ErrorNote, Field, Modal, SubmitButton, useSubmit } from './components'
import { trpc } from './trpc'

const CATEGORY_LABEL: Record<SpaceCategory, string> = {
  wiki: 'Wikis',
  notebook: 'Notebooks',
  site: 'Sites',
}

type PageAction = { kind: 'rename' | 'move' | 'delete'; page: PageMeta } | null

export function SpacesNav() {
  const spaces = trpc.spaces.list.useQuery()
  const [creating, setCreating] = useState(false)

  const groups: SpaceCategory[] = ['wiki', 'notebook', 'site']

  return (
    <div className="flex flex-col gap-4">
      {groups.map((cat) => {
        const inGroup = spaces.data?.filter((s) => s.category === cat) ?? []
        if (inGroup.length === 0) return null
        return (
          <div key={cat}>
            <div
              className="text-[11px] uppercase tracking-wide font-semibold mb-1 px-2"
              style={{ color: 'var(--text-3)' }}
            >
              {CATEGORY_LABEL[cat]}
            </div>
            {inGroup.map((space) => (
              <SpaceItem key={space.id} space={space} />
            ))}
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="text-left text-sm px-2 py-1 rounded"
        style={{ color: 'var(--text-3)' }}
      >
        ＋ New space
      </button>
      {creating && <NewSpaceModal onClose={() => setCreating(false)} />}
    </div>
  )
}

function NewSpaceModal(props: { onClose: () => void }) {
  const utils = trpc.useUtils()
  const create = trpc.spaces.create.useMutation()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<SpaceCategory>('notebook')
  const [personal, setPersonal] = useState(false)
  const { busy, error, onSubmit } = useSubmit(async () => {
    await create.mutateAsync({ name, category, personal })
    await utils.spaces.list.invalidate()
    props.onClose()
  })
  const dirty = name.trim() !== '' || category !== 'notebook' || personal

  return (
    <Modal title="New space" onClose={props.onClose} dirty={dirty}>
      <form onSubmit={onSubmit}>
        <Field label="Name" value={name} onChange={setName} autoFocus />
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Kind</span>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={category}
            onChange={(e) => setCategory(e.target.value as SpaceCategory)}
          >
            <option value="notebook">Notebook — private notes tree</option>
            <option value="wiki">Wiki — publishable as a docs site</option>
            <option value="site">Site — publishable as a website (blog, pages)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 mb-4 text-sm">
          <input
            type="checkbox"
            checked={personal}
            onChange={(e) => setPersonal(e.target.checked)}
          />
          Personal (only you can see it)
        </label>
        <ErrorNote message={error} />
        <SubmitButton label="Create space" busy={busy} />
      </form>
    </Modal>
  )
}

function SpaceItem(props: { space: SpaceView }) {
  const utils = trpc.useUtils()
  const [expanded, setExpanded] = useState(true)
  const tree = trpc.pages.tree.useQuery({ spaceId: props.space.id }, { enabled: expanded })
  const createPage = trpc.pages.create.useMutation()
  const navigate = useNavigate()
  const [action, setAction] = useState<PageAction>(null)
  const [publishingOpen, setPublishingOpen] = useState(false)

  const addPage = async (parentId: string | null) => {
    const page = await createPage.mutateAsync({ spaceId: props.space.id, parentId, title: '' })
    await utils.pages.tree.invalidate({ spaceId: props.space.id })
    navigate({ to: '/p/$pageId', params: { pageId: page.id } })
  }

  const roots = (tree.data ?? []).filter((p) => p.parentId === null)

  return (
    <div className="mb-1">
      <div
        className="group flex items-center gap-1 px-2 py-1 rounded text-sm font-medium"
        style={{ color: 'var(--text-2)' }}
      >
        <button type="button" onClick={() => setExpanded(!expanded)} className="w-4 text-xs">
          {expanded ? '▾' : '▸'}
        </button>
        <span className="truncate">{props.space.name}</span>
        {props.space.personal && (
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }} title="Personal space">
            ⛭
          </span>
        )}
        {props.space.publicEnabled && (
          <span
            className="text-[10px] font-semibold uppercase rounded px-1"
            style={{
              color: 'var(--live)',
              background: 'color-mix(in srgb, var(--live) 12%, transparent)',
            }}
            title={`Published at ${props.space.publicHost}`}
          >
            public
          </span>
        )}
        <span className="ml-auto opacity-0 group-hover:opacity-100 flex items-center">
          <button
            type="button"
            title="Publishing settings"
            onClick={() => setPublishingOpen(true)}
            className="text-xs px-1"
            style={{ color: 'var(--text-3)' }}
          >
            ⚙
          </button>
          <a
            title="Export as Markdown (.zip)"
            href={`/api/export/space/${props.space.id}`}
            download
            className="text-xs px-1"
            style={{ color: 'var(--text-3)' }}
          >
            ⤓
          </a>
          <button
            type="button"
            title="New page"
            onClick={() => addPage(null)}
            className="text-xs px-1"
            style={{ color: 'var(--text-3)' }}
          >
            ＋
          </button>
        </span>
      </div>
      {publishingOpen && (
        <SpacePublishingModal space={props.space} onClose={() => setPublishingOpen(false)} />
      )}
      {expanded && tree.data && (
        <PageTreeLevel
          pages={tree.data}
          parentId={null}
          depth={0}
          onAddChild={addPage}
          onAction={(a) => setAction(a)}
        />
      )}
      {expanded && roots.length === 0 && tree.data && (
        <div className="text-xs px-7 py-1" style={{ color: 'var(--text-3)' }}>
          empty — add a page
        </div>
      )}
      {action?.kind === 'rename' && (
        <RenamePageModal page={action.page} onClose={() => setAction(null)} />
      )}
      {action?.kind === 'move' && tree.data && (
        <MovePageModal page={action.page} all={tree.data} onClose={() => setAction(null)} />
      )}
      {action?.kind === 'delete' && (
        <DeletePageModal page={action.page} onClose={() => setAction(null)} />
      )}
    </div>
  )
}

function SpacePublishingModal(props: { space: SpaceView; onClose: () => void }) {
  const utils = trpc.useUtils()
  const update = trpc.publish.updateSpace.useMutation()
  const s = props.space
  const [enabled, setEnabled] = useState(s.publicEnabled)
  const [host, setHost] = useState(s.publicHost ?? '')
  const [title, setTitle] = useState(s.publicTitle ?? '')
  const [footer, setFooter] = useState(s.publicFooter ?? '')
  const [theme, setTheme] = useState(s.publicTheme)
  const { busy, error, onSubmit } = useSubmit(async () => {
    await update.mutateAsync({
      spaceId: s.id,
      enabled,
      host: host.trim() || null,
      title: title.trim() || null,
      footer: footer.trim() || null,
      theme,
    })
    await utils.spaces.list.invalidate()
    props.onClose()
  })
  const dirty =
    enabled !== s.publicEnabled ||
    host !== (s.publicHost ?? '') ||
    title !== (s.publicTitle ?? '') ||
    footer !== (s.publicFooter ?? '') ||
    theme !== s.publicTheme

  return (
    <Modal title={`Publishing — ${s.name}`} onClose={props.onClose} dirty={dirty}>
      <form onSubmit={onSubmit}>
        <label className="flex items-center gap-2 mb-4 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Publish this space as a docs site
        </label>
        <Field label="Host (e.g. docs.example.com)" value={host} onChange={setHost} />
        <Field label="Site title (defaults to the space name)" value={title} onChange={setTitle} />
        <Field label="Footer" value={footer} onChange={setFooter} />
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Theme</span>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={theme}
            onChange={(e) => setTheme(e.target.value as SpaceView['publicTheme'])}
          >
            <option value="paper">Paper — warm light, dark variant</option>
            <option value="ink">Ink — always dark</option>
            <option value="mist">Mist — cool light, dark variant</option>
            <option value="sand">Sand — warm sand, dark variant</option>
          </select>
        </label>
        <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
          Only pages you explicitly publish appear, and only when every parent is published too.
          Preview without DNS at /s/&lt;host&gt;/.
        </p>
        <ErrorNote message={error} />
        <SubmitButton label="Save" busy={busy} />
      </form>
    </Modal>
  )
}

function PageTreeLevel(props: {
  pages: PageMeta[]
  parentId: string | null
  depth: number
  onAddChild: (parentId: string) => void
  onAction: (a: PageAction) => void
}) {
  const params = useParams({ strict: false }) as { pageId?: string }
  const level = props.pages
    .filter((p) => p.parentId === props.parentId)
    .sort((a, b) => a.position - b.position)

  if (level.length === 0) return null
  return (
    <div>
      {level.map((page) => (
        <div key={page.id}>
          <div
            className="group flex items-center gap-1 pr-2 py-0.5 rounded text-sm hover:bg-black/5 dark:hover:bg-white/5"
            style={{
              paddingLeft: `${26 + props.depth * 14}px`,
              background: params.pageId === page.id ? 'var(--accent-soft)' : undefined,
              color: params.pageId === page.id ? 'var(--accent)' : 'var(--text-2)',
            }}
          >
            <Link
              to="/p/$pageId"
              params={{ pageId: page.id }}
              className="truncate flex-1"
              title={page.title}
            >
              {page.pageType === 'blog' ? '📰 ' : page.pageType === 'gallery' ? '🖼 ' : ''}
              {page.title}
            </Link>
            <span className="hidden group-hover:flex items-center gap-0.5">
              <button
                type="button"
                title="Add subpage"
                className="text-xs px-0.5"
                onClick={() => props.onAddChild(page.id)}
              >
                ＋
              </button>
              <PageMenu page={page} onAction={props.onAction} />
            </span>
          </div>
          <PageTreeLevel
            pages={props.pages}
            parentId={page.id}
            depth={props.depth + 1}
            onAddChild={props.onAddChild}
            onAction={props.onAction}
          />
        </div>
      ))}
    </div>
  )
}

function PageMenu(props: { page: PageMeta; onAction: (a: PageAction) => void }) {
  const [open, setOpen] = useState(false)
  const utils = trpc.useUtils()
  const setType = trpc.pages.setType.useMutation({
    onSuccess: () => {
      utils.pages.tree.invalidate({ spaceId: props.page.spaceId })
      utils.pages.get.invalidate({ pageId: props.page.id })
    },
  })
  const archive = trpc.pages.archive.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.pages.tree.invalidate({ spaceId: props.page.spaceId }),
        utils.pages.archived.invalidate(),
        utils.tasks.agenda.invalidate(),
      ]),
  })
  return (
    <span className="relative">
      <button
        type="button"
        className="text-xs px-0.5"
        title="Page menu"
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <div
          className="absolute right-0 top-5 z-40 w-40 rounded-lg border py-1 text-sm shadow-sm"
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
          onMouseLeave={() => setOpen(false)}
        >
          {(['rename', 'move'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5 capitalize"
              style={{ color: 'var(--text)' }}
              onClick={() => {
                setOpen(false)
                props.onAction({ kind, page: props.page })
              }}
            >
              {kind}
            </button>
          ))}
          <button
            type="button"
            className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--text)' }}
            title="Hide from the sidebar, search, and tasks; restore any time from Archive"
            onClick={() => {
              setOpen(false)
              archive.mutate({ pageId: props.page.id })
            }}
          >
            Archive
          </button>
          <button
            type="button"
            className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--danger)' }}
            onClick={() => {
              setOpen(false)
              props.onAction({ kind: 'delete', page: props.page })
            }}
          >
            Delete
          </button>
          {(['doc', 'blog', 'gallery'] as const)
            .filter((t) => t !== props.page.pageType)
            .map((t) => (
              <button
                key={t}
                type="button"
                className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: 'var(--text)' }}
                onClick={() => {
                  setOpen(false)
                  setType.mutate({ pageId: props.page.id, pageType: t })
                }}
              >
                {t === 'doc'
                  ? 'Make normal page'
                  : t === 'blog'
                    ? 'Make blog page'
                    : 'Make gallery page'}
              </button>
            ))}
        </div>
      )}
    </span>
  )
}

function RenamePageModal(props: { page: PageMeta; onClose: () => void }) {
  const utils = trpc.useUtils()
  const rename = trpc.pages.rename.useMutation()
  const [title, setTitle] = useState(props.page.title)
  const { busy, error, onSubmit } = useSubmit(async () => {
    await rename.mutateAsync({ pageId: props.page.id, title })
    await utils.pages.tree.invalidate({ spaceId: props.page.spaceId })
    await utils.pages.get.invalidate({ pageId: props.page.id })
    props.onClose()
  })
  return (
    <Modal title="Rename page" onClose={props.onClose} dirty={title !== props.page.title}>
      <form onSubmit={onSubmit}>
        <Field label="Title" value={title} onChange={setTitle} autoFocus />
        <ErrorNote message={error} />
        <SubmitButton label="Rename" busy={busy} />
      </form>
    </Modal>
  )
}

function MovePageModal(props: { page: PageMeta; all: PageMeta[]; onClose: () => void }) {
  const utils = trpc.useUtils()
  const move = trpc.pages.move.useMutation()
  const spaces = trpc.spaces.list.useQuery()

  const [targetSpaceId, setTargetSpaceId] = useState(props.page.spaceId)
  const crossSpace = targetSpaceId !== props.page.spaceId
  const targetTree = trpc.pages.tree.useQuery({ spaceId: targetSpaceId }, { enabled: crossSpace })

  // same-space: a page cannot move under itself or its own descendants
  const blocked = new Set<string>([props.page.id])
  let grew = true
  while (grew) {
    grew = false
    for (const p of props.all) {
      if (p.parentId && blocked.has(p.parentId) && !blocked.has(p.id)) {
        blocked.add(p.id)
        grew = true
      }
    }
  }
  const candidates = crossSpace
    ? (targetTree.data ?? [])
    : props.all.filter((p) => !blocked.has(p.id))

  const [parentId, setParentId] = useState<string | ''>(props.page.parentId ?? '')
  const { busy, error, onSubmit } = useSubmit(async () => {
    await move.mutateAsync({
      pageId: props.page.id,
      parentId: parentId || null,
      index: 9999,
      spaceId: crossSpace ? targetSpaceId : undefined,
    })
    await utils.pages.tree.invalidate({ spaceId: props.page.spaceId })
    await utils.pages.tree.invalidate({ spaceId: targetSpaceId })
    await utils.pages.get.invalidate({ pageId: props.page.id })
    props.onClose()
  })
  const dirty = targetSpaceId !== props.page.spaceId || parentId !== (props.page.parentId ?? '')

  return (
    <Modal title={`Move "${props.page.title}"`} onClose={props.onClose} dirty={dirty}>
      <form onSubmit={onSubmit}>
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Space</span>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={targetSpaceId}
            onChange={(e) => {
              setTargetSpaceId(e.target.value)
              setParentId('')
            }}
          >
            {spaces.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.id === props.page.spaceId ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">New parent</span>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">— space root —</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.pageType === 'blog' ? '📰 ' : ''}
                {p.title}
              </option>
            ))}
          </select>
        </label>
        {crossSpace && (
          <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
            Moves the page and all its subpages. Move under a 📰 blog page to turn a note into a
            post.
          </p>
        )}
        <ErrorNote message={error} />
        <SubmitButton label="Move" busy={busy} />
      </form>
    </Modal>
  )
}

function DeletePageModal(props: { page: PageMeta; onClose: () => void }) {
  const utils = trpc.useUtils()
  const del = trpc.pages.delete.useMutation()
  const navigate = useNavigate()
  const { busy, error, onSubmit } = useSubmit(async () => {
    await del.mutateAsync({ pageId: props.page.id })
    await utils.pages.tree.invalidate({ spaceId: props.page.spaceId })
    navigate({ to: '/' })
    props.onClose()
  })
  return (
    <Modal title={`Delete "${props.page.title}"?`} onClose={props.onClose}>
      <form onSubmit={onSubmit}>
        <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
          This deletes the page and every subpage under it. There is no undo (version history
          arrives in M3).
        </p>
        <ErrorNote message={error} />
        <SubmitButton label="Delete permanently" busy={busy} />
      </form>
    </Modal>
  )
}
