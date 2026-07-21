import type { PageMeta, SpaceCategory, SpaceView } from '@bn/schema'
import { pageTypesByCategory, socialPlatform } from '@bn/schema'

const SOCIAL_PLATFORMS = socialPlatform.options
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { ErrorNote, Field, Modal, PageIcon, SubmitButton, useSubmit } from './components'
import { trpc } from './trpc'

const CATEGORY_LABEL: Record<SpaceCategory, string> = {
  wiki: 'Wikis',
  notebook: 'Notebooks',
  site: 'Sites',
}

type PageAction = { kind: 'rename' | 'move' | 'template'; page: PageMeta } | null

// drag-and-drop over the tree: drop above a row (reorder before), below it
// (reorder after), or onto its middle (nest as a child)
type DropZone = 'before' | 'after' | 'inside'
type TreeDnd = {
  dragId: string | null
  over: { id: string; zone: DropZone } | null
  setDragId: (id: string | null) => void
  setOver: (o: { id: string; zone: DropZone } | null) => void
  clear: () => void
  drop: (draggedId: string, targetId: string, zone: DropZone) => void
}

export function SpacesNav() {
  const spaces = trpc.spaces.list.useQuery()
  const [creating, setCreating] = useState(false)

  const groups: SpaceCategory[] = ['notebook', 'site', 'wiki']

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="text-left text-sm px-2 py-1 rounded"
        style={{ color: 'var(--text-3)' }}
      >
        ＋ New space
      </button>
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
  const [reorgOpen, setReorgOpen] = useState(false)

  const addPage = async (parentId: string | null) => {
    const page = await createPage.mutateAsync({ spaceId: props.space.id, parentId, title: '' })
    await utils.pages.tree.invalidate({ spaceId: props.space.id })
    navigate({ to: '/p/$pageId', params: { pageId: page.id } })
  }

  const move = trpc.pages.move.useMutation({
    onSuccess: () => utils.pages.tree.invalidate({ spaceId: props.space.id }),
  })
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; zone: DropZone } | null>(null)
  const dnd: TreeDnd = {
    dragId,
    over,
    setDragId,
    setOver,
    clear: () => {
      setDragId(null)
      setOver(null)
    },
    drop: (draggedId, targetId, zone) => {
      if (draggedId === targetId) return
      const all = tree.data ?? []
      const target = all.find((p) => p.id === targetId)
      if (!target) return
      if (zone === 'inside') {
        move.mutate({ pageId: draggedId, parentId: target.id, index: 9999 })
        return
      }
      // reorder among the target's siblings; movePage recomputes positions
      // over the list with the dragged page removed, so index is measured there
      const sibs = all
        .filter((p) => p.parentId === target.parentId && p.id !== draggedId)
        .sort((a, b) => a.position - b.position)
      const ti = sibs.findIndex((p) => p.id === targetId)
      move.mutate({
        pageId: draggedId,
        parentId: target.parentId,
        index: zone === 'before' ? ti : ti + 1,
      })
    },
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
          <button
            type="button"
            title="Reorganize pages"
            onClick={() => setReorgOpen(true)}
            className="text-xs px-1"
            style={{ color: 'var(--text-3)' }}
          >
            ⇅
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
      {reorgOpen && tree.data && (
        <ReorganizeModal
          spaceId={props.space.id}
          spaceName={props.space.name}
          pages={tree.data}
          onClose={() => setReorgOpen(false)}
        />
      )}
      {expanded && tree.data && (
        <PageTreeLevel
          pages={tree.data}
          parentId={null}
          depth={0}
          category={props.space.category}
          dnd={dnd}
          onAddChild={addPage}
          onAction={(a) => setAction(a)}
        />
      )}
      {expanded && roots.length === 0 && tree.data && (
        <div className="text-xs px-7 py-1" style={{ color: 'var(--text-3)' }}>
          empty —{' '}
          <button type="button" className="underline" onClick={() => addPage(null)}>
            add a page
          </button>
        </div>
      )}
      {action?.kind === 'rename' && (
        <RenamePageModal page={action.page} onClose={() => setAction(null)} />
      )}
      {action?.kind === 'move' && tree.data && (
        <MovePageModal page={action.page} all={tree.data} onClose={() => setAction(null)} />
      )}
      {action?.kind === 'template' && (
        <SaveTemplateModal page={action.page} onClose={() => setAction(null)} />
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
  const [appearance, setAppearance] = useState(s.publicAppearance)
  const [social, setSocial] = useState<SpaceView['publicSocial']>(s.publicSocial)
  const [logoId, setLogoId] = useState(s.publicLogoAttachmentId)
  const [tagline, setTagline] = useState(s.publicTagline ?? '')
  const [headerLayout, setHeaderLayout] = useState(s.publicHeaderLayout)
  const [logoBusy, setLogoBusy] = useState(false)

  const uploadLogo = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setLogoBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) return
      const json = (await res.json()) as { id: string }
      setLogoId(json.id)
    } finally {
      setLogoBusy(false)
    }
  }

  const { busy, error, onSubmit } = useSubmit(async () => {
    await update.mutateAsync({
      spaceId: s.id,
      enabled,
      host: host.trim() || null,
      title: title.trim() || null,
      footer: footer.trim() || null,
      theme,
      appearance,
      social: social.filter((l) => l.url.trim() !== ''),
      logoAttachmentId: logoId,
      tagline: tagline.trim() || null,
      headerLayout,
    })
    await utils.spaces.list.invalidate()
    props.onClose()
  })
  const dirty =
    enabled !== s.publicEnabled ||
    host !== (s.publicHost ?? '') ||
    title !== (s.publicTitle ?? '') ||
    footer !== (s.publicFooter ?? '') ||
    theme !== s.publicTheme ||
    appearance !== s.publicAppearance ||
    JSON.stringify(social) !== JSON.stringify(s.publicSocial) ||
    logoId !== s.publicLogoAttachmentId ||
    tagline !== (s.publicTagline ?? '') ||
    headerLayout !== s.publicHeaderLayout

  const isSite = s.category === 'site'
  const isWiki = s.category === 'wiki'
  // wikis get social links too (product docs usually have a wider web presence),
  // but not the logo/tagline/header-layout that only the website chrome renders
  const tabs = [
    { id: 'general', label: 'General', icon: '🌐' },
    { id: 'appearance', label: 'Appearance', icon: '🎨' },
    ...(isSite || isWiki
      ? [{ id: 'branding', label: isSite ? 'Branding' : 'Social', icon: isSite ? '✦' : '🔗' }]
      : []),
  ] as const
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('general')

  return (
    <Modal title={`Publishing — ${s.name}`} onClose={props.onClose} dirty={dirty} width="lg">
      <form onSubmit={onSubmit}>
        <div className="flex gap-5">
          <div
            className="flex flex-col gap-1 shrink-0 w-36 border-r pr-3"
            style={{ borderColor: 'var(--border)' }}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="text-left rounded-lg px-3 py-1.5 text-sm"
                style={{
                  background: tab === t.id ? 'var(--accent-soft)' : undefined,
                  color: tab === t.id ? 'var(--accent)' : 'var(--text-2)',
                  fontWeight: tab === t.id ? 600 : undefined,
                }}
              >
                <span className="mr-1.5">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0 min-h-[320px]">
            {tab === 'general' && (
              <>
                <label className="flex items-center gap-2 mb-4 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  {isSite ? 'Publish this space as a website' : 'Publish this space as a docs site'}
                </label>
                <Field label="Host (e.g. docs.example.com)" value={host} onChange={setHost} />
                <Field
                  label="Site title (defaults to the space name)"
                  value={title}
                  onChange={setTitle}
                />
                <Field label="Footer" value={footer} onChange={setFooter} />
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Only pages you explicitly publish appear, and only when every parent is published
                  too. Preview without DNS at /s/&lt;host&gt;/.
                </p>
              </>
            )}
            {tab === 'appearance' && (
              <>
                <label className="block mb-4">
                  <span className="block text-sm font-medium mb-1">Theme</span>
                  <select
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as SpaceView['publicTheme'])}
                  >
                    <option value="paper">Paper — warm, easy on the eyes</option>
                    <option value="ink">Ink — moody blue-gray</option>
                    <option value="mist">Mist — cool and airy</option>
                    <option value="sand">Sand — warm earth tones</option>
                    <option value="bloom">Bloom — bright white, vivid accent</option>
                  </select>
                </label>
                <label className="block mb-4">
                  <span className="block text-sm font-medium mb-1">Appearance</span>
                  <select
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                    value={appearance}
                    onChange={(e) => setAppearance(e.target.value as SpaceView['publicAppearance'])}
                  >
                    <option value="auto">Auto — follow each visitor&apos;s device</option>
                    <option value="light">Always light</option>
                    <option value="dark">Always dark</option>
                  </select>
                </label>
                {isSite && (
                  <label className="block mb-4">
                    <span className="block text-sm font-medium mb-1">Header style</span>
                    <select
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                      value={headerLayout}
                      onChange={(e) =>
                        setHeaderLayout(e.target.value as SpaceView['publicHeaderLayout'])
                      }
                    >
                      <option value="classic">Classic — logo left, menu right</option>
                      <option value="centered">
                        Centered — logo centered, menu below left + socials right
                      </option>
                      <option value="split">Split — logo left, menu center, socials right</option>
                      <option value="minimal">Minimal — everything centered, stacked</option>
                    </select>
                  </label>
                )}
              </>
            )}
            {tab === 'branding' && (
              <BrandingTab
                socialOnly={!isSite}
                tagline={tagline}
                setTagline={setTagline}
                logoId={logoId}
                setLogoId={setLogoId}
                logoBusy={logoBusy}
                uploadLogo={uploadLogo}
                social={social}
                setSocial={setSocial}
              />
            )}
          </div>
        </div>
        <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <ErrorNote message={error} />
          <SubmitButton label="Save" busy={busy} />
        </div>
      </form>
    </Modal>
  )
}

