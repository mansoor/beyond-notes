import { z } from 'zod'

export const emailSchema = z.string().trim().toLowerCase().email().max(254)
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200)
export const nameSchema = z.string().trim().min(1).max(80)

export const setupInput = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
})
export type SetupInput = z.infer<typeof setupInput>

export const loginInput = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
})
export type LoginInput = z.infer<typeof loginInput>

export const createInviteInput = z.object({
  suggestedEmail: emailSchema.optional(),
  role: z.enum(['admin', 'member']).default('member'),
})
export type CreateInviteInput = z.infer<typeof createInviteInput>

export const acceptInviteInput = z.object({
  token: z.string().min(20).max(200),
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
})
export type AcceptInviteInput = z.infer<typeof acceptInviteInput>

export type UserView = {
  id: string
  email: string
  name: string
  role: 'admin' | 'member'
  createdAt: string
}

export type InviteView = {
  id: string
  suggestedEmail: string | null
  role: 'admin' | 'member'
  createdAt: string
  expiresAt: string
  status: 'pending' | 'used' | 'revoked' | 'expired'
}

export type AuthStatus = {
  needsSetup: boolean
  me: UserView | null
}

// ---- spaces & pages (M1) ----

export const spaceCategory = z.enum(['notebook', 'wiki', 'site'])
export type SpaceCategory = z.infer<typeof spaceCategory>

export const createSpaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  category: spaceCategory.default('notebook'),
  personal: z.boolean().default(false),
})
export type CreateSpaceInput = z.infer<typeof createSpaceInput>

export type SpaceView = {
  id: string
  name: string
  category: SpaceCategory
  personal: boolean
  createdAt: string
}

export const createPageInput = z.object({
  spaceId: z.string(),
  parentId: z.string().nullable().default(null),
  title: z.string().trim().max(300).default(''),
})
export type CreatePageInput = z.infer<typeof createPageInput>

export const renamePageInput = z.object({
  pageId: z.string(),
  title: z.string().trim().min(1).max(300),
})

export const movePageInput = z.object({
  pageId: z.string(),
  parentId: z.string().nullable(),
  index: z.number().int().min(0),
})
export type MovePageInput = z.infer<typeof movePageInput>

export const saveDocumentInput = z.object({
  pageId: z.string(),
  // BlockNote block array, JSON-stringified by the client
  content: z.string().max(2_000_000),
  baseUpdatedAt: z.string(),
})
export type SaveDocumentInput = z.infer<typeof saveDocumentInput>

export type PageMeta = {
  id: string
  spaceId: string
  parentId: string | null
  title: string
  position: number
}

export type DocumentView = {
  content: string
  schemaVersion: number
  updatedAt: string
}

// ---- journal, inbox, tasks (M2) ----

export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

export const journalDayInput = z.object({ date: dateKey })
export const journalMonthInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM'),
})

export const captureMemoInput = z.object({
  content: z.string().trim().min(1).max(5000),
})

export const promoteToNoteInput = z.object({
  memoId: z.string(),
  spaceId: z.string(),
})

export const promoteToJournalInput = z.object({
  memoId: z.string(),
  date: dateKey,
})

export const promoteToTaskInput = z.object({
  memoId: z.string(),
})

export const quickAddTaskInput = z.object({
  // free text; a trailing @YYYY-MM-DD token becomes the due date
  text: z.string().trim().min(1).max(500),
})

export const toggleTaskInput = z.object({
  taskId: z.string(),
  checked: z.boolean(),
})

export type MemoView = {
  id: string
  content: string
  createdAt: string
  promotedTo: 'note' | 'journal' | 'task' | null
}

export type TaskView = {
  id: string
  pageId: string
  blockId: string
  text: string
  checked: boolean
  due: string | null
  pageTitle: string
  spaceName: string
  isJournal: boolean
}
