import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { setTheme as setAppTheme } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import {
  readLocalStorage,
  writeLocalStorage
} from "../../../shared/lib/storage/safe-local-storage";

export type ThemeMode = "light" | "dark" | "system";
type EffectiveTheme = "light" | "dark";

const STORAGE_KEY = "sandpaper:theme-mode";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

const resolveStoredThemeMode = (value: string | null): ThemeMode => {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
};

const getSystemPrefersDark = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(DARK_MEDIA_QUERY).matches;

export const createThemeMode = () => {
  const [themeMode, setThemeMode] = createSignal<ThemeMode>("system");
  const [systemPrefersDark, setSystemPrefersDark] = createSignal(getSystemPrefersDark());

  createEffect(() => {
    if (typeof document === "undefined") return;
    const mode = themeMode();
    const effectiveTheme: EffectiveTheme =
      mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.style.colorScheme = effectiveTheme;
    writeLocalStorage(STORAGE_KEY, mode);
    void Promise.resolve(setAppTheme(mode === "system" ? null : mode)).catch(() => {
      // Ignore in browser tests and non-Tauri environments.
    });
    void Promise.resolve(invoke("set_window_theme_effect", { mode, effectiveTheme })).catch(() => {
      // Ignore in browser tests and non-Tauri environments.
    });
  });

  onMount(() => {
    setThemeMode(resolveStoredThemeMode(readLocalStorage(STORAGE_KEY)));
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setSystemPrefersDark(event.matches);
    };

    handleChange(mediaQuery);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      onCleanup(() => mediaQuery.removeEventListener("change", handleChange));
      return;
    }

    if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleChange);
      onCleanup(() => mediaQuery.removeListener(handleChange));
    }
  });

  return {
    themeMode,
    setThemeMode
  };
};
