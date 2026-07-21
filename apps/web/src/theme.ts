// App-wide theme: Light (no class), Dark, Paper. Persisted per browser.

export type AppTheme = 'light' | 'paper' | 'navy' | 'dark'

const KEY = 'bn-theme'
/** Lightest to darkest — the order the picker shows them in. */
export const THEMES: AppTheme[] = ['light', 'paper', 'navy', 'dark']

export function currentTheme(): AppTheme {
  const stored = localStorage.getItem(KEY)
  return THEMES.includes(stored as AppTheme) ? (stored as AppTheme) : 'light'
}

/** Navy is a dark theme too — anything that switches on darkness must ask this,
 * not `classList.contains('dark')`, or it lights up on a dark background. */
export function isDarkTheme(): boolean {
  const root = document.documentElement.classList
  return root.contains('dark') || root.contains('navy')
}

/**
 * Wear a theme without remembering it. The picker previews on hover, so the
 * page has to change straight away and change back on the way out — persisting
 * every hover would leave you with whichever swatch you passed over last.
 */
export function previewTheme(theme: AppTheme): void {
  const root = document.documentElement.classList
  root.toggle('dark', theme === 'dark')
  root.toggle('paper', theme === 'paper')
  root.toggle('navy', theme === 'navy')
}

export function applyTheme(theme: AppTheme): void {
  previewTheme(theme)
  localStorage.setItem(KEY, theme)
}

export const THEME_LABEL: Record<AppTheme, string> = {
  light: 'Light',
  paper: 'Paper',
  navy: 'Midnight navy',
  dark: 'Dark',
}

export const THEME_ICON: Record<AppTheme, string> = {
  light: '☀',
  paper: '❧',
  navy: '☾',
  dark: '●',
}
