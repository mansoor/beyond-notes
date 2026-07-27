import type {
  AnalyticsProviderName,
  LockPolicyView,
  PageMeta,
  SiteLogoSize,
  SiteTitleSize,
  SpaceCategory,
  SpaceView,
} from '@bn/schema'
import {
  SITE_LOGO_PX,
  SITE_TITLE_PX,
  pageAfterRemoval,
  pageSubtreeIds,
  pageTypesByCategory,
  socialPlatform,
} from '@bn/schema'

const SOCIAL_PLATFORMS = socialPlatform.options
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import {
  ErrorNote,
  Field,
  Modal,
  PageIcon,
  SubmitButton,
  useMenuAnchor,
  useSubmit,
} from './components'
import { ImportModal } from './import'
import { LockModal, UnlockModal, useLockState } from './locks'
import {
  KIND_ICON,
  KIND_LABEL,
  catToken,
  spaceLabel,
  spaceToken,
  useCollapsibleGroup,
  useSidebarPrefs,
} from './sidebarprefs'
import { trpc } from './trpc'

const CATEGORY_LABEL: Record<SpaceCategory, string> = {
  wiki: 'Wikis',
  notebook: 'Notebooks',
  site: 'Sites',
}

/**
 * Where a published space actually lives right now.
 *
 * The domain is what you *want* it served at; whether DNS points here yet is
 * something the browser can't know. So a name that looks routable gets linked
 * directly, and anything else (a bare word, localhost) falls back to the
 * always-works /s/<domain>/ path this instance serves itself.
 */
export function publicUrlFor(domain: string): { href: string; live: boolean } {
  const looksRoutable = domain.includes('.') && !/^(localhost|127\.|0\.0\.0\.0)/.test(domain)
  return looksRoutable
    ? { href: `https://${domain}`, live: true }
    : { href: `/s/${domain}/`, live: false }
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
  const prefs = useSidebarPrefs()
  // null = closed; otherwise the kind the New space dialog opens on
  const [creating, setCreating] = useState<NewKind | null>(null)

  // hidden sections leave the sidebar entirely; Settings › Appearance is the
  // only place they can be brought back, so nothing here hints at them
  const groups: SpaceCategory[] = (['notebook', 'site', 'wiki'] as SpaceCategory[]).filter(
    (cat) => !prefs.isHidden(catToken(cat)),
  )

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setCreating('notebook')}
        className="text-left text-sm px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5"
        style={{ color: 'var(--text-3)' }}
      >
        ＋ New space
      </button>
      {groups.map((cat) => {
        const inGroup = (spaces.data ?? []).filter(
          (s) => s.category === cat && !prefs.isHidden(spaceToken(s.id)),
        )
        return (
          <div key={cat}>
            <div
              className="text-[11px] uppercase tracking-wide font-semibold mb-1 px-2 flex items-center gap-1.5"
              style={{ color: 'var(--text-3)' }}
            >
              <PageIcon icon={KIND_ICON[cat]} className="text-[13px]" />
              {CATEGORY_LABEL[cat]}
              <button
                type="button"
                title={`New ${cat}`}
                className="ml-auto text-xs px-1"
                onClick={() => setCreating(cat)}
              >
                ＋
              </button>
            </div>
            {inGroup.map((space) => (
              <SpaceItem key={space.id} space={space} />
            ))}
            {inGroup.length === 0 ? (
              <button
                type="button"
                className="text-xs px-2 py-0.5 underline"
                style={{ color: 'var(--text-3)' }}
                onClick={() => setCreating(cat)}
              >
                none yet — create one
              </button>
            ) : null}
          </div>
        )
      })}
      {creating && <NewSpaceModal preset={creating} onClose={() => setCreating(null)} />}
    </div>
  )
}

/** The four things "new space" can mean. A database is not a page tree, but it
 * is a top-level container the sidebar creates, so it belongs in the same door. */
type NewKind = SpaceCategory | 'database'

const KIND_BLURB: Record<NewKind, string> = {
  notebook: 'A private tree of notes. Publishable later if you ever want it to be.',
  wiki: 'A tree of pages built to be read — docs layout, left nav, breadcrumbs, on-this-page.',
  site: 'A website: home page, blog with RSS, galleries, tags, share buttons.',
  database: 'Spreadsheet-style tables you can publish as a form or embed read-only.',
}

/**
 * One door for every top-level container, asking for what that kind actually
 * needs: a wiki or site can be pointed at its public host here rather than
 * making you find the publishing dialog afterwards, a database can start with
 * its first table, and anything page-shaped can hand straight over to the
 * importer instead of being created empty.
 */
