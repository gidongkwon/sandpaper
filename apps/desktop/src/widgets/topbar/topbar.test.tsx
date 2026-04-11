import { render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Topbar } from "./topbar";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn()
  })
}));

type ResizeObserverCallback = InstanceType<typeof ResizeObserver> extends {
  constructor: new (callback: infer T) => InstanceType<typeof ResizeObserver>;
}
  ? T
  : globalThis.ResizeObserverCallback;

class ResizeObserverMock {
  static callback: ResizeObserverCallback | null = null;

  constructor(callback: ResizeObserverCallback) {
    ResizeObserverMock.callback = callback;
  }

  observe() {}

  disconnect() {}
}

describe("Topbar", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  const renderTopbar = () => {
    const [mode, setMode] = createSignal<"quick-capture" | "refine" | "editor">("editor");
    return render(() => (
      <Topbar
        sidebarOpen={() => true}
        toggleSidebar={vi.fn()}
        mode={mode}
        setMode={setMode}
        reducedMotion={() => false}
        showStatusSurfaces={() => true}
        autosaveError={() => null}
        autosaved={() => true}
        autosaveStamp={() => "Saved now"}
        notificationsOpen={() => false}
        notificationCount={() => 0}
        onOpenNotifications={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));
  };

  beforeEach(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverMock
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: originalResizeObserver
    });
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    ResizeObserverMock.callback = null;
    vi.restoreAllMocks();
  });

  it("centers the mode switch when the topbar has enough room", () => {
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        if (this.classList.contains("topbar")) {
          return DOMRect.fromRect({ width: 900, height: 46 });
        }
        if (this.classList.contains("topbar__left")) {
          return DOMRect.fromRect({ width: 80, height: 28 });
        }
        if (this.classList.contains("topbar__right")) {
          return DOMRect.fromRect({ width: 220, height: 28 });
        }
        if (this.classList.contains("mode-switch")) {
          return DOMRect.fromRect({ width: 220, height: 34 });
        }
        return DOMRect.fromRect({ width: 0, height: 0 });
      });

    renderTopbar();
    ResizeObserverMock.callback?.([], {} as ResizeObserver);

    expect(screen.getByRole("banner")).toHaveClass("is-mode-centered");
    rectSpy.mockRestore();
  });

  it("keeps the mode switch in normal flow when the topbar is too narrow", () => {
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        if (this.classList.contains("topbar")) {
          return DOMRect.fromRect({ width: 420, height: 46 });
        }
        if (this.classList.contains("topbar__left")) {
          return DOMRect.fromRect({ width: 80, height: 28 });
        }
        if (this.classList.contains("topbar__right")) {
          return DOMRect.fromRect({ width: 220, height: 28 });
        }
        if (this.classList.contains("mode-switch")) {
          return DOMRect.fromRect({ width: 220, height: 34 });
        }
        return DOMRect.fromRect({ width: 0, height: 0 });
      });

    renderTopbar();
    ResizeObserverMock.callback?.([], {} as ResizeObserver);

    expect(screen.getByRole("banner")).not.toHaveClass("is-mode-centered");
    rectSpy.mockRestore();
  });

  it("keeps the mode switch in normal flow when the right side is much wider", () => {
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        if (this.classList.contains("topbar")) {
          return DOMRect.fromRect({ width: 720, height: 46 });
        }
        if (this.classList.contains("topbar__left")) {
          return DOMRect.fromRect({ width: 80, height: 28 });
        }
        if (this.classList.contains("topbar__right")) {
          return DOMRect.fromRect({ width: 260, height: 28 });
        }
        if (this.classList.contains("mode-switch")) {
          return DOMRect.fromRect({ width: 220, height: 34 });
        }
        return DOMRect.fromRect({ width: 0, height: 0 });
      });

    renderTopbar();
    ResizeObserverMock.callback?.([], {} as ResizeObserver);

    expect(screen.getByRole("banner")).not.toHaveClass("is-mode-centered");
    rectSpy.mockRestore();
  });
});
