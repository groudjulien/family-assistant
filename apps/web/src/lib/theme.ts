export type Theme = "light" | "dark";

const KEY = "theme";

/**
 * Le design system est pensé « sombre d'abord » : sans choix mémorisé, on part
 * en sombre. Un `theme=light` explicite reste évidemment respecté.
 */
export function getStoredTheme(): Theme {
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}
