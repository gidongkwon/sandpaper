export const TYPE_SCALE_MIN = 0.8;
export const TYPE_SCALE_MAX = 1.4;
export const TYPE_SCALE_STEP = 0.05;
export const TYPE_SCALE_DEFAULT = 1;
export const TYPE_SCALE_DEFAULT_POSITION = `${(
  ((TYPE_SCALE_DEFAULT - TYPE_SCALE_MIN) / (TYPE_SCALE_MAX - TYPE_SCALE_MIN)) *
  100
).toFixed(2)}%`;

export const resolveStoredTypeScale = (stored: string | null) => {
  if (!stored) return null;
  const parsed = Number.parseFloat(stored);
  if (Number.isNaN(parsed)) return null;
  if (parsed < TYPE_SCALE_MIN || parsed > TYPE_SCALE_MAX) return null;
  return parsed;
};
