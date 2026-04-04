import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createThemeMode } from "./use-theme-mode";
import { setTheme } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({
  setTheme: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined)
}));

describe("createThemeMode", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(setTheme).mockClear();
    vi.mocked(invoke).mockClear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-color-scheme: dark)",
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

  it("syncs app theme with light, dark, and system modes", async () => {
    const TestHarness = () => {
      const theme = createThemeMode();
      return (
        <>
          <select
            aria-label="Theme"
            value={theme.themeMode()}
            onChange={(event) =>
              theme.setThemeMode(event.currentTarget.value as "light" | "dark" | "system")
            }
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </>
      );
    };

    render(() => <TestHarness />);

    const themeSelect = screen.getByRole("combobox", { name: /theme/i });
    expect(vi.mocked(setTheme)).toHaveBeenLastCalledWith(null);
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("set_window_theme_effect", {
      mode: "system",
      effectiveTheme: "dark"
    });

    await userEvent.selectOptions(themeSelect, "light");
    expect(vi.mocked(setTheme)).toHaveBeenLastCalledWith("light");
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("set_window_theme_effect", {
      mode: "light",
      effectiveTheme: "light"
    });

    await userEvent.selectOptions(themeSelect, "dark");
    expect(vi.mocked(setTheme)).toHaveBeenLastCalledWith("dark");
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("set_window_theme_effect", {
      mode: "dark",
      effectiveTheme: "dark"
    });

    await userEvent.selectOptions(themeSelect, "system");
    expect(vi.mocked(setTheme)).toHaveBeenLastCalledWith(null);
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("set_window_theme_effect", {
      mode: "system",
      effectiveTheme: "dark"
    });
  });
});
