// App-wide theme: Light (no class), Dark, Paper. Persisted per browser.

export type AppTheme = 'light' | 'dark' | 'paper'

const KEY = 'bn-theme'
export const THEMES: AppTheme[] = ['light', 'dark', 'paper']

export function currentTheme(): AppTheme {
  const stored = localStorage.getItem(KEY)
  return stored === 'dark' || stored === 'paper' ? stored : 'light'
}

/**
 * Wear a theme without remembering it. The picker previews on hover, so the
 * page has to change straight away and change back on the way out — persisting
 * every hover would leave you with whichever swatch you passed over last.
 */
export function previewTheme(theme: AppTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.classList.toggle('paper', theme === 'paper')
}

export function applyTheme(theme: AppTheme): void {
  previewTheme(theme)
  localStorage.setItem(KEY, theme)
}

export const THEME_LABEL: Record<AppTheme, string> = {
  light: 'Light',
  dark: 'Dark',
  paper: 'Paper',
}

export const THEME_ICON: Record<AppTheme, string> = {
  light: '☀',
  dark: '☾',
  paper: '❧',
}