export function NewSpaceModal(props: { preset?: NewKind; onClose: () => void }) {
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const createSpace = trpc.spaces.create.useMutation()
  const createDatabase = trpc.databases.create.useMutation()
  const createTable = trpc.tables.create.useMutation()
  const updatePublishing = trpc.publish.updateSpace.useMutation()

  const [kind, setKind] = useState<NewKind>(props.preset ?? 'notebook')
  const [name, setName] = useState('')
  const [personal, setPersonal] = useState(false)
  const [publishNow, setPublishNow] = useState(false)
  const [host, setHost] = useState('')
  const [siteTitle, setSiteTitle] = useState('')
  const [tagline, setTagline] = useState('')
  const [firstTable, setFirstTable] = useState('')
  const [importAfter, setImportAfter] = useState(false)
  // set once the space exists and the importer should take over
  const [importInto, setImportInto] = useState<SpaceView | null>(null)

  const publishable = kind === 'wiki' || kind === 'site'
  const importable = kind !== 'database'
  const prefs = useSidebarPrefs()
  const kindHidden = prefs.isHidden(catToken(kind))

  const { busy, error, onSubmit } = useSubmit(async () => {
    if (kind === 'database') {
      const database = await createDatabase.mutateAsync({ name, personal })
      if (firstTable.trim()) {
        await createTable.mutateAsync({ databaseId: database.id, name: firstTable.trim() })
      }
      await utils.databases.list.invalidate()
      await utils.tables.list.invalidate()
      props.onClose()
      return
    }

    const space = await createSpace.mutateAsync({ name, category: kind, personal })
    if (publishable && publishNow && host.trim()) {
      await updatePublishing.mutateAsync({
        spaceId: space.id,
        enabled: true,
        host: host.trim(),
        title: siteTitle.trim() || name,
        footer: null,
        theme: 'paper',
        appearance: 'auto',
        social: [],
        logoAttachmentId: null,
        tagline: kind === 'site' ? tagline.trim() || null : null,
        headerLayout: 'classic',
      })
    }
    await utils.spaces.list.invalidate()
    if (importAfter) {
      // hand over to the importer rather than leaving an empty space behind
      setImportInto(space)
      return
    }
    props.onClose()
    navigate({ to: '/' })
  })

  if (importInto) {
    return (
      <ImportModal
        space={importInto}
        onClose={() => {
          setImportInto(null)
          props.onClose()
        }}
      />
    )
  }

  const dirty = name.trim() !== '' || personal || publishNow || importAfter

  return (
    <Modal title="New space" onClose={props.onClose} dirty={dirty} width="lg">
      <form onSubmit={onSubmit}>
        <span className="block text-sm font-medium mb-1">Kind</span>
        <div className="flex flex-wrap gap-1 mb-2">
          {(['notebook', 'wiki', 'site', 'database'] as NewKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className="px-3 py-1.5 rounded-lg text-sm border capitalize flex items-center gap-1.5"
              style={{
                borderColor: kind === k ? 'var(--accent)' : 'var(--border)',
                color: kind === k ? 'var(--accent)' : 'var(--text-2)',
              }}
            >
              <PageIcon icon={KIND_ICON[k]} className="text-[15px]" />
              {k}
            </button>
          ))}
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
          {KIND_BLURB[kind]}
        </p>

        {kindHidden ? (
          // creating into a hidden section is allowed — it would just land
          // somewhere you cannot see, so say so and offer the one-click fix
          <p
            className="text-sm mb-4 rounded-lg border p-2 flex items-center gap-2 flex-wrap"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
          >
            <span>
              <b>{KIND_LABEL[kind]}</b> is hidden in your sidebar, so this will not appear there.
            </span>
            <button
              type="button"
              className="underline"
              style={{ color: 'var(--accent)' }}
              disabled={prefs.saving}
              onClick={() => prefs.setHidden(catToken(kind), false)}
            >
              Show {KIND_LABEL[kind]} again
            </button>
          </p>
        ) : null}

        <Field label="Name" value={name} onChange={setName} autoFocus />

        <label className="flex items-center gap-2 mb-4 text-sm">
          <input
            type="checkbox"
            checked={personal}
            onChange={(e) => setPersonal(e.target.checked)}
          />
          Personal (only you can see it)
        </label>

        {publishable ? (
          <>
            <label className="flex items-center gap-2 mb-1 text-sm">
              <input
                type="checkbox"
                checked={publishNow}
                onChange={(e) => setPublishNow(e.target.checked)}
              />
              {kind === 'wiki' ? 'Publish as a docs site' : 'Publish as a website'}
            </label>
            {publishNow ? (
              <div className="pl-6 mb-3">
                <Field
                  label="Public domain"
                  value={host}
                  onChange={setHost}
                  placeholder="docs.example.com"
                />
                <Field
                  label="Site title"
                  value={siteTitle}
                  onChange={setSiteTitle}
                  placeholder={name || 'Shown in the header and browser tab'}
                />
                {kind === 'site' ? (
                  <Field
                    label="Tagline (optional)"
                    value={tagline}
                    onChange={setTagline}
                    placeholder="One line under the title"
                  />
                ) : null}
                <p className="text-xs mb-2" style={{ color: 'var(--text-3)' }}>
                  Pages still arrive as drafts — the space being public only means a published page
                  can be served. Before DNS exists, read it at{' '}
                  <code>/s/{host || 'your-domain'}/</code>.
                </p>
              </div>
            ) : (
              <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
                Stays private. You can turn this on later from the space's ⋯ menu.
              </p>
            )}
          </>
        ) : null}

        {kind === 'database' ? (
          <Field
            label="First table (optional)"
            value={firstTable}
            onChange={setFirstTable}
            placeholder="Contacts"
          />
        ) : null}

        {importable ? (
          <>
            <label className="flex items-center gap-2 mb-1 text-sm">
              <input
                type="checkbox"
                checked={importAfter}
                onChange={(e) => setImportAfter(e.target.checked)}
              />
              Import content into it — a markdown file or a GitHub repository
            </label>
            <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
              {importAfter
                ? 'Creating it opens the importer, where you review the proposed pages before anything is written.'
                : 'Starts empty. You can import into it later from the space’s ⋯ menu.'}
            </p>
          </>
        ) : null}

        <ErrorNote message={error} />
        <SubmitButton
          label={importAfter ? 'Create and choose a source' : `Create ${kind}`}
          busy={busy || name.trim() === ''}
        />
      </form>
    </Modal>
  )
}

