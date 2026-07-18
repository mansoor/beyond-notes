import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AcceptInvitePage } from './pages/AcceptInvite'
import { Gate } from './pages/Gate'

const rootRoute = createRootRoute({ component: () => <Outlet /> })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Gate,
})

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: AcceptInvitePage,
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, inviteRoute]),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export { inviteRoute }
