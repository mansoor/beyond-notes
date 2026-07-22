/**
 * Which sidebar sections and items this user keeps out of the way.
 *
 * Hiding is cosmetic, never access control: a hidden section still holds its
 * spaces, still accepts new ones, and comes back with one checkbox. That is why
 * creating something of a hidden kind is allowed — it just warns, and offers to
 * unhide, rather than refusing.
 */

import type { SpaceCategory } from '@bn/schema'
import { trpc } from './trpc'

export type HideableKind = SpaceCategory | 'database'

export const catToken = (kind: HideableKind) => `cat:${kind}`
export const spaceToken = (id: string) => `space:${id}`
export const dbToken = (id: string) => `db:${id}`

export const KIND_LABEL: Record<HideableKind, string> = {
  notebook: 'Notebooks',
  site: 'Sites',
  wiki: 'Wikis',
  database: 'Databases',
}

export function useSidebarPrefs() {
  const utils = trpc.useUtils()
  const status = trpc.auth.status.useQuery()
  const save = trpc.auth.setSidebarHidden.useMutation({
    onSuccess: () => utils.auth.status.invalidate(),
  })
  const saveDays = trpc.auth.setComingUpDays.useMutation({
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
    /** How far ahead the Today page's "Coming up" list looks. */
    comingUpDays: status.data?.me?.comingUpDays ?? 7,
    setComingUpDays: (days: number) => saveDays.mutateAsync({ days }),
    saving: save.isPending || saveDays.isPending,
  }
}
