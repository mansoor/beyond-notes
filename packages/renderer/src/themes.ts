// Theme presets are token sets only — never structure (settled decision).
// Every theme has a light and a dark palette; `appearance` decides which the
// visitor gets: 'auto' follows their OS, 'light'/'dark' pin one look. The one
// exception: 'ink' on auto stays dark — always-dark is that theme's identity,
// and existing ink sites must not change under their owners.

export type ThemeName = 'paper' | 'ink' | 'mist' | 'sand' | 'bloom'
export type ThemeAppearance = 'auto' | 'light' | 'dark'

type Tokens = {
  bg: string
  panel: string
  text: string
  text2: string
  text3: string
  border: string
  accent: string
  accentSoft: string
  code: string
}

const LIGHT: Record<ThemeName, Tokens> = {
  ink: {
    bg: '#f7f8fb',
    panel: '#ffffff',
    text: '#1a1d24',
    text2: '#5c6370',
    text3: '#969db0',
    border: '#e2e5ec',
    accent: '#3b5fd9',
    accentSoft: '#e8edfb',
    code: '#eef0f5',
  },
  bloom: {
    bg: '#ffffff',
    panel: '#ffffff',
    text: '#201a24',
    text2: '#6d6377',
    text3: '#a89fb3',
    border: '#ece5f0',
    accent: '#c2318c',
    accentSoft: '#fbe7f3',
    code: '#f7f2f9',
  },
  paper: {
    bg: '#faf9f7',
    panel: '#ffffff',
    text: '#1f1e1b',
    text2: '#6f6b62',
    text3: '#a09a8e',
    border: '#e7e3da',
    accent: '#5b4fc7',
    accentSoft: '#eeecfa',
    code: '#f4f2ee',
  },
  mist: {
    bg: '#f5f8fa',
    panel: '#ffffff',
    text: '#1c2228',
    text2: '#5d6b77',
    text3: '#93a3b0',
    border: '#dde5eb',
    accent: '#2e6fa7',
    accentSoft: '#e7f0f8',
    code: '#eef3f6',
  },
  sand: {
    bg: '#faf4e9',
    panel: '#fffdf8',
    text: '#2b2317',
    text2: '#7a6c55',
    text3: '#ab9d84',
    border: '#eadfc9',
    accent: '#a8652c',
    accentSoft: '#f7ead8',
    code: '#f4ecdc',
  },
}

const DARK: Record<ThemeName, Tokens> = {
  bloom: {
    bg: '#1b161d',
    panel: '#221c26',
    text: '#ece4f0',
    text2: '#a795b3',
    text3: '#71627e',
    border: '#372e3e',
    accent: '#e26ab4',
    accentSoft: '#3a2434',
    code: '#2a2230',
  },
  paper: {
    bg: '#191817',
    panel: '#201f1d',
    text: '#e8e5df',
    text2: '#a39e93',
    text3: '#736e64',
    border: '#34322e',
    accent: '#8478e0',
    accentSoft: '#2a2740',
    code: '#262523',
  },
  ink: {
    bg: '#15161a',
    panel: '#1c1e24',
    text: '#e6e8ee',
    text2: '#9aa0ad',
    text3: '#6b7180',
    border: '#2c2f38',
    accent: '#7aa2f7',
    accentSoft: '#232a3d',
    code: '#22242c',
  },
  mist: {
    bg: '#161b20',
    panel: '#1c2229',
    text: '#e2e8ed',
    text2: '#98a7b3',
    text3: '#66757f',
    border: '#2b343c',
    accent: '#6cb0e8',
    accentSoft: '#1f2f3d',
    code: '#202830',
  },
  sand: {
    bg: '#1d1913',
    panel: '#241f18',
    text: '#ece5d8',
    text2: '#a99c85',
    text3: '#75695a',
    border: '#3a332a',
    accent: '#d99a5b',
    accentSoft: '#332a1e',
    code: '#2a251d',
  },
}

function vars(t: Tokens): string {
  return `--bg:${t.bg};--panel:${t.panel};--text:${t.text};--text2:${t.text2};--text3:${t.text3};--border:${t.border};--accent:${t.accent};--accent-soft:${t.accentSoft};--code:${t.code}`
}

export function themeCss(name: ThemeName, appearance: ThemeAppearance = 'auto'): string {
  if (appearance === 'light') return `:root{${vars(LIGHT[name])}}`
  if (appearance === 'dark') return `:root{${vars(DARK[name])}}`
  if (name === 'ink') return `:root{${vars(DARK.ink)}}` // auto ink = always dark
  return `:root{${vars(LIGHT[name])}}\n@media(prefers-color-scheme:dark){:root{${vars(DARK[name])}}}`
}
