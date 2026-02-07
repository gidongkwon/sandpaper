export const getSafeLocalStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  const storage = window.localStorage;
  if (!storage) return null;
  if (typeof storage.getItem !== "function") return null;
  if (typeof storage.setItem !== "function") return null;
  return storage;
};

export const readLocalStorage = (key: string) => {
  const storage = getSafeLocalStorage();
  if (!storage) return null;
  return storage.getItem(key);
};

export const writeLocalStorage = (key: string, value: string) => {
  const storage = getSafeLocalStorage();
  if (!storage) return false;
  storage.setItem(key, value);
  return true;
};
