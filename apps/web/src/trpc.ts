import type { AppRouter } from '@bn/server/src/routers'
import { createTRPCReact } from '@trpc/react-query'

export const trpc = createTRPCReact<AppRouter>()
