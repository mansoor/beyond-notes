/**
 * Who may do what in a space. Every space check in the app goes through here.
 *
 * - A shared space (no owner) is everyone's: every signed-in person has the
 *   owner's rights, exactly as before sharing existed.
 * - A personal space belongs to its owner. It can also be shared with people
 *   or groups: a viewer reads, an editor also edits pages. Space settings
 *   (rename, delete, publishing, sharing) stay with the owner.
 * - A journal is only ever its owner's; shares never apply to it.
 *
 * Shares and groups are written by an edition (sharing is a paid feature) but
 * enforced here, so they keep working whatever the licence does. They change
 * rarely and are read on almost every request, so they live in a snapshot that
 * writers refresh through invalidate().
 */
import { nanoid } from 'nanoid'
import type { Repo, ShareRole, SpaceRow, SpaceShareRow, UserGroupRow, UserRow } from './repo'

export type SpaceRole = 'owner' | ShareRole
export type Need = 'read' | 'write' | 'owner'

const RANK: Record<SpaceRole, number> = { viewer: 1, editor: 2, owner: 3 }
const NEED_RANK: Record<Need, number> = { read: 1, write: 2, owner: 3 }

type Snapshot = {
  /** userId → spaceId → best share role (direct or through a group) */
  roles: Map<string, Map<string, ShareRole>>
}

export class AccessError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'FORBIDDEN',
    message: string,
  ) {
    super(message)
  }
}

