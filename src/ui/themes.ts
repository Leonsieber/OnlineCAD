// The app's color themes. Each id matches a `[data-theme='…']` block in src/styles/app.css;
// `swatch` only feeds the previews in the theme pickers.

export type ThemeId = 'dark' | 'carbon' | 'graphite' | 'ocean' | 'light' | 'paper' | 'contrast';
export type ThemePref = ThemeId | 'system';

export interface ThemeDef {
  id: ThemeId;
  label: string;
  scheme: 'dark' | 'light';
  description: string;
  /** Background, panel, accent, text. */
  swatch: [string, string, string, string];
}

export const THEMES: ThemeDef[] = [
  { id: 'dark', label: 'Midnight', scheme: 'dark', description: 'The original blue-tinted dark theme', swatch: ['#0d0f13', '#15181e', '#4f86ff', '#e6e9ef'] },
  { id: 'carbon', label: 'Carbon', scheme: 'dark', description: 'Neutral near-black with white accents', swatch: ['#0a0a0a', '#121212', '#f5f5f5', '#ededed'] },
  { id: 'graphite', label: 'Graphite', scheme: 'dark', description: 'Soft grey, easy on the eyes for long sessions', swatch: ['#2b2d31', '#33363b', '#3d9cf0', '#eceef1'] },
  { id: 'ocean', label: 'Ocean', scheme: 'dark', description: 'Deep blue-green with a teal accent', swatch: ['#0b1418', '#101c22', '#22c3b4', '#e2eef1'] },
  { id: 'light', label: 'Light', scheme: 'light', description: 'Bright and crisp', swatch: ['#e7eaef', '#f8f9fb', '#2f6bff', '#191c22'] },
  { id: 'paper', label: 'Paper', scheme: 'light', description: 'Warm light tones like a drafting table', swatch: ['#ece7df', '#faf7f2', '#c2571a', '#23201b'] },
  { id: 'contrast', label: 'High contrast', scheme: 'dark', description: 'Maximum contrast for accessibility', swatch: ['#000000', '#000000', '#ffd400', '#ffffff'] },
];

export const THEME_IDS = THEMES.map((t) => t.id);

export function resolveTheme(pref: ThemePref, prefersLight: boolean): ThemeId {
  if (pref === 'system') return prefersLight ? 'light' : 'dark';
  return THEME_IDS.includes(pref) ? pref : 'dark';
}

export const themeDef = (id: ThemeId) => THEMES.find((t) => t.id === id) ?? THEMES[0];
