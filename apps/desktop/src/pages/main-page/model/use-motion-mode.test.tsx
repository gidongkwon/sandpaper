import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { createMotionMode } from "./use-motion-mode";

describe("createMotionMode", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia
    });
  });

  it("syncs full, reduced, and system motion modes to the document", async () => {
    const TestHarness = () => {
      const motion = createMotionMode();
      return (
        <select
          aria-label="Motion"
          value={motion.motionMode()}
          onChange={(event) =>
            motion.setMotionMode(event.currentTarget.value as "full" | "reduced" | "system")
          }
        >
          <option value="full">Full</option>
          <option value="reduced">Reduced</option>
          <option value="system">System</option>
        </select>
      );
    };

    render(() => <TestHarness />);

    const motionSelect = screen.getByRole("combobox", { name: /motion/i });
    expect(document.documentElement.dataset.motionMode).toBe("system");
    expect(document.documentElement.dataset.motion).toBe("reduced");

    await userEvent.selectOptions(motionSelect, "full");
    expect(document.documentElement.dataset.motionMode).toBe("full");
    expect(document.documentElement.dataset.motion).toBe("full");

    await userEvent.selectOptions(motionSelect, "reduced");
    expect(document.documentElement.dataset.motionMode).toBe("reduced");
    expect(document.documentElement.dataset.motion).toBe("reduced");

    await userEvent.selectOptions(motionSelect, "system");
    expect(document.documentElement.dataset.motionMode).toBe("system");
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });
});
