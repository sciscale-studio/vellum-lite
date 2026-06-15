export const THEMES = [
  { id: 'light', label: 'Ivory Manuscript', isDark: false, swatch: '#6B4FBB' },
  { id: 'dark', label: 'Nocturne Vellum', isDark: true, swatch: '#B8A4F0' },
] as const;

export type ThemeName = typeof THEMES[number]['id'];

const THEME_SET = new Set<string>(THEMES.map((theme) => theme.id));

export function isThemeName(value: string): value is ThemeName {
  return THEME_SET.has(value);
}

export function isDarkTheme(theme: ThemeName) {
  return THEMES.find((item) => item.id === theme)?.isDark ?? false;
}

export function getAvailableThemes() {
  return THEMES;
}

export function isThemeAvailable(theme: ThemeName) {
  return THEME_SET.has(theme);
}

export function nextTheme(theme: ThemeName) {
  const availableThemes = getAvailableThemes();
  const index = availableThemes.findIndex((item) => item.id === theme);
  const nextIndex = index === -1 ? 0 : (index + 1) % availableThemes.length;
  return availableThemes[nextIndex].id;
}
