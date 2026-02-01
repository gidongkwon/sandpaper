import { createMemo, onCleanup, type Accessor, type Component, type Setter } from "solid-js";

type Mode = "quick-capture" | "editor" | "review";

type SectionId = "sidebar" | "editor" | "backlinks" | "capture" | "review";

type CreateSectionJumpOptions = {
  mode: Accessor<Mode>;
  sidebarOpen: Accessor<boolean>;
  setSidebarOpen: Setter<boolean>;
  backlinksOpen: Accessor<boolean>;
  setBacklinksOpen: Setter<boolean>;
  activeId: Accessor<string | null>;
  getSearchInput: () => HTMLInputElement | undefined;
};

type SectionJumpComponents = {
  SectionJump: Component<{ id: SectionId; label: string }>;
  SectionJumpLink: Component<{ id: string; label: string }>;
  focusEditorSection: () => void;
};

export const createSectionJump = (
  options: CreateSectionJumpOptions
): SectionJumpComponents => {
  const sectionJumpRefs = new Map<SectionId, HTMLButtonElement>();

  const sectionOrder = createMemo<SectionId[]>(() => {
    if (options.mode() === "editor") {
      const order: SectionId[] = [];
      if (options.sidebarOpen()) {
        order.push("sidebar");
      }
      order.push("editor");
      if (options.backlinksOpen()) {
        order.push("backlinks");
      }
      return order;
    }
    if (options.mode() === "quick-capture") {
      return ["capture"];
    }
    if (options.mode() === "review") {
      return ["review"];
    }
    return ["review"];
  });

  const focusSectionJump = (id: SectionId) => {
    const target = sectionJumpRefs.get(id);
    if (target && document.body.contains(target)) {
      target.focus();
    }
  };

  const focusAdjacentSection = (current: SectionId, delta: number) => {
    const available = sectionOrder().filter((id) => {
      const el = sectionJumpRefs.get(id);
      return !!el && document.body.contains(el);
    });
    if (available.length === 0) return;
    const index = available.indexOf(current);
    if (index === -1) return;
    const nextIndex = (index + delta + available.length) % available.length;
    focusSectionJump(available[nextIndex]);
  };

  const focusEditorSection = () => {
    if (options.mode() !== "editor") return;
    const targetId = options.activeId();
    if (targetId) {
      const target = document.querySelector<HTMLElement>(
        `[data-block-id="${targetId}"] .block__display`
      );
      if (target) {
        target.click();
        return;
      }
    }
    const fallback = document.querySelector<HTMLElement>(".block__display");
    fallback?.click();
  };

  const activateSection = (id: SectionId) => {
    if (id === "sidebar") {
      if (!options.sidebarOpen()) {
        options.setSidebarOpen(true);
      }
      requestAnimationFrame(() => {
        options.getSearchInput()?.focus();
      });
      return;
    }
    if (id === "editor") {
      focusEditorSection();
      return;
    }
    if (id === "backlinks") {
      if (!options.backlinksOpen()) {
        options.setBacklinksOpen(true);
      }
      requestAnimationFrame(() => {
        const closeButton = document.querySelector<HTMLButtonElement>(
          ".backlinks-panel__close"
        );
        closeButton?.focus();
      });
      return;
    }
    if (id === "capture") {
      requestAnimationFrame(() => {
        const captureInput = document.querySelector<HTMLTextAreaElement>(
          ".capture__input"
        );
        captureInput?.focus();
      });
      return;
    }
    if (id === "review") {
      requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(
          ".review-card__button, .review__button, .review-template"
        );
        target?.focus();
      });
    }
  };

  const handleSectionJumpKeyDown = (id: SectionId, event: KeyboardEvent) => {
    if (event.key === "Tab") {
      event.preventDefault();
      focusAdjacentSection(id, event.shiftKey ? -1 : 1);
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateSection(id);
    }
  };

  const SectionJump: Component<{ id: SectionId; label: string }> = (props) => {
    let buttonRef: HTMLButtonElement | undefined;
    onCleanup(() => {
      if (buttonRef) {
        sectionJumpRefs.delete(props.id);
      }
    });

    return (
      <button
        ref={(el) => {
          buttonRef = el;
          sectionJumpRefs.set(props.id, el);
        }}
        class="section-jump"
        type="button"
        data-section-jump={props.id}
        aria-label={`${props.label} section`}
        onClick={() => activateSection(props.id)}
        onKeyDown={(event) => handleSectionJumpKeyDown(props.id, event)}
      >
        {props.label}
      </button>
    );
  };

  const SectionJumpLink: Component<{ id: string; label: string }> = (props) => (
    <SectionJump id={props.id as SectionId} label={props.label} />
  );

  return { SectionJump, SectionJumpLink, focusEditorSection };
};
