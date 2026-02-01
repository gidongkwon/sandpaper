import { createMemo, createSignal, type Accessor, type Setter } from "solid-js";
import {
  getPageDialogConfirmLabel,
  getPageDialogTitle,
  isPageDialogDisabled,
  resolvePageDialogAction,
  type PageDialogMode
} from "./page-dialog-utils";

type PageDialogDeps = {
  pageTitle: Accessor<string>;
  renameTitle: Accessor<string>;
  setRenameTitle: Setter<string>;
  setNewPageTitle: Setter<string>;
  createPage: () => void | Promise<void>;
  renamePage: () => void | Promise<void>;
};

export const createPageDialog = (deps: PageDialogDeps) => {
  const [pageDialogOpen, setPageDialogOpen] = createSignal(false);
  const [pageDialogMode, setPageDialogMode] =
    createSignal<PageDialogMode>(null);
  const [pageDialogValue, setPageDialogValue] = createSignal("");

  const currentTitle = () => deps.renameTitle().trim() || deps.pageTitle();

  const openNewPageDialog = () => {
    setPageDialogMode("new");
    setPageDialogValue("");
    setPageDialogOpen(true);
  };

  const openRenamePageDialog = () => {
    setPageDialogMode("rename");
    setPageDialogValue(currentTitle());
    setPageDialogOpen(true);
  };

  const closePageDialog = () => {
    setPageDialogOpen(false);
    setPageDialogMode(null);
  };

  const pageDialogTitle = createMemo(() =>
    getPageDialogTitle(pageDialogMode())
  );

  const pageDialogConfirmLabel = createMemo(() =>
    getPageDialogConfirmLabel(pageDialogMode())
  );

  const pageDialogDisabled = createMemo(() =>
    isPageDialogDisabled(pageDialogMode(), pageDialogValue(), currentTitle())
  );

  const confirmPageDialog = () => {
    const action = resolvePageDialogAction(
      pageDialogMode(),
      pageDialogValue(),
      currentTitle()
    );
    closePageDialog();
    if (!action) return;
    if (action.type === "create") {
      deps.setNewPageTitle(action.value);
      void deps.createPage();
      return;
    }
    deps.setRenameTitle(action.value);
    void deps.renamePage();
  };

  return {
    pageDialogOpen,
    pageDialogMode,
    pageDialogValue,
    pageDialogTitle,
    pageDialogConfirmLabel,
    pageDialogDisabled,
    setPageDialogValue,
    openNewPageDialog,
    openRenamePageDialog,
    closePageDialog,
    confirmPageDialog
  };
};
