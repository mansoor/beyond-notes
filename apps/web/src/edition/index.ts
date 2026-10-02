// resolved at build time: ./community.ts, or an edition's module (vite.config.ts)
import edition from '@bn/edition-web'
import type { WebEdition } from './types'

export type {
  EditionPublishingTab,
  EditionSettingsTab,
  PublishingTabSpace,
  WebEdition,
} from './types'
export const webEdition: WebEdition = edition
