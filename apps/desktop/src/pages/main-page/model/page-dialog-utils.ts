export type PageDialogMode = "new" | "rename" | null;

export type PageDialogAction = {
  type: "create" | "rename";
  value: string;
} | null;

export const getPageDialogTitle = (mode: PageDialogMode) =>
  mode === "rename" ? "Rename page" : "New page title";

export const getPageDialogConfirmLabel = (mode: PageDialogMode) =>
  mode === "rename" ? "Rename" : "Create";

export const isPageDialogDisabled = (
  mode: PageDialogMode,
  value: string,
  currentTitle: string
) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (mode === "rename") {
    return trimmed === currentTitle.trim();
  }
  return false;
};

export const resolvePageDialogAction = (
  mode: PageDialogMode,
  value: string,
  currentTitle: string
): PageDialogAction => {
  if (!mode) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (mode === "rename") {
    if (trimmed === currentTitle.trim()) return null;
    return { type: "rename", value: trimmed };
  }
  return { type: "create", value: trimmed };
};