function SpaceItem(props: { space: SpaceView }) {
  const utils = trpc.useUtils()
  const [savedExpanded, toggleExpanded] = useCollapsibleGroup(props.space.id)
  const spaceLock = useLockState('space', props.space.id)
  /** locked and not opened this session: every write inside will be refused */
  const shut = Boolean(spaceLock && !spaceLock.open)
  const [unlockOpen, setUnlockOpen] = useState(false)
  // a shut space always shows collapsed — its structure is part of what the
  // lock hides — and the only way past the caret is the password.
  const expanded = savedExpanded && !shut
  const onToggle = () => {
    if (shut) setUnlockOpen(true)
    else toggleExpanded()
  }
  const tree = trpc.pages.tree.useQuery({ spaceId: props.space.id }, { enabled: expanded })
  const createPage = trpc.pages.create.useMutation()
  const navigate = useNavigate()
  const [action, setAction] = useState<PageAction>(null)
  const [publishingOpen, setPublishingOpen] = useState(false)
  const [reorgOpen, setReorgOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [lockOpen, setLockOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  /**
   * `afterPageId` places the new page directly below that sibling — what the
   * per-page ＋ means by "Add sibling". The space-level ＋ passes nothing and
   * lands at the bottom of the notebook.
   */
  const addPage = async (parentId: string | null, afterPageId: string | null = null) => {
    const page = await createPage.mutateAsync({
      spaceId: props.space.id,
      parentId,
      title: '',
      afterPageId,
    })
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
        <button type="button" onClick={onToggle} className="w-4 text-xs">
          {expanded ? '▾' : '▸'}
        </button>
        <button
          type="button"
          className="truncate select-none cursor-pointer text-left flex-1 min-w-0"
          onClick={() => {
            // a locked space must be unlocked before its overview (which reads
            // page content into the concept graph) can open
            if (shut) setUnlockOpen(true)
            else navigate({ to: '/space/$spaceId', params: { spaceId: props.space.id } })
          }}
          title={shut ? 'Locked — click to unlock' : 'Open the space overview'}
        >
          {props.space.name}
        </button>
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
        {shut && (
          <button
            type="button"
            title="Locked — enter your password to open it"
            className="text-[11px]"
            style={{ color: 'var(--text-3)' }}
            onClick={() => setUnlockOpen(true)}
          >
            🔒
          </button>
        )}
        {/* a shut lock offers one thing: the key. The server refuses these
            writes anyway, but offering a menu that can only fail is a worse
            way to find that out. */}
        {shut ? (
          <span className="ml-auto" />
        ) : (
          <span className="ml-auto opacity-0 group-hover:opacity-100 flex items-center">
            {props.space.publicEnabled && props.space.publicHost ? (
              <a
                href={publicUrlFor(props.space.publicHost).href}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-1"
                style={{ color: 'var(--text-3)' }}
                title={
                  publicUrlFor(props.space.publicHost).live
                    ? `Open ${props.space.publicHost}`
                    : `Open the preview at /s/${props.space.publicHost}/ — set that domain up in DNS to serve it directly`
                }
              >
                ↗
              </a>
            ) : null}
            <button
              type="button"
              title="New page"
              onClick={() => addPage(null)}
              className="text-xs px-1"
              style={{ color: 'var(--text-3)' }}
            >
              ＋
            </button>
            <SpaceMenu
              space={props.space}
              onLock={() => setLockOpen(true)}
              onPublishing={() => setPublishingOpen(true)}
              onReorganize={() => setReorgOpen(true)}
              onImport={() => setImportOpen(true)}
              onRename={() => setRenameOpen(true)}
              onDelete={() => setDeleteOpen(true)}
            />
          </span>
        )}
      </div>
      {unlockOpen && spaceLock && (
        <UnlockModal
          target="space"
          id={props.space.id}
          name={spaceLabel(props.space)}
          policy={spaceLock.policy}
          onClose={() => setUnlockOpen(false)}
          onOpened={() => setUnlockOpen(false)}
        />
      )}
      {renameOpen && <RenameSpaceModal space={props.space} onClose={() => setRenameOpen(false)} />}
      {lockOpen && (
        <LockModal
          target="space"
          id={props.space.id}
          name={props.space.name}
          current={spaceLock}
          onClose={() => setLockOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteSpaceModal
          space={props.space}
          pageCount={tree.data?.length ?? 0}
          onClose={() => setDeleteOpen(false)}
        />
      )}
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
      {importOpen && <ImportModal space={props.space} onClose={() => setImportOpen(false)} />}
      {expanded && tree.data && (
        <PageTreeLevel
          pages={tree.data}
          parentId={null}
          depth={0}
          category={props.space.category}
          spaceShut={shut}
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

/**
 * Everything you can do to a whole space. These used to be four icons crowding
 * the row; a space also needs rename and delete, and six icons is a puzzle
 * rather than a toolbar.
 */
function SpaceMenu(props: {
  space: SpaceView
  onPublishing: () => void
  onReorganize: () => void
  onImport: () => void
  onRename: () => void
  onDelete: () => void
  onLock: () => void
}) {
  const [open, setOpen] = useState(false)
  const lock = useLockState('space', props.space.id)
  const utils = trpc.useUtils()
  const lockNow = trpc.locks.lockNow.useMutation({ onSuccess: () => utils.locks.list.invalidate() })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuStyle = useMenuAnchor(open, btnRef, 220)

  const item = (label: string, title: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      title={title}
      className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5"
      style={{ color: danger ? 'var(--danger)' : 'var(--text)' }}
      onClick={() => {
        setOpen(false)
        onClick()
      }}
    >
      {label}
    </button>
  )

  return (
    <span className="relative">
      <button
        ref={btnRef}
        type="button"
        className="text-xs px-1"
        title="Space menu"
        style={{ color: 'var(--text-3)' }}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <div
          className="z-50 rounded-lg border py-1 text-sm shadow-lg"
          style={{ ...menuStyle, background: 'var(--panel)', borderColor: 'var(--border)' }}
          onMouseLeave={() => setOpen(false)}
        >
          {(props.space.category === 'site' || props.space.category === 'wiki') && (
            <a
              href={`/s/draft/${props.space.id}`}
              target="_blank"
              rel="noreferrer"
              className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: 'var(--text)' }}
              title="Browse the current unpublished draft in its site theme, before publishing"
              onClick={() => setOpen(false)}
            >
              Preview draft ↗
            </a>
          )}
          {item('Rename', 'Rename this space', props.onRename)}
          {item(
            lock ? 'Remove the lock…' : 'Lock with my password…',
            lock
              ? 'Open it without a password from now on'
              : 'Ask for your account password before opening this space',
            props.onLock,
          )}
          {lock?.open &&
            item('Lock now', 'Close it now, until the password is entered again', () =>
              lockNow.mutate({ target: 'space', id: props.space.id }),
            )}
          {item('Publishing settings', 'Public host, theme, branding', props.onPublishing)}
          {item('Reorganize pages', 'Move and nest pages', props.onReorganize)}
          {item('Import pages…', 'From markdown or a GitHub repository', props.onImport)}
          <a
            href={`/api/export/space/${props.space.id}`}
            download
            className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--text)' }}
            title="Every page as Markdown, images included"
            onClick={() => setOpen(false)}
          >
            Export as Markdown (.zip)
          </a>
          {item('Delete space…', 'Deletes the space and all of its pages', props.onDelete, true)}
        </div>
      )}
    </span>
  )
}

/**
 * The same whole-space actions the sidebar's ⋯ offers, laid out as a vertical
 * menu for the Space Home rail — where the space name lands you. It owns its own
 * modals, so it drops in anywhere with just a space.
 */
export function SpaceActionsPanel(props: { space: SpaceView }) {
  const { space } = props
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const tree = trpc.pages.tree.useQuery({ spaceId: space.id })
  const createPage = trpc.pages.create.useMutation()
  const lock = useLockState('space', space.id)
  const lockNow = trpc.locks.lockNow.useMutation({ onSuccess: () => utils.locks.list.invalidate() })

  const [renameOpen, setRenameOpen] = useState(false)
  const [lockOpen, setLockOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [publishingOpen, setPublishingOpen] = useState(false)
  const [reorgOpen, setReorgOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const addPage = async () => {
    const page = await createPage.mutateAsync({ spaceId: space.id, parentId: null, title: '' })
    await utils.pages.tree.invalidate({ spaceId: space.id })
    navigate({ to: '/p/$pageId', params: { pageId: page.id } })
  }

  const row =
    'block w-full text-left text-sm py-1.5 px-2 rounded hover:bg-black/5 dark:hover:bg-white/5'
  const isSite = space.category === 'site' || space.category === 'wiki'

  return (
    <div>
      <h2 className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
        Space
      </h2>
      <div className="flex flex-col">
        <button
          type="button"
          className={row}
          onClick={addPage}
          disabled={createPage.isPending}
          style={{ color: 'var(--text-2)' }}
        >
          New page
        </button>
        {isSite && (
          <a
            href={`/s/draft/${space.id}`}
            target="_blank"
            rel="noreferrer"
            className={row}
            style={{ color: 'var(--text-2)' }}
          >
            Preview draft ↗
          </a>
        )}
        {space.publicEnabled && space.publicHost && (
          <a
            href={publicUrlFor(space.publicHost).href}
            target="_blank"
            rel="noreferrer"
            className={row}
            style={{ color: 'var(--text-2)' }}
          >
            Open published site ↗
          </a>
        )}
        <button
          type="button"
          className={row}
          onClick={() => setRenameOpen(true)}
          style={{ color: 'var(--text-2)' }}
        >
          Rename
        </button>
        <button
          type="button"
          className={row}
          onClick={() => setLockOpen(true)}
          style={{ color: 'var(--text-2)' }}
        >
          {lock ? 'Remove the lock…' : 'Lock with my password…'}
        </button>
        {lock?.open && (
          <button
            type="button"
            className={row}
            onClick={() => lockNow.mutate({ target: 'space', id: space.id })}
            style={{ color: 'var(--text-2)' }}
          >
            Lock now
          </button>
        )}
        <button
          type="button"
          className={row}
          onClick={() => setPublishingOpen(true)}
          style={{ color: 'var(--text-2)' }}
        >
          Publishing settings
        </button>
        <button
          type="button"
          className={row}
          onClick={() => setReorgOpen(true)}
          style={{ color: 'var(--text-2)' }}
        >
          Reorganize pages
        </button>
        <button
          type="button"
          className={row}
          onClick={() => setImportOpen(true)}
          style={{ color: 'var(--text-2)' }}
        >
          Import pages…
        </button>
        <a
          href={`/api/export/space/${space.id}`}
          download
          className={row}
          style={{ color: 'var(--text-2)' }}
        >
          Export as Markdown (.zip)
        </a>
        <button
          type="button"
          className={row}
          onClick={() => setDeleteOpen(true)}
          style={{ color: 'var(--danger)' }}
        >
          Delete space…
        </button>
      </div>

      {renameOpen && <RenameSpaceModal space={space} onClose={() => setRenameOpen(false)} />}
      {lockOpen && (
        <LockModal
          target="space"
          id={space.id}
          name={space.name}
          current={lock}
          onClose={() => setLockOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteSpaceModal
          space={space}
          pageCount={tree.data?.length ?? 0}
          onClose={() => setDeleteOpen(false)}
        />
      )}
      {publishingOpen && (
        <SpacePublishingModal space={space} onClose={() => setPublishingOpen(false)} />
      )}
      {reorgOpen && tree.data && (
        <ReorganizeModal
          spaceId={space.id}
          spaceName={space.name}
          pages={tree.data}
          onClose={() => setReorgOpen(false)}
        />
      )}
      {importOpen && <ImportModal space={space} onClose={() => setImportOpen(false)} />}
    </div>
  )
}

function RenameSpaceModal(props: { space: SpaceView; onClose: () => void }) {
  const utils = trpc.useUtils()
  const rename = trpc.spaces.rename.useMutation()
  const [name, setName] = useState(props.space.name)
  const { busy, error, onSubmit } = useSubmit(async () => {
    await rename.mutateAsync({ spaceId: props.space.id, name })
    await utils.spaces.list.invalidate()
    props.onClose()
  })
  return (
    <Modal title="Rename space" onClose={props.onClose} dirty={name !== props.space.name}>
      <form onSubmit={onSubmit}>
        <Field label="Name" value={name} onChange={setName} autoFocus />
        <ErrorNote message={error} />
        <SubmitButton label="Rename" busy={busy || name.trim() === ''} />
      </form>
    </Modal>
  )
}

/**
 * Deleting a space takes every page in it, permanently — pages go with the
 * space rather than to Trash, so this asks for the name typed out. The export
 * link is right here because "I wanted a copy first" is the regret this
 * dialog exists to prevent.
 */
function DeleteSpaceModal(props: { space: SpaceView; pageCount: number; onClose: () => void }) {
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const remove = trpc.spaces.delete.useMutation()
  const [typed, setTyped] = useState('')
  const confirmed = typed.trim() === props.space.name
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (!confirmed) return
    await remove.mutateAsync({ spaceId: props.space.id })
    await utils.spaces.list.invalidate()
    props.onClose()
    navigate({ to: '/' })
  })

  return (
    <Modal title={`Delete “${props.space.name}”?`} onClose={props.onClose} dirty={typed !== ''}>
      <form onSubmit={onSubmit}>
        <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
          This deletes the space and{' '}
          <b>
            {props.pageCount} page{props.pageCount === 1 ? '' : 's'}
          </b>{' '}
          inside it, with their history and any published versions. It does not go to Trash and
          cannot be undone.
          {props.space.publicEnabled ? ' The published site stops answering immediately.' : ''}
        </p>
        <p className="text-sm mb-3">
          <a
            href={`/api/export/space/${props.space.id}`}
            download
            className="underline"
            style={{ color: 'var(--accent)' }}
          >
            Download a Markdown copy first
          </a>
        </p>
        <Field
          label={`Type “${props.space.name}” to confirm`}
          value={typed}
          onChange={setTyped}
          autoFocus
        />
        <ErrorNote message={error} />
        <SubmitButton label="Delete permanently" busy={busy || !confirmed} />
      </form>
    </Modal>
  )
}

function SpacePublishingModal(props: { space: SpaceView; onClose: () => void }) {
  const utils = trpc.useUtils()
  const update = trpc.publish.updateSpace.useMutation()
  const s = props.space
  const [enabled, setEnabled] = useState(s.publicEnabled)
  const [maintenance, setMaintenance] = useState(s.publicMaintenance)
  const [host, setHost] = useState(s.publicHost ?? '')
  const [title, setTitle] = useState(s.publicTitle ?? '')
  const [footer, setFooter] = useState(s.publicFooter ?? '')
  const [theme, setTheme] = useState(s.publicTheme)
  const [appearance, setAppearance] = useState(s.publicAppearance)
  const [social, setSocial] = useState<SpaceView['publicSocial']>(s.publicSocial)
  const [logoId, setLogoId] = useState(s.publicLogoAttachmentId)
  const [tagline, setTagline] = useState(s.publicTagline ?? '')
  const [headerLayout, setHeaderLayout] = useState(s.publicHeaderLayout)
  const [titleSize, setTitleSize] = useState(s.publicTitleSize)
  const [logoSize, setLogoSize] = useState(s.publicLogoSize)
  const [faviconId, setFaviconId] = useState(s.publicFaviconAttachmentId)
  const [logoBusy, setLogoBusy] = useState(false)
  const [faviconBusy, setFaviconBusy] = useState(false)

  /** Uploads land in the same store as any other image; we only keep the id. */
  const uploadTo = async (
    files: FileList | null,
    setId: (id: string) => void,
    setBusy: (b: boolean) => void,
  ) => {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) return
      const json = (await res.json()) as { id: string }
      setId(json.id)
    } finally {
      setBusy(false)
    }
  }
  const uploadLogo = (files: FileList | null) => uploadTo(files, setLogoId, setLogoBusy)
  const uploadFavicon = (files: FileList | null) => uploadTo(files, setFaviconId, setFaviconBusy)

  const { busy, error, onSubmit } = useSubmit(async () => {
    await update.mutateAsync({
      spaceId: s.id,
      enabled,
      maintenance: enabled && maintenance,
      host: host.trim() || null,
      title: title.trim() || null,
      footer: footer.trim() || null,
      theme,
      appearance,
      social: social.filter((l) => l.url.trim() !== ''),
      logoAttachmentId: logoId,
      faviconAttachmentId: faviconId,
      tagline: tagline.trim() || null,
      headerLayout,
      titleSize,
      logoSize,
    })
    await utils.spaces.list.invalidate()
    props.onClose()
  })
  const dirty =
    enabled !== s.publicEnabled ||
    maintenance !== s.publicMaintenance ||
    host !== (s.publicHost ?? '') ||
    title !== (s.publicTitle ?? '') ||
    footer !== (s.publicFooter ?? '') ||
    theme !== s.publicTheme ||
    appearance !== s.publicAppearance ||
    JSON.stringify(social) !== JSON.stringify(s.publicSocial) ||
    logoId !== s.publicLogoAttachmentId ||
    tagline !== (s.publicTagline ?? '') ||
    headerLayout !== s.publicHeaderLayout ||
    titleSize !== s.publicTitleSize ||
    logoSize !== s.publicLogoSize ||
    faviconId !== s.publicFaviconAttachmentId

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
    { id: 'analytics', label: 'Analytics', icon: '📈' },
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
                <label className="flex items-center gap-2 mb-3 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  {isSite ? 'Publish this space as a website' : 'Publish this space as a docs site'}
                </label>
                <label
                  className="flex items-center gap-2 mb-1 text-sm"
                  style={{ opacity: enabled ? 1 : 0.5 }}
                >
                  <input
                    type="checkbox"
                    checked={maintenance}
                    disabled={!enabled}
                    onChange={(e) => setMaintenance(e.target.checked)}
                  />
                  Maintenance mode
                </label>
                <p className="text-xs mb-4 pl-6" style={{ color: 'var(--text-3)' }}>
                  Keeps the site online but serves a “back soon” page instead of the content — so
                  the address still works while you take it down for a while.
                </p>
                <Field label="Domain (e.g. docs.example.com)" value={host} onChange={setHost} />
                <Field
                  label="Site title (defaults to the space name)"
                  value={title}
                  onChange={setTitle}
                />
                <Field label="Footer" value={footer} onChange={setFooter} />
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Only pages you explicitly publish appear, and only when every parent is published
                  too. Before DNS points at this instance, read it at /s/&lt;domain&gt;/.
                </p>
              </>
            )}
            {tab === 'analytics' && <AnalyticsTab space={s} />}
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
                    <option value="toggle">Visitor&apos;s choice — show a light/dark switch</option>
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
                siteTitle={title.trim() || s.name}
                tagline={tagline}
                setTagline={setTagline}
                logoId={logoId}
                setLogoId={setLogoId}
                logoBusy={logoBusy}
                uploadLogo={uploadLogo}
                faviconId={faviconId}
                setFaviconId={setFaviconId}
                faviconBusy={faviconBusy}
                uploadFavicon={uploadFavicon}
                titleSize={titleSize}
                setTitleSize={setTitleSize}
                logoSize={logoSize}
                setLogoSize={setLogoSize}
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

