import { createEffect, createSignal, onMount } from "solid-js";
import {
  readLocalStorage,
  writeLocalStorage
} from "../../../shared/lib/storage/safe-local-storage";
import {
  TYPE_SCALE_DEFAULT,
  TYPE_SCALE_DEFAULT_POSITION,
  TYPE_SCALE_MAX,
  TYPE_SCALE_MIN,
  TYPE_SCALE_STEP,
  resolveStoredTypeScale
} from "./type-scale";

const STORAGE_KEY = "sandpaper:type-scale";

export const createTypeScale = () => {
  const [typeScale, setTypeScale] = createSignal(TYPE_SCALE_DEFAULT);

  createEffect(() => {
    document.documentElement.style.setProperty("--type-scale", String(typeScale()));
    writeLocalStorage(STORAGE_KEY, String(typeScale()));
  });

  onMount(() => {
    const savedScale = resolveStoredTypeScale(readLocalStorage(STORAGE_KEY));
    if (savedScale !== null) {
      setTypeScale(savedScale);
    }
  });

  return {
    typeScale,
    setTypeScale,
    min: TYPE_SCALE_MIN,
    max: TYPE_SCALE_MAX,
    step: TYPE_SCALE_STEP,
    defaultPosition: TYPE_SCALE_DEFAULT_POSITION
  };
};
