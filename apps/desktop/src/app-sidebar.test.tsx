import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn()
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...actual,
    invoke: vi.fn()
  };
});

import App from "./app/app";

describe("App sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("renders search controls and pages list", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);

    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Links" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tasks" })).not.toBeInTheDocument();
    expect(screen.getByText("Pages")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create new page/i }));
    const dialog = await screen.findByRole("dialog", { name: "New page title" });
    const input = within(dialog).getByRole("textbox");
    await user.type(input, "Sidebar Page");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText("Sidebar Page", { selector: ".page-item__title" })
    ).toBeInTheDocument();
  });

  it("can collapse and reopen the sidebar", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);

    const collapseButton = screen.getByRole("button", { name: /hide sidebar/i });
    await user.click(collapseButton);
    expect(
      screen.getByRole("button", { name: /show sidebar/i })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show sidebar/i }));
    expect(
      screen.getByRole("button", { name: /hide sidebar/i })
    ).toBeInTheDocument();
  });
});
