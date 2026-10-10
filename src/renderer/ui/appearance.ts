import { useEffect, useState } from "react";

export type Appearance = { theme: "system" | "light" | "dark"; textSize: number; sidebarWidth: number };
const DEFAULTS: Appearance = { theme: "system", textSize: 14, sidebarWidth: 360 };
const KEY = "grok-harness.desktop-appearance.v2";
export const clampSidebarWidth = (width: number) => Math.min(520, Math.max(280, Math.round(width)));
function read(): Appearance {
  try {
    const current = localStorage.getItem(KEY);
    const saved = JSON.parse(current || localStorage.getItem("grok-harness.desktop-appearance.v1") || "null");
    const width = typeof saved?.sidebarWidth === "number" ? saved.sidebarWidth : DEFAULTS.sidebarWidth;
    return {
      theme: ["system", "light", "dark"].includes(saved?.theme) ? saved.theme : DEFAULTS.theme,
      textSize: [13, 14, 15, 16].includes(saved?.textSize) ? saved.textSize : DEFAULTS.textSize,
      sidebarWidth: clampSidebarWidth(!current && saved && width <= 300 ? width + 100 : width),
    };
  } catch { return DEFAULTS; }
}
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(read);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = appearance.theme === "system" ? media.matches ? "dark" : "light" : appearance.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.platform = window.grok.windowControls?.platform || "browser";
      document.documentElement.style.setProperty("--chat-font-size", `${appearance.textSize}px`);
      document.documentElement.style.setProperty("--sidebar", `${appearance.sidebarWidth}px`);
      void window.grok.windowControls?.setTheme(appearance.theme).catch(() => undefined);
    };
    apply(); media.addEventListener("change", apply);
    try { localStorage.setItem(KEY, JSON.stringify(appearance)); } catch { /* Session-only preferences when storage is unavailable. */ }
    return () => media.removeEventListener("change", apply);
  }, [appearance]);
  return [appearance, setAppearance] as const;
}
