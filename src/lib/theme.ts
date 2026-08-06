export const THEME_STORAGE_KEY = "stallorder.theme.preference";

export type InterfaceTheme = "light" | "dark";

export function isInterfaceTheme(value: unknown): value is InterfaceTheme {
  return value === "light" || value === "dark";
}

export function oppositeInterfaceTheme(theme: InterfaceTheme): InterfaceTheme {
  return theme === "dark" ? "light" : "dark";
}

export const initializeThemeScript = `(() => {
  try {
    const stored = window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    const theme = stored === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
})();`;
