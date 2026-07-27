/**
 * Which sidebar sections and items this user keeps out of the way.
 *
 * Hiding is cosmetic, never access control: a hidden section still holds its
 * spaces, still accepts new ones, and comes back with one checkbox. That is why
 * creating something of a hidden kind is allowed — it just warns, and offers to
 * unhide, rather than refusing.
 */

import type { AppTheme, GraphEdgeKind, SpaceCategory } from '@bn/schema'
import { useCallback, useEffect, useState } from 'react'
import { trpc } from './trpc'

/** Every graph edge kind, in canonical order — the default when nothing is set. */
export const ALL_GRAPH_EDGES: GraphEdgeKind[] = ['concept', 'link', 'tag', 'relation', 'semantic']

export type HideableKind = SpaceCategory | 'database'

export const catToken = (kind: HideableKind) => `cat:${kind}`
export const spaceToken = (id: string) => `space:${id}`
export const dbToken = (id: string) => `db:${id}`
/** Standalone nav-item links under Today, each hideable on its own. */
export const JOURNAL_NAV_TOKEN = 'nav:journal'
export const TASKS_NAV_TOKEN = 'nav:tasks'
export const TAGS_NAV_TOKEN = 'nav:tags'

/**
 * Which sidebar groups (spaces and databases both) are shown collapsed,
 * remembered in this browser only. We store the *collapsed* set, not the
 * expanded one, so a brand-new group defaults to open without needing an
 * entry — and a wiped/absent key simply means "everything expanded", the old
 * behaviour.
 */
const COLLAPSED_KEY = 'bn-collapsed-spaces'

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? (arr as string[]) : [])
  } catch {
    return new Set()
  }
}

/**
 * Per-group expand state, persisted to localStorage. Returns [expanded, toggle].
 * Keyed by any stable id — a space id or a database id — since the two never
 * collide.
 */
export function useCollapsibleGroup(id: string): [boolean, () => void] {
  const [expanded, setExpanded] = useState(() => !readCollapsed().has(id))
  // reconcile once on mount in case another item wrote the key first
  useEffect(() => {
    setExpanded(!readCollapsed().has(id))
  }, [id])
  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev
      const set = readCollapsed()
      if (next) set.delete(id)
      else set.add(id)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]))
      } catch {
        // private mode or a full quota: the toggle still works this session
      }
      return next
    })
  }, [id])
  return [expanded, toggle]
}

export const KIND_LABEL: Record<HideableKind, string> = {
  notebook: 'Notebooks',
  site: 'Sites',
  wiki: 'Wikis',
  database: 'Databases',
}

/**
 * A Material Symbols ligature per kind, so the sidebar sections and the
 * New-space buttons read at a glance: a book for private notes, a doc for a
 * wiki, a globe for a website, a cylinder for a database.
 */
export const KIND_ICON: Record<HideableKind, string> = {
  notebook: 'book',
  wiki: 'article',
  site: 'public',
  database: 'database',
}

/** Singular type word for one space, e.g. for a dialog title. */
const SPACE_TYPE_LABEL: Record<SpaceCategory, string> = {
  notebook: 'Notebook',
  site: 'Site',
  wiki: 'Wiki',
}

/** "mansoorhussain.com · Site", "Rigger · Wiki" — name plus what it is. */
export const spaceLabel = (s: { name: string; category: SpaceCategory }) =>
  `${s.name} · ${SPACE_TYPE_LABEL[s.category]}`

export function useSidebarPrefs() {
  const utils = trpc.useUtils()
  const status = trpc.auth.status.useQuery()
  const save = trpc.auth.setSidebarHidden.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const saveDays = trpc.auth.setHorizons.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const saveConfirm = trpc.auth.setConfirmDelete.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const saveLinkCapture = trpc.auth.setLinkCaptureFull.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const saveGraph = trpc.auth.setGraphPrefs.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const saveTheme = trpc.auth.setDefaultTheme.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })

  const hidden = new Set(status.data?.me?.sidebarHidden ?? [])

  const setHidden = async (token: string, hide: boolean) => {
    const next = new Set(hidden)
    if (hide) next.add(token)
    else next.delete(token)
    await save.mutateAsync({ hidden: [...next] })
  }

  return {
    hidden,
    isHidden: (token: string) => hidden.has(token),
    /** A section is hidden, or this individual item is. */
    isItemHidden: (kind: HideableKind, token: string) =>
      hidden.has(catToken(kind)) || hidden.has(token),
    setHidden,
    /** How far ahead "Coming up" looks — a horizon each, because a task six
     *  weeks out is noise and a reminder six weeks out is the point. */
    taskDays: status.data?.me?.taskDays ?? 7,
    reminderDays: status.data?.me?.reminderDays ?? 7,
    setHorizons: (horizons: { taskDays?: number; reminderDays?: number }) =>
      saveDays.mutateAsync(horizons),
    /**
     * Whether Delete asks first. Defaults to true while the query is still in
     * flight, so a slow load never turns the guard off — the safe answer is the
     * one to guess with.
     */
    confirmDelete: status.data?.me?.confirmDelete ?? true,
    setConfirmDelete: (enabled: boolean) => saveConfirm.mutateAsync({ enabled }),
    /** Whether a shared link is captured as its full article or just the opener. */
    linkCaptureFull: status.data?.me?.linkCaptureFull ?? true,
    setLinkCaptureFull: (enabled: boolean) => saveLinkCapture.mutateAsync({ enabled }),
    /** Knowledge graph: whether a space name opens its graph overview, and which
     *  edge kinds that graph draws. Defaults to on/all while the query loads. */
    graphEnabled: status.data?.me?.graphEnabled ?? true,
    graphEdges: status.data?.me?.graphEdges ?? ALL_GRAPH_EDGES,
    graphMobile: status.data?.me?.graphMobile ?? true,
    setGraphPrefs: (input: { enabled: boolean; edges: GraphEdgeKind[]; mobile: boolean }) =>
      saveGraph.mutateAsync(input),
    /** The account's default app theme (applied on a device with no local choice). */
    defaultTheme: status.data?.me?.defaultTheme ?? 'light',
    setDefaultTheme: (theme: AppTheme) => saveTheme.mutateAsync({ theme }),
    saving:
      save.isPending ||
      saveDays.isPending ||
      saveConfirm.isPending ||
      saveLinkCapture.isPending ||
      saveGraph.isPending ||
      saveTheme.isPending,
  }
}
