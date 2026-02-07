import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
}

const createStorageShim = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    }
  };
};

if (typeof window !== "undefined") {
  const shim = createStorageShim();
  const maybeStorage = window.localStorage as Partial<Storage> | undefined;
  const hasCompleteApi =
    typeof maybeStorage?.getItem === "function" &&
    typeof maybeStorage?.setItem === "function" &&
    typeof maybeStorage?.removeItem === "function" &&
    typeof maybeStorage?.clear === "function" &&
    typeof maybeStorage?.key === "function";

  if (!hasCompleteApi) {
    try {
      Object.defineProperty(window, "localStorage", {
        value: shim,
        configurable: true
      });
    } catch {
      // Ignore if jsdom prevents redefining this property.
    }
    Object.defineProperty(globalThis, "localStorage", {
      value: shim,
      configurable: true
    });
  } else {
    Object.defineProperty(globalThis, "localStorage", {
      value: maybeStorage,
      configurable: true
    });
  }
}
