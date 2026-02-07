import { render, screen, within } from "@solidjs/testing-library";
import { createSignal, untrack } from "solid-js";
import { SettingsGeneralTab } from "./settings-general-tab";

describe("SettingsGeneralTab", () => {
  it("lists editor keyboard shortcuts", () => {
    const [value, setValue] = createSignal(1);
    const [showStatusSurfaces, setShowStatusSurfaces] = createSignal(true);
    const [showShortcutHints, setShowShortcutHints] = createSignal(true);

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
        statusSurfaces={{
          showStatusSurfaces,
          setShowStatusSurfaces,
          showShortcutHints,
          setShowShortcutHints
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

  it("renders status surface toggles and disables hints when status chips are hidden", async () => {
    const [value, setValue] = createSignal(1);
    const [showStatusSurfaces, setShowStatusSurfaces] = createSignal(true);
    const [showShortcutHints, setShowShortcutHints] = createSignal(true);

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
        statusSurfaces={{
          showStatusSurfaces,
          setShowStatusSurfaces,
          showShortcutHints,
          setShowShortcutHints
        }}
        activeVault={() => null}
      />
    ));

    const statusToggle = screen.getByRole("checkbox", {
      name: /show status chips/i
    }) as HTMLInputElement;
    const hintsToggle = screen.getByRole("checkbox", {
      name: /show shortcut hints/i
    }) as HTMLInputElement;

    expect(statusToggle.checked).toBe(true);
    expect(hintsToggle.checked).toBe(true);
    expect(hintsToggle.disabled).toBe(false);

    statusToggle.click();

    expect(untrack(showStatusSurfaces)).toBe(false);
    expect(hintsToggle.disabled).toBe(true);
  });
});
