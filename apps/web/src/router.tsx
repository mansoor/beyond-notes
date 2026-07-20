import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AcceptInvitePage } from './pages/AcceptInvite'
import { ArchivePage } from './pages/Archive'
import { EditorPage } from './pages/Editor'
import { Gate } from './pages/Gate'
import { HomePage } from './pages/Home'
import { InboxPage } from './pages/Inbox'
import { JournalPage } from './pages/Journal'
import { ResetPasswordPage } from './pages/ResetPassword'
import { SettingsPage } from './pages/Settings'
import { StalePage } from './pages/Stale'
import { TagsPage } from './pages/Tags'
import { TasksPage } from './pages/Tasks'
import { TrashPage } from './pages/Trash'

const rootRoute = createRootRoute({ component: () => <Outlet /> })

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: AcceptInvitePage,
})

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset/$token',
  component: ResetPasswordPage,
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

const dayRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/day/$date',
  component: JournalPage,
})

const inboxRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/inbox',
  component: InboxPage,
})

const tasksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks',
  component: TasksPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
})

const archiveRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/archive',
  component: ArchivePage,
})

const staleRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/stale',
  component: StalePage,
})

const trashRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/trash',
  component: TrashPage,
})

const tagsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tags',
  component: TagsPage,
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    inviteRoute,
    resetRoute,
    appRoute.addChildren([
      indexRoute,
      pageRoute,
      dayRoute,
      inboxRoute,
      tasksRoute,
      settingsRoute,
      archiveRoute,
      trashRoute,
      staleRoute,
      tagsRoute,
    ]),
  ]),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
