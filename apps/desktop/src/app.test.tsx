import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import App from "./app";

describe("App", () => {
  it("renders the outline header", () => {
    render(() => <App />);
    expect(
      screen.getByText("Sandpaper", { selector: ".topbar__title" })
    ).toBeInTheDocument();
  });

  it("shows search results for matching blocks", async () => {
    render(() => <App />);
    const input = screen.getByPlaceholderText("Search notes, tags, or IDs");
    await userEvent.type(input, "Draft line 1");
    expect(await screen.findByText("Draft line 1")).toBeInTheDocument();
  });

  it("prompts for plugin permission grants", async () => {
    render(() => <App />);
    const grantButton = await screen.findByRole("button", {
      name: /grant network/i
    });
    await userEvent.click(grantButton);
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Grant permission"
    );
  });

  it("shows plugin panels and toolbar actions", async () => {
    render(() => <App />);
    expect(await screen.findByText("Panels")).toBeInTheDocument();
    expect(await screen.findByText("Toolbar actions")).toBeInTheDocument();
    expect(await screen.findByText("Calendar panel")).toBeInTheDocument();
    expect(await screen.findByText("Today focus")).toBeInTheDocument();
  });
});
