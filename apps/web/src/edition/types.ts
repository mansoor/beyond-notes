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

export type WebEdition = {
  name: string
  settingsTabs?: EditionSettingsTab[]
}
