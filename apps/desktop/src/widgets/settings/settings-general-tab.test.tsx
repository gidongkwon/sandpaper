import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal, untrack } from "solid-js";
import { SettingsGeneralTab } from "./settings-general-tab";

describe("SettingsGeneralTab", () => {
  it("renders a theme selector with light, dark, and system options", async () => {
    const [value, setValue] = createSignal(1);
    const [showStatusSurfaces, setShowStatusSurfaces] = createSignal(true);
    const [themeMode, setThemeMode] = createSignal<"light" | "dark" | "system">("system");

    render(() => (
      <SettingsGeneralTab
        typeScale={{
          value,
          set: setValue,
          min: 0.8,
          max: 1.2,
          step: 0.05,
          defaultPosition: "50%"
        }}
        theme={{
          mode: themeMode,
          setMode: setThemeMode
        }}
        statusSurfaces={{
          showStatusSurfaces,
          setShowStatusSurfaces
        }}
        activeVault={() => null}
      />
    ));

    const user = userEvent.setup();
    const themeSelect = screen.getByRole("button", { name: /theme/i });
    expect(themeSelect).toHaveTextContent("System");
    await user.click(themeSelect);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "Light" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Dark" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "System" })).toBeInTheDocument();
    expect(
      screen.queryByText("Sandpaper follows your system color scheme.")
    ).not.toBeInTheDocument();
  });

  it("lists editor keyboard shortcuts", () => {
    const [value, setValue] = createSignal(1);
    const [showStatusSurfaces, setShowStatusSurfaces] = createSignal(true);
    const [themeMode, setThemeMode] = createSignal<"light" | "dark" | "system">("system");

    render(() => (
      <SettingsGeneralTab
        typeScale={{
          value,
          set: setValue,
          min: 0.8,
          max: 1.2,
          step: 0.05,
          defaultPosition: "50%"
        }}
        theme={{
          mode: themeMode,
          setMode: setThemeMode
        }}
        statusSurfaces={{
          showStatusSurfaces,
          setShowStatusSurfaces
        }}
        activeVault={() => null}
      />
    ));

    const heading = screen.getByText("Keyboard shortcuts");
    const section = heading.closest(".settings-section") as HTMLElement | null;
    expect(section).not.toBeNull();
    if (!section) return;

    const sectionApi = within(section);
    expect(sectionApi.getByText("Move block(s) up/down")).toBeInTheDocument();
    expect(
      sectionApi.getByText(/Alt\+Up\/Down|Option\+Command\+Up\/Down/)
    ).toBeInTheDocument();
    expect(sectionApi.getByText("Insert line break")).toBeInTheDocument();
    expect(sectionApi.getByText("Shift+Enter")).toBeInTheDocument();
  });

  it("renders status surface toggle", async () => {
    const [value, setValue] = createSignal(1);
    const [showStatusSurfaces, setShowStatusSurfaces] = createSignal(true);
    const [themeMode, setThemeMode] = createSignal<"light" | "dark" | "system">("system");

    render(() => (
      <SettingsGeneralTab
        typeScale={{
          value,
          set: setValue,
          min: 0.8,
          max: 1.2,
          step: 0.05,
          defaultPosition: "50%"
        }}
        theme={{
          mode: themeMode,
          setMode: setThemeMode
        }}
        statusSurfaces={{
          showStatusSurfaces,
          setShowStatusSurfaces
        }}
        activeVault={() => null}
      />
    ));

    const statusToggle = screen.getByRole("checkbox", {
      name: /show status chips/i
    }) as HTMLInputElement;

    expect(statusToggle.checked).toBe(true);
    expect(
      screen.queryByRole("checkbox", { name: /show shortcut hints/i })
    ).not.toBeInTheDocument();

    statusToggle.click();

    expect(untrack(showStatusSurfaces)).toBe(false);
  });
});
