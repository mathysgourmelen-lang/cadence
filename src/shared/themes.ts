// The appearance choices shown in Settings. `native` is what macOS chrome
// (traffic lights, menus, scrollbars, vibrancy) follows for each theme.
export type Appearance = 'system' | 'light' | 'dark' | 'prism' | 'midnight' | 'oled' | 'sepia' | 'frost' | 'contrast'

export interface ThemeInfo {
  value: Appearance
  label: string
  desc: string
  native: 'system' | 'light' | 'dark'
  /** Swatch colours for the picker: background, sidebar, card, text, accent. */
  swatch: { bg: string; side: string; card: string; text: string; accent: string }
}

export const THEMES: ThemeInfo[] = [
  { value: 'system', label: 'Auto', desc: 'Follows macOS', native: 'system', swatch: { bg: 'linear-gradient(135deg, #f5f5f8 0 50%, #0e0e13 50% 100%)', side: 'rgba(127, 127, 140, 0.28)', card: 'rgba(127, 127, 140, 0.32)', text: '#8a8a96', accent: '#ff4f8b' } },
  { value: 'light', label: 'Light', desc: 'Bright and clean', native: 'light', swatch: { bg: '#f5f5f8', side: '#e6e6ee', card: '#ffffff', text: '#17171c', accent: '#e6346f' } },
  { value: 'dark', label: 'Dark', desc: 'The classic', native: 'dark', swatch: { bg: '#0e0e13', side: '#16161d', card: '#1d1d25', text: '#f4f4f7', accent: '#ff4f8b' } },
  { value: 'prism', label: 'Prism', desc: 'Rainbow glass', native: 'dark', swatch: { bg: 'linear-gradient(135deg, #ff5e8a, #ffa45c 30%, #5ef0a8 60%, #4cc9ff 80%, #9a6bff)', side: 'rgba(16, 12, 34, 0.45)', card: 'rgba(255, 255, 255, 0.22)', text: '#ffffff', accent: '#ff7ac6' } },
  { value: 'midnight', label: 'Midnight', desc: 'Deep navy', native: 'dark', swatch: { bg: '#0c1427', side: '#0a1122', card: '#16213b', text: '#e9eefc', accent: '#7d8dff' } },
  { value: 'oled', label: 'OLED black', desc: 'True black', native: 'dark', swatch: { bg: '#000000', side: '#000000', card: '#121214', text: '#f5f5f7', accent: '#ff4f8b' } },
  { value: 'sepia', label: 'Sepia', desc: 'Warm paper', native: 'light', swatch: { bg: '#f6efe0', side: '#ebdfc7', card: '#fbf6ea', text: '#3a2c1d', accent: '#a94a26' } },
  { value: 'frost', label: 'Frost', desc: 'Cool gray', native: 'dark', swatch: { bg: '#2a303b', side: '#232832', card: '#353c49', text: '#e4e9f1', accent: '#8bbfd6' } },
  { value: 'contrast', label: 'High contrast', desc: 'Easiest to read', native: 'dark', swatch: { bg: '#000000', side: '#000000', card: '#000000', text: '#ffffff', accent: '#ffd60a' } }
]

export function themeInfo(a: Appearance): ThemeInfo {
  return THEMES.find((t) => t.value === a) ?? THEMES[0]
}
