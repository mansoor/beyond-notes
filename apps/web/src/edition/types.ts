/**
 * What an add-on edition can contribute to the web app. The public build uses
 * ./community.ts (contributes nothing); an edition build points the
 * `@bn/edition-web` alias at its own module (BN_EDITION_WEB, see vite.config.ts).
 *
 * This file must stay import-free apart from types, so an edition package can
 * type-check against it without pulling in the app.
 */
import type { ComponentType } from 'react'

export type EditionSettingsTab = {
  /** stable id, also the label if none is given */
  id: string
  label: string
  /** a short glyph, like the core tabs use */
  icon: string
  adminOnly?: boolean
  Component: ComponentType
}

/** The space a publishing tab is about. */
export type PublishingTabSpace = {
  id: string
  name: string
  category: string
  publicEnabled: boolean
  publicHost: string | null
}

/**
 * A tab in a space's Publishing dialog. It renders inside that dialog's form:
 * no <form> of its own, buttons must be type="button", and it saves itself.
 */
export type EditionPublishingTab = {
  id: string
  label: string
  icon: string
  Component: ComponentType<{ space: PublishingTabSpace }>
}

/** The space a space-menu action is about. */
export type ActionSpace = PublishingTabSpace & {
  personal: boolean
  role: 'owner' | 'editor' | 'viewer'
  sharedWithMe: boolean
}

/**
 * An entry in a space's ⋯ menu (sidebar and space page) that opens a dialog.
 * The core supplies the dialog frame; Component is its body.
 */
export type EditionSpaceAction = {
  id: string
  label: string
  hint: string
  /** only the space's owner sees it */
  ownerOnly?: boolean
  /** hide it for this space (e.g. sharing makes no sense for a shared space) */
  hidden?: (space: ActionSpace) => boolean
  Component: ComponentType<{ space: ActionSpace; onClose: () => void }>
}

export type WebEdition = {
  name: string
  /** extra ways to sign in, shown on the sign-in page above the password form */
  signInExtras?: ComponentType
  settingsTabs?: EditionSettingsTab[]
  publishingTabs?: EditionPublishingTab[]
  spaceActions?: EditionSpaceAction[]
}
