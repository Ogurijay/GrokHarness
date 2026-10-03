import { useEffect, useState } from "react";

export type Appearance = { theme: "system" | "light" | "dark"; textSize: number; sidebarWidth: number };
const DEFAULTS: Appearance = { theme: "system", textSize: 14, sidebarWidth: 260 };
const KEY = "grok-harness.desktop-appearance.v1";
function read(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    return {
      theme: ["system", "light", "dark"].includes(saved?.theme) ? saved.theme : DEFAULTS.theme,
      textSize: [13, 14, 15, 16].includes(saved?.textSize) ? saved.textSize : DEFAULTS.textSize,
      sidebarWidth: [240, 260, 280, 300].includes(saved?.sidebarWidth) ? saved.sidebarWidth : DEFAULTS.sidebarWidth,
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
