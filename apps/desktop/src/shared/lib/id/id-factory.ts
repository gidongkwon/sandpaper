let nextId = 1;

export const makeLocalId = () => `b${nextId++}`;

export const makeRandomId = () =>
  globalThis.crypto?.randomUUID?.() ?? makeLocalId();
