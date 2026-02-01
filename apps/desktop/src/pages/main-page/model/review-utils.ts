export const formatReviewDate = (
  timestamp: number | null,
  formatter?: Intl.DateTimeFormat
) => {
  if (!timestamp) return "—";
  const resolved =
    formatter ??
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  return resolved.format(new Date(timestamp));
};