/**
 * Analytics for one published site. Nothing is loaded unless a provider is
 * chosen here, and nothing is ever added to the app itself — this only reaches
 * the published snapshot's chrome.
 *
 * Plausible and Umami lead because both can be self-hosted, which keeps a
 * self-hosted site's visitors out of a third party's hands entirely.
 */
function AnalyticsTab(props: { space: SpaceView }) {
  const utils = trpc.useUtils()
  const save = trpc.publish.updateAnalytics.useMutation()
  const [provider, setProvider] = useState<AnalyticsProviderName>(props.space.analyticsProvider)
  const [siteId, setSiteId] = useState(props.space.analyticsSiteId ?? '')
  const [host, setHost] = useState(props.space.analyticsHost ?? '')

  const { busy, error, onSubmit } = useSubmit(async () => {
    await save.mutateAsync({
      spaceId: props.space.id,
      provider,
      siteId: siteId.trim() || null,
      host: host.trim() || null,
    })
    await utils.spaces.list.invalidate()
  })

  const idLabel =
    provider === 'plausible'
      ? 'Site domain in Plausible (e.g. example.com)'
      : provider === 'umami'
        ? 'Website ID'
        : 'Measurement ID (G-XXXXXXX)'

  return (
    <div onSubmit={onSubmit}>
      <label className="block mb-3">
        <span className="block text-sm font-medium mb-1">Provider</span>
        <select
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          value={provider}
          onChange={(e) => setProvider(e.target.value as AnalyticsProviderName)}
        >
          <option value="none">None — no third-party script at all</option>
          <option value="plausible">Plausible — open source, self-hostable</option>
          <option value="umami">Umami — open source, self-hostable</option>
          <option value="ga4">Google Analytics 4</option>
        </select>
      </label>

      {provider !== 'none' ? (
        <>
          <Field label={idLabel} value={siteId} onChange={setSiteId} />
          {provider !== 'ga4' ? (
            <Field
              label="Your own instance (optional)"
              value={host}
              onChange={setHost}
              placeholder={provider === 'plausible' ? 'plausible.io' : 'cloud.umami.is'}
            />
          ) : null}
          <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
            {provider === 'ga4'
              ? 'Google Analytics cannot be self-hosted: your visitors’ browsers will talk to Google. It is here because people ask for it.'
              : 'Leave the instance blank to use the hosted service, or point it at your own server to keep visitor data on your infrastructure.'}
          </p>
        </>
      ) : (
        <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
          Published pages load no analytics, no fonts and no scripts from anywhere else. Choosing a
          provider is the one exception, and it applies to this site only.
        </p>
      )}

      <ErrorNote message={error} />
      <button
        type="button"
        className="rounded-lg px-4 py-2 text-sm text-white"
        style={{ background: 'var(--accent)', opacity: busy ? 0.6 : 1 }}
        disabled={busy}
        onClick={() => onSubmit({ preventDefault: () => {} } as React.FormEvent)}
      >
        {busy ? 'Saving…' : 'Save analytics'}
      </button>
    </div>
  )
}

