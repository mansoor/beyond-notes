import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AcceptInvitePage } from './pages/AcceptInvite'
import { EditorPage } from './pages/Editor'
import { Gate } from './pages/Gate'
import { HomePage } from './pages/Home'

const rootRoute = createRootRoute({ component: () => <Outlet /> })

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: AcceptInvitePage,
})

// pathless layout: everything below requires auth and renders inside the shell
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: Gate,
})

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: HomePage,
})

export const pageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/p/$pageId',
  component: EditorPage,
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([inviteRoute, appRoute.addChildren([indexRoute, pageRoute])]),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
