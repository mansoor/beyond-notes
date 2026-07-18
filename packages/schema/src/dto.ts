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