export function createAccess(repo: Repo) {
  let snapshot: Promise<Snapshot> | null = null

  async function build(): Promise<Snapshot> {
    const [shares, members] = await Promise.all([
      repo.listAllSpaceShares(),
      repo.listAllUserGroupMembers(),
    ])
    const usersOf = new Map<string, string[]>()
    for (const m of members) usersOf.set(m.groupId, [...(usersOf.get(m.groupId) ?? []), m.userId])
    const roles = new Map<string, Map<string, ShareRole>>()
    const grant = (userId: string, spaceId: string, role: ShareRole) => {
      let mine = roles.get(userId)
      if (!mine) {
        mine = new Map()
        roles.set(userId, mine)
      }
      const had = mine.get(spaceId)
      if (!had || RANK[role] > RANK[had]) mine.set(spaceId, role)
    }
    for (const s of shares) {
      const people =
        s.principalType === 'user' ? [s.principalId] : (usersOf.get(s.principalId) ?? [])
      for (const userId of people) grant(userId, s.spaceId, s.role)
    }
    return { roles }
  }

  function load(): Promise<Snapshot> {
    if (!snapshot) {
      snapshot = build()
      // a failed read must not stick: the next check tries again
      snapshot.catch(() => {
        snapshot = null
      })
    }
    return snapshot
  }

  function roleWith(snap: Snapshot, space: SpaceRow, user: Pick<UserRow, 'id'>): SpaceRole | null {
    if (space.ownerId === null) return 'owner'
    if (space.ownerId === user.id) return 'owner'
    if (space.kind === 'journal') return null
    return snap.roles.get(user.id)?.get(space.id) ?? null
  }

  const meets = (role: SpaceRole | null, need: Need) =>
    role !== null && RANK[role] >= NEED_RANK[need]

  return {
    /** Drop the snapshot after shares or groups change. */
    invalidate(): void {
      snapshot = null
    },

    async role(space: SpaceRow, user: Pick<UserRow, 'id'>): Promise<SpaceRole | null> {
      return roleWith(await load(), space, user)
    },

    async can(space: SpaceRow | null, user: Pick<UserRow, 'id'>, need: Need): Promise<boolean> {
      return space !== null && meets(roleWith(await load(), space, user), need)
    },

    /**
     * Throws unless the user has `need` in the space. A space they can't even
     * read looks missing; one they can read but not change says so.
     */
    async assert(space: SpaceRow | null, user: Pick<UserRow, 'id'>, need: Need): Promise<SpaceRow> {
      const role = space ? roleWith(await load(), space, user) : null
      if (!space || role === null) throw new AccessError('NOT_FOUND', 'Space not found.')
      if (!meets(role, need)) {
        throw new AccessError(
          'FORBIDDEN',
          need === 'owner'
            ? 'Only the owner can change this space.'
            : 'You can read this space but not change it.',
        )
      }
      return space
    },

    /** A synchronous filter for lists, e.g. spaces.filter(await access.filter(user)). */
    async filter(
      user: Pick<UserRow, 'id'>,
      need: Need = 'read',
    ): Promise<(space: SpaceRow) => boolean> {
      const snap = await load()
      return (space) => meets(roleWith(snap, space, user), need)
    },

    /** Every space's role for this user, for views that show it. */
    async roles(user: Pick<UserRow, 'id'>): Promise<(space: SpaceRow) => SpaceRole | null> {
      const snap = await load()
      return (space) => roleWith(snap, space, user)
    },

    // ---- writes (called by an edition's sharing API) ----

    async share(input: {
      space: SpaceRow
      principalType: 'user' | 'group'
      principalId: string
      role: ShareRole
    }): Promise<void> {
      if (input.space.ownerId === null) {
        throw new AccessError('FORBIDDEN', 'Shared spaces are already open to everyone here.')
      }
      if (input.space.kind === 'journal') {
        throw new AccessError('FORBIDDEN', "A journal can't be shared.")
      }
      if (input.principalType === 'user') {
        if (input.principalId === input.space.ownerId) {
          throw new AccessError('FORBIDDEN', 'That person already owns this space.')
        }
        if (!(await repo.getUserById(input.principalId))) {
          throw new AccessError('NOT_FOUND', 'No such person.')
        }
      } else if (!(await repo.listUserGroups()).some((g) => g.id === input.principalId)) {
        throw new AccessError('NOT_FOUND', 'No such group.')
      }
      await repo.putSpaceShare({
        spaceId: input.space.id,
        principalType: input.principalType,
        principalId: input.principalId,
        role: input.role,
        createdAt: new Date(),
      })
      snapshot = null
    },

    async unshare(spaceId: string, principalType: 'user' | 'group', principalId: string) {
      await repo.deleteSpaceShare(spaceId, principalType, principalId)
      snapshot = null
    },

    async shares(spaceId: string): Promise<SpaceShareRow[]> {
      return repo.listSpaceShares(spaceId)
    },

    async groups(): Promise<Array<UserGroupRow & { memberIds: string[] }>> {
      const [groups, members] = await Promise.all([
        repo.listUserGroups(),
        repo.listAllUserGroupMembers(),
      ])
      return groups
        .map((g) => ({
          ...g,
          memberIds: members.filter((m) => m.groupId === g.id).map((m) => m.userId),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    async createGroup(name: string): Promise<UserGroupRow> {
      const clean = name.trim()
      if (!clean) throw new AccessError('FORBIDDEN', 'A group needs a name.')
      if ((await repo.listUserGroups()).some((g) => g.name.toLowerCase() === clean.toLowerCase())) {
        throw new AccessError('FORBIDDEN', 'There is already a group with that name.')
      }
      const row = { id: nanoid(), name: clean, createdAt: new Date() }
      await repo.insertUserGroup(row)
      return row
    },

    async renameGroup(id: string, name: string): Promise<void> {
      const clean = name.trim()
      if (!clean) throw new AccessError('FORBIDDEN', 'A group needs a name.')
      await repo.renameUserGroup(id, clean)
    },

    async deleteGroup(id: string): Promise<void> {
      await repo.deleteSharesForPrincipal('group', id)
      await repo.deleteUserGroup(id)
      snapshot = null
    },

    async setGroupMember(groupId: string, userId: string, member: boolean): Promise<void> {
      if (member) await repo.addUserGroupMember({ groupId, userId })
      else await repo.removeUserGroupMember(groupId, userId)
      snapshot = null
    },
  }
}

export type AccessService = ReturnType<typeof createAccess>
