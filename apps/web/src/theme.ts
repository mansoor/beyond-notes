// App-wide theme: Light (no class), Dark, Paper. Persisted per browser.

export type AppTheme = 'light' | 'dark' | 'paper'

const KEY = 'bn-theme'
const ORDER: AppTheme[] = ['light', 'dark', 'paper']

export function currentTheme(): AppTheme {
  const stored = localStorage.getItem(KEY)
  return stored === 'dark' || stored === 'paper' ? stored : 'light'
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.classList.toggle('paper', theme === 'paper')
  localStorage.setItem(KEY, theme)
}

export function nextTheme(theme: AppTheme): AppTheme {
  return ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] as AppTheme
}

export const THEME_LABEL: Record<AppTheme, string> = {
  light: 'Light',
  dark: 'Dark',
  paper: 'Paper',
}
