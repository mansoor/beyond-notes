// PWA install affordance. Modern Chrome no longer shows an automatic install
// banner — a site has to capture `beforeinstallprompt` and offer its own
// button. The event fires once, early, so we grab it at module load into a
// singleton; hooks that mount later (e.g. the About dialog) still see it.

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const standalone = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true)

let deferred: BeforeInstallPromptEvent | null = null
let installed = standalone()
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // keep the browser from doing its own thing; we drive it
    deferred = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    emit()
  })
}

// iOS Safari never fires beforeinstallprompt, so installing there is manual
// (Share → Add to Home Screen) — detect it to show the right instructions.
export const isIOS =
  typeof navigator !== 'undefined' &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !(navigator as unknown as { standalone?: boolean }).standalone

export function useInstallPrompt(): {
  canInstall: boolean
  installed: boolean
  install: () => Promise<void>
} {
  const [, bump] = useState(0)
  useEffect(() => {
    const on = () => bump((n) => n + 1)
    listeners.add(on)
    return () => {
      listeners.delete(on)
    }
  }, [])

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    deferred = null // a prompt event is single-use
    emit()
  }

  return { canInstall: Boolean(deferred), installed, install }
}