function BrandingTab(props: {
  /** wikis only render social links in their header, not a logo/tagline */
  socialOnly?: boolean
  siteTitle: string
  tagline: string
  setTagline: (v: string) => void
  logoId: string | null
  setLogoId: (v: string | null) => void
  logoBusy: boolean
  uploadLogo: (files: FileList | null) => void
  faviconId: string | null
  setFaviconId: (v: string | null) => void
  faviconBusy: boolean
  uploadFavicon: (files: FileList | null) => void
  titleSize: SiteTitleSize
  setTitleSize: (v: SiteTitleSize) => void
  logoSize: SiteLogoSize
  setLogoSize: (v: SiteLogoSize) => void
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

          {/* sizes, then what they produce — a header is proportions, and a
              number in a dropdown does not show you those */}
          <div className="mb-2 flex flex-wrap gap-4">
            <label className="block">
              <span className="block text-sm font-medium mb-1">Site title size</span>
              <select
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                value={props.titleSize}
                onChange={(e) => props.setTitleSize(e.target.value as SiteTitleSize)}
              >
                <option value="sm">Small</option>
                <option value="md">Medium</option>
                <option value="lg">Large</option>
                <option value="xl">Extra large</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">Logo height</span>
              <select
                className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                disabled={!logoId}
                value={props.logoSize}
                onChange={(e) => props.setLogoSize(e.target.value as SiteLogoSize)}
              >
                <option value="sm">Small ({SITE_LOGO_PX.sm}px)</option>
                <option value="md">Medium ({SITE_LOGO_PX.md}px)</option>
                <option value="lg">Large ({SITE_LOGO_PX.lg}px)</option>
              </select>
            </label>
          </div>
          <div
            className="mb-4 rounded-lg border p-3 flex items-center gap-3"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
          >
            {logoId && (
              <img
                src={`/api/files/${logoId}`}
                alt=""
                className="w-auto rounded-lg"
                style={{ height: SITE_LOGO_PX[props.logoSize] }}
              />
            )}
            <span className="flex flex-col leading-tight">
              <span
                className="font-bold"
                style={{ fontSize: SITE_TITLE_PX[props.titleSize], lineHeight: 1.25 }}
              >
                {props.siteTitle}
              </span>
              {tagline.trim() && (
                <span className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                  {tagline}
                </span>
              )}
            </span>
          </div>

          <div className="mb-4 flex items-center gap-3">
            <span className="text-sm font-medium">Favicon</span>
            {props.faviconId ? (
              <>
                <img
                  src={`/api/files/${props.faviconId}/thumb`}
                  alt="favicon"
                  className="h-6 w-6 object-contain rounded"
                  style={{ background: 'var(--bg)' }}
                />
                <button
                  type="button"
                  className="text-xs underline"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => props.setFaviconId(null)}
                >
                  remove
                </button>
              </>
            ) : (
              <label
                className="text-xs underline cursor-pointer"
                style={{ color: 'var(--text-2)' }}
              >
                {props.faviconBusy ? 'uploading…' : '+ upload favicon'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={props.faviconBusy}
                  onChange={(e) => props.uploadFavicon(e.target.files)}
                />
              </label>
            )}
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {props.faviconId
                ? 'Shown in the browser tab.'
                : 'Optional — the logo is used when this is empty. A square image works best.'}
            </span>
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
  const merge = trpc.pages.merge.useMutation({
    onSuccess: () => utils.pages.tree.invalidate({ spaceId: props.spaceId }),
  })
  const busy = move.isPending || merge.isPending
  // the row awaiting a "merge into the page above?" confirmation, if any
  const [mergeConfirm, setMergeConfirm] = useState<string | null>(null)

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
        outdent, and the merge icon to fold a page into the one above it (its sub-pages move up too;
        the merged page goes to Trash).
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
              {mergeConfirm === page.id && prev ? (
                <span className="flex items-center gap-1 text-xs">
                  <span
                    className="truncate max-w-[92px]"
                    style={{ color: 'var(--text-3)' }}
                    title={prev.title || 'Untitled'}
                  >
                    into “{prev.title || 'Untitled'}”?
                  </span>
                  <ReorgBtn
                    label="✓"
                    title="Merge — append this page into the one above"
                    disabled={busy}
                    onClick={() => {
                      merge.mutate({ sourceId: page.id, targetId: prev.id })
                      setMergeConfirm(null)
                    }}
                  />
                  <ReorgBtn label="✗" title="Cancel" onClick={() => setMergeConfirm(null)} />
                </span>
              ) : (
                <>
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
                  <ReorgBtn
                    label={
                      <span className="msym" style={{ fontSize: 15, lineHeight: 1 }}>
                        merge
                      </span>
                    }
                    title={
                      prev
                        ? `Merge into “${prev.title || 'Untitled'}” — its content is appended and this page goes to Trash`
                        : 'Nothing above at this level to merge into'
                    }
                    disabled={busy || !prev}
                    onClick={() => setMergeConfirm(page.id)}
                  />
                </>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function ReorgBtn(props: {
  label: React.ReactNode
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
  /** the whole notebook is locked shut: nothing inside it takes a write */
  spaceShut: boolean
  dnd: TreeDnd
  onAddChild: (parentId: string | null, afterPageId?: string | null) => void
  onAction: (a: PageAction) => void
}) {
  const params = useParams({ strict: false }) as { pageId?: string }
  const { dnd } = props
  // one query for the whole tree, deduped by react-query across the recursion
  const locks = trpc.locks.list.useQuery(undefined, { staleTime: 10_000 })
  const pageLock = (id: string) =>
    (locks.data ?? []).find((l) => l.target === 'page' && l.id === id) ?? null
  const level = props.pages
    .filter((p) => p.parentId === props.parentId)
    .sort((a, b) => a.position - b.position)

  if (level.length === 0) return null
  return (
    <div>
      {level.map((page) => {
        const isOver = dnd.over?.id === page.id && dnd.dragId !== page.id
        const zone = isOver ? dnd.over?.zone : undefined
        const own = pageLock(page.id)
        const shut = props.spaceShut || Boolean(own && !own.open)
        return (
          <div key={page.id}>
            <div
              className="group flex items-center gap-1 pr-2 py-0.5 rounded text-sm hover:bg-black/5 dark:hover:bg-white/5"
              draggable={!shut}
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
              {shut ? (
                own && <PageUnlockButton page={page} policy={own.policy} />
              ) : (
                <span className="hidden group-hover:flex items-center gap-0.5">
                  <AddButton page={page} onAdd={props.onAddChild} />
                  <PageMenu page={page} category={props.category} onAction={props.onAction} />
                </span>
              )}
            </div>
            <PageTreeLevel
              pages={props.pages}
              parentId={page.id}
              depth={props.depth + 1}
              category={props.category}
              spaceShut={props.spaceShut}
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

/** A shut page shows the key instead of the ＋ and ⋯ it cannot use. */
function PageUnlockButton(props: { page: PageMeta; policy: LockPolicyView }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        title="Locked — enter your password to open it"
        className="text-[11px] px-1"
        style={{ color: 'var(--text-3)' }}
        onClick={() => setOpen(true)}
      >
        🔒
      </button>
      {open && (
        <UnlockModal
          target="page"
          id={props.page.id}
          name={props.page.title}
          policy={props.policy}
          onClose={() => setOpen(false)}
          onOpened={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** The per-page ＋: choose whether the new page is a sibling or a child. */
function AddButton(props: {
  page: PageMeta
  onAdd: (parentId: string | null, afterPageId?: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuStyle = useMenuAnchor(open, btnRef, 128)
  const item = 'block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5'
  return (
    <span className="relative">
      <button
        ref={btnRef}
        type="button"
        title="Add a page"
        className="text-xs px-0.5"
        onClick={() => setOpen(!open)}
      >
        ＋
      </button>
      {open && (
        <div
          className="z-50 rounded-lg border py-1 text-sm shadow-lg"
          style={{ ...menuStyle, background: 'var(--panel)', borderColor: 'var(--border)' }}
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            className={item}
            style={{ color: 'var(--text)' }}
            onClick={() => {
              setOpen(false)
              // directly below this page, not at the end of its group
              props.onAdd(props.page.parentId, props.page.id)
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
  const showing = useParams({ strict: false }) as { pageId?: string }

  const prefs = useSidebarPrefs()
  /** the Delete row has turned into "Are you sure? Yes/No" */
  const [asking, setAsking] = useState(false)

  /**
   * Archive and trash both take the whole subtree, so the page on screen goes
   * away when it *or any ancestor* is the one acted on. Read the tree now,
   * before the mutation invalidates it — finding the neighbour needs the
   * departing page still in the list to measure from.
   */
  const exitIfShowing = (): (() => void) | null => {
    const all = utils.pages.tree.getData({ spaceId: props.page.spaceId }) ?? []
    const going = new Set(pageSubtreeIds(all, props.page.id))
    if (!showing.pageId || !going.has(showing.pageId)) return null
    const next = pageAfterRemoval(all, props.page.id)
    return () =>
      next
        ? navigate({ to: '/p/$pageId', params: { pageId: next } })
        : navigate({ to: '/space/$spaceId', params: { spaceId: props.page.spaceId } })
  }

  const runDelete = () => {
    setOpen(false)
    const leave = exitIfShowing()
    trash.mutate({ pageId: props.page.id }, { onSuccess: () => leave?.() })
  }

  /** Never leave a half-answered question behind for the next time it opens. */
  const closeMenu = () => {
    setOpen(false)
    setAsking(false)
  }
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuStyle = useMenuAnchor(open, btnRef, 160)
  const duplicate = trpc.pages.duplicate.useMutation({
    onSuccess: (copy) => {
      utils.pages.tree.invalidate({ spaceId: props.page.spaceId })
      navigate({ to: '/p/$pageId', params: { pageId: copy.id } })
    },
  })
  return (
    <span className="relative">
      <button
        ref={btnRef}
        type="button"
        className="text-xs px-0.5"
        title="Page menu"
        onClick={() => (open ? closeMenu() : setOpen(true))}
      >
        ⋯
      </button>
      {open && (
        <div
          className="z-50 rounded-lg border py-1 text-sm shadow-lg"
          style={{ ...menuStyle, background: 'var(--panel)', borderColor: 'var(--border)' }}
          onMouseLeave={closeMenu}
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
              const leave = exitIfShowing()
              archive.mutate({ pageId: props.page.id }, { onSuccess: () => leave?.() })
            }}
          >
            Archive
          </button>
          {asking ? (
            // The confirm replaces the Delete row in place rather than opening a
            // dialog over it — the menu is already a popover, and a second layer
            // for a three-word question is more ceremony than this deserves.
            // text-xs and free to wrap: the menu is a fixed 160px, which this
            // row overflows at the menu's usual size.
            <div className="flex items-center gap-2 px-3 py-1 text-xs">
              <span style={{ color: 'var(--text-2)' }}>Are you sure?</span>
              <button
                type="button"
                className="underline font-medium"
                style={{ color: 'var(--danger)' }}
                onClick={() => {
                  setAsking(false)
                  runDelete()
                }}
              >
                Yes
              </button>
              <button
                type="button"
                className="underline"
                style={{ color: 'var(--text-2)' }}
                onClick={() => setAsking(false)}
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="block w-full text-left px-3 py-1 hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: 'var(--danger)' }}
              title="Moves to Trash; restore within 30 days, then it purges"
              onClick={() => {
                if (prefs.confirmDelete) {
                  setAsking(true)
                  return
                }
                setOpen(false)
                runDelete()
              }}
            >
              Delete
            </button>
          )}
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