function BrandingTab(props: {
  /** wikis only render social links in their header, not a logo/tagline */
  socialOnly?: boolean
  tagline: string
  setTagline: (v: string) => void
  logoId: string | null
  setLogoId: (v: string | null) => void
  logoBusy: boolean
  uploadLogo: (files: FileList | null) => void
  social: SpaceView['publicSocial']
  setSocial: (v: SpaceView['publicSocial']) => void
}) {
  const { tagline, setTagline, logoId, setLogoId, logoBusy, uploadLogo, social, setSocial } = props
  return (
    <>
      {props.socialOnly ? (
        <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
          Links to your other web presence. When set, the wiki header centers its search box and
          shows these on the right.
        </p>
      ) : (
        <>
          <Field
            label="Tagline (shown under the site title)"
            value={tagline}
            onChange={setTagline}
          />
          <div className="mb-4 flex items-center gap-3">
            <span className="text-sm font-medium">Logo</span>
            {logoId ? (
              <>
                <img
                  src={`/api/files/${logoId}/thumb`}
                  alt="logo"
                  className="h-9 w-auto rounded"
                  style={{ background: 'var(--bg)' }}
                />
                <button
                  type="button"
                  className="text-xs underline"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => setLogoId(null)}
                >
                  remove
                </button>
              </>
            ) : (
              <label
                className="text-xs underline cursor-pointer"
                style={{ color: 'var(--text-2)' }}
              >
                {logoBusy ? 'uploading…' : '+ upload logo'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={logoBusy}
                  onChange={(e) => uploadLogo(e.target.files)}
                />
              </label>
            )}
          </div>
        </>
      )}
      <div className="mb-4">
        <span className="block text-sm font-medium mb-1">Social links (header)</span>
        {social.map((link, i) => (
          <div key={`${link.platform}-${String(i)}`} className="flex gap-2 mb-1.5">
            <select
              className="rounded-lg border px-2 py-1.5 text-xs"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              value={link.platform}
              onChange={(e) =>
                setSocial(
                  social.map((l, j) =>
                    j === i
                      ? { ...l, platform: e.target.value as (typeof social)[number]['platform'] }
                      : l,
                  ),
                )
              }
            >
              {SOCIAL_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
            <input
              className="flex-1 rounded-lg border px-2 py-1.5 text-xs"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              placeholder={link.platform === 'email' ? 'mailto:you@example.com' : 'https://...'}
              value={link.url}
              onChange={(e) =>
                setSocial(social.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))
              }
            />
            <button
              type="button"
              className="text-xs px-1"
              style={{ color: 'var(--danger)' }}
              title="Remove"
              onClick={() => setSocial(social.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        {social.length < 10 && (
          <button
            type="button"
            className="text-xs underline"
            style={{ color: 'var(--text-2)' }}
            onClick={() => setSocial([...social, { platform: 'github', url: '' }])}
          >
            + add link
          </button>
        )}
      </div>
    </>
  )
}

/**
 * A keyboard/click-friendly reorg dialog — the robust companion to sidebar
 * drag-and-drop. Every control calls the same movePage the tree uses; the list
 * re-derives from the live tree after each move.
 */
function ReorganizeModal(props: {
  spaceId: string
  spaceName: string
  pages: PageMeta[]
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const move = trpc.pages.move.useMutation({
    onSuccess: () => utils.pages.tree.invalidate({ spaceId: props.spaceId }),
  })
  const busy = move.isPending

  const childrenOf = (parentId: string | null) =>
    props.pages.filter((p) => p.parentId === parentId).sort((a, b) => a.position - b.position)

  const rows: Array<{ page: PageMeta; depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    for (const p of childrenOf(parentId)) {
      rows.push({ page: p, depth })
      walk(p.id, depth + 1)
    }
  }
  walk(null, 0)

  const up = (p: PageMeta, i: number) =>
    move.mutate({ pageId: p.id, parentId: p.parentId, index: i - 1 })
  const down = (p: PageMeta, i: number) =>
    move.mutate({ pageId: p.id, parentId: p.parentId, index: i + 1 })
  const indent = (p: PageMeta, prev: PageMeta) =>
    move.mutate({ pageId: p.id, parentId: prev.id, index: 9999 })
  const outdent = (p: PageMeta) => {
    const parent = props.pages.find((x) => x.id === p.parentId)
    if (!parent) return
    const gp = childrenOf(parent.parentId)
    move.mutate({
      pageId: p.id,
      parentId: parent.parentId,
      index: gp.findIndex((x) => x.id === parent.id) + 1,
    })
  }

  // drag-and-drop inside the dialog, same gestures as the sidebar tree
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; zone: DropZone } | null>(null)
  const drop = (draggedId: string, targetId: string, zone: DropZone) => {
    if (draggedId === targetId) return
    const target = props.pages.find((p) => p.id === targetId)
    if (!target) return
    if (zone === 'inside') {
      move.mutate({ pageId: draggedId, parentId: target.id, index: 9999 })
      return
    }
    const sibs = childrenOf(target.parentId).filter((p) => p.id !== draggedId)
    const ti = sibs.findIndex((p) => p.id === targetId)
    move.mutate({
      pageId: draggedId,
      parentId: target.parentId,
      index: zone === 'before' ? ti : ti + 1,
    })
  }

  return (
    <Modal title={`Reorganize — ${props.spaceName}`} onClose={props.onClose} width="lg">
      <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
        Drag a row to reorder or nest it (drop on the top/bottom edge to reorder, on the middle to
        nest). Or use the buttons: ↑ ↓ within a level, → to indent under the page above, ← to
        outdent.
      </p>
      <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
        {rows.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            No pages yet.
          </p>
        )}
        {rows.map(({ page, depth }) => {
          const sibs = childrenOf(page.parentId)
          const i = sibs.findIndex((x) => x.id === page.id)
          const prev = sibs[i - 1]
          const zone = over?.id === page.id && dragId !== page.id ? over?.zone : undefined
          return (
            <div
              key={page.id}
              className="flex items-center gap-1 py-1 border-b"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                setDragId(page.id)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOver(null)
              }}
              onDragOver={(e) => {
                if (!dragId || dragId === page.id) return
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                const y = e.clientY - r.top
                const z: DropZone =
                  y < r.height * 0.3 ? 'before' : y > r.height * 0.7 ? 'after' : 'inside'
                if (over?.id !== page.id || over?.zone !== z) setOver({ id: page.id, zone: z })
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId) drop(dragId, page.id, over?.zone ?? 'inside')
                setDragId(null)
                setOver(null)
              }}
              style={{
                borderColor: 'var(--border)',
                paddingLeft: depth * 18,
                background: zone === 'inside' ? 'var(--accent-soft)' : undefined,
                boxShadow:
                  zone === 'before'
                    ? 'inset 0 2px 0 var(--accent)'
                    : zone === 'after'
                      ? 'inset 0 -2px 0 var(--accent)'
                      : undefined,
                opacity: dragId === page.id ? 0.4 : 1,
              }}
            >
              <span
                className="cursor-grab select-none"
                style={{ color: 'var(--text-3)' }}
                title="Drag to move"
              >
                ⠿
              </span>
              <span className="truncate flex-1 text-sm" title={page.title}>
                <PagePrefix page={page} />
                {page.title || 'Untitled'}
              </span>
              <ReorgBtn
                label="↑"
                title="Move up"
                disabled={busy || i <= 0}
                onClick={() => up(page, i)}
              />
              <ReorgBtn
                label="↓"
                title="Move down"
                disabled={busy || i >= sibs.length - 1}
                onClick={() => down(page, i)}
              />
              <ReorgBtn
                label="→"
                title="Indent — nest under the page above"
                disabled={busy || !prev}
                onClick={() => prev && indent(page, prev)}
              />
              <ReorgBtn
                label="←"
                title="Outdent — lift out to the parent's level"
                disabled={busy || !page.parentId}
                onClick={() => outdent(page)}
              />
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function ReorgBtn(props: {
  label: string
  title: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className="w-6 h-6 rounded border text-xs disabled:opacity-30"
      style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
    >
      {props.label}
    </button>
  )
}

/** The page's own icon if set, else the blog/gallery fallback glyph. */
function PagePrefix(props: { page: PageMeta }) {
  const { page } = props
  if (page.icon) return <PageIcon icon={page.icon} className="mr-1.5" />
  const g = page.pageType === 'blog' ? '📰 ' : page.pageType === 'gallery' ? '🖼 ' : ''
  return <>{g}</>
}

function PageTreeLevel(props: {
  pages: PageMeta[]
  parentId: string | null
  depth: number
  category: SpaceCategory
  dnd: TreeDnd
  onAddChild: (parentId: string | null) => void
  onAction: (a: PageAction) => void
}) {
  const params = useParams({ strict: false }) as { pageId?: string }
  const { dnd } = props
  const level = props.pages
    .filter((p) => p.parentId === props.parentId)
    .sort((a, b) => a.position - b.position)

  if (level.length === 0) return null
  return (
    <div>
      {level.map((page) => {
        const isOver = dnd.over?.id === page.id && dnd.dragId !== page.id
        const zone = isOver ? dnd.over?.zone : undefined
        return (
          <div key={page.id}>
            <div
              className="group flex items-center gap-1 pr-2 py-0.5 rounded text-sm hover:bg-black/5 dark:hover:bg-white/5"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                dnd.setDragId(page.id)
              }}
              onDragEnd={dnd.clear}
              onDragOver={(e) => {
                if (!dnd.dragId || dnd.dragId === page.id) return
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                const y = e.clientY - r.top
                const z: DropZone =
                  y < r.height * 0.3 ? 'before' : y > r.height * 0.7 ? 'after' : 'inside'
                if (dnd.over?.id !== page.id || dnd.over?.zone !== z)
                  dnd.setOver({ id: page.id, zone: z })
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dnd.dragId) dnd.drop(dnd.dragId, page.id, dnd.over?.zone ?? 'inside')
                dnd.clear()
              }}
              style={{
                paddingLeft: `${26 + props.depth * 14}px`,
                background:
                  zone === 'inside'
                    ? 'var(--accent-soft)'
                    : params.pageId === page.id
                      ? 'var(--accent-soft)'
                      : undefined,
                color: params.pageId === page.id ? 'var(--accent)' : 'var(--text-2)',
                boxShadow:
                  zone === 'before'
                    ? 'inset 0 2px 0 var(--accent)'
                    : zone === 'after'
                      ? 'inset 0 -2px 0 var(--accent)'
                      : undefined,
                opacity: dnd.dragId === page.id ? 0.4 : 1,
              }}
            >
              <Link
                to="/p/$pageId"
                params={{ pageId: page.id }}
                className="truncate flex-1"
                title={page.title}
              >
                <PagePrefix page={page} />
                {page.title}
              </Link>
              <span className="hidden group-hover:flex items-center gap-0.5">
                <AddButton page={page} onAdd={props.onAddChild} />
                <PageMenu page={page} category={props.category} onAction={props.onAction} />
              </span>
            </div>
            <PageTreeLevel
              pages={props.pages}
              parentId={page.id}
              depth={props.depth + 1}
              category={props.category}
              dnd={dnd}
              onAddChild={props.onAddChild}
              onAction={props.onAction}
            />
          </div>
        )
      })}
    </div>
  )
}

/** The per-page ＋: choose whether the new page is a sibling or a child. */
function AddButton(props: { page: PageMeta; onAdd: (parentId: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const item = 'block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5'
  return (
    <span className="relative">
      <button
        type="button"
        title="Add a page"
        className="text-xs px-0.5"
        onClick={() => setOpen(!open)}
      >
        ＋
      </button>
      {open && (
        <div
          className="absolute right-0 top-5 z-40 w-32 rounded-lg border py-1 text-sm shadow-sm"
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            className={item}
            style={{ color: 'var(--text)' }}
            onClick={() => {
              setOpen(false)
              props.onAdd(props.page.parentId)
            }}
          >
            Add sibling
          </button>
          <button
            type="button"
            className={item}
            style={{ color: 'var(--text)' }}
            onClick={() => {
              setOpen(false)
              props.onAdd(props.page.id)
            }}
          >
            Add child
          </button>
        </div>
      )}
    </span>
  )
}

function PageMenu(props: {
  page: PageMeta
  category: SpaceCategory
  onAction: (a: PageAction) => void
}) {
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
  const trash = trpc.pages.delete.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.pages.tree.invalidate({ spaceId: props.page.spaceId }),
        utils.pages.trashed.invalidate(),
        utils.tasks.agenda.invalidate(),
        utils.pins.list.invalidate(),
      ]),
  })
  const navigate = useNavigate()
  const duplicate = trpc.pages.duplicate.useMutation({
    onSuccess: (copy) => {
      utils.pages.tree.invalidate({ spaceId: props.page.spaceId })
      navigate({ to: '/p/$pageId', params: { pageId: copy.id } })
    },
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
            onClick={() => {
              setOpen(false)
              duplicate.mutate({ pageId: props.page.id })
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--text)' }}
            title="Snapshot this page's content as a reusable starting point"
            onClick={() => {
              setOpen(false)
              props.onAction({ kind: 'template', page: props.page })
            }}
          >
            Save as template
          </button>
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
            title="Moves to Trash; restore within 30 days, then it purges"
            onClick={() => {
              setOpen(false)
              trash.mutate({ pageId: props.page.id })
            }}
          >
            Delete
          </button>
          {pageTypesByCategory[props.category]
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

function SaveTemplateModal(props: { page: PageMeta; onClose: () => void }) {
  const utils = trpc.useUtils()
  const create = trpc.templates.create.useMutation()
  const [name, setName] = useState(props.page.title)
  const { busy, error, onSubmit } = useSubmit(async () => {
    await create.mutateAsync({ pageId: props.page.id, name: name.trim() })
    await utils.templates.list.invalidate()
    props.onClose()
  })
  return (
    <Modal title="Save as template" onClose={props.onClose} dirty={name !== props.page.title}>
      <form onSubmit={onSubmit}>
        <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
          Snapshots this page&apos;s current content. Empty pages will offer it as a starting point.
        </p>
        <Field label="Template name" value={name} onChange={setName} autoFocus />
        <ErrorNote message={error} />
        <SubmitButton label="Save template" busy={busy} />
      </form>
    </Modal>
  )
}
