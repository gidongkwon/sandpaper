import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  readLocalStorage,
  writeLocalStorage
} from "../../../shared/lib/storage/safe-local-storage";

export type MotionMode = "full" | "reduced" | "system";

const STORAGE_KEY = "sandpaper:motion-mode";
const REDUCE_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

const resolveStoredMotionMode = (value: string | null): MotionMode => {
  if (value === "full" || value === "reduced" || value === "system") return value;
  return "system";
};

const getSystemPrefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(REDUCE_MEDIA_QUERY).matches;

export const createMotionMode = () => {
  const [motionMode, setMotionMode] = createSignal<MotionMode>(
    resolveStoredMotionMode(readLocalStorage(STORAGE_KEY))
  );
  const [systemPrefersReducedMotion, setSystemPrefersReducedMotion] = createSignal(
    getSystemPrefersReducedMotion()
  );
  const reducedMotion = createMemo(
    () => motionMode() === "reduced" || (motionMode() === "system" && systemPrefersReducedMotion())
  );

  createEffect(() => {
    if (typeof document === "undefined") return;
    const mode = motionMode();
    document.documentElement.dataset.motionMode = mode;
    document.documentElement.dataset.motion = reducedMotion() ? "reduced" : "full";
    writeLocalStorage(STORAGE_KEY, mode);
  });

  onMount(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(REDUCE_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setSystemPrefersReducedMotion(event.matches);
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
    motionMode,
    setMotionMode,
    reducedMotion
  };
};
