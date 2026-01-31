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

  it("shows autosave status after load", async () => {
    render(() => <App />);
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });

  it("shows search results for matching blocks", async () => {
    render(() => <App />);
    const input = screen.getByPlaceholderText("Search notes, tags, or IDs");
    await userEvent.type(input, "Draft line 1");
    expect(await screen.findByText("Draft line 1")).toBeInTheDocument();
  });

  it("filters search results by links", async () => {
    render(() => <App />);
    const input = screen.getByPlaceholderText("Search notes, tags, or IDs");
    await userEvent.type(input, "Draft line 1");
    expect(await screen.findByText("Draft line 1")).toBeInTheDocument();
    const linksButton = screen.getByRole("button", { name: "Links" });
    await userEvent.click(linksButton);
    expect(screen.queryByText("Draft line 1")).not.toBeInTheDocument();
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
    expect(await screen.findByText("Renderers")).toBeInTheDocument();
    expect(await screen.findByText("Calendar panel")).toBeInTheDocument();
    expect(await screen.findByText("Today focus")).toBeInTheDocument();
    expect(await screen.findByText("Code block renderer")).toBeInTheDocument();
  });

  it("renders the vault key section", async () => {
    render(() => <App />);
    expect(await screen.findByText("Vault key")).toBeInTheDocument();
    const setButton = screen.getByRole("button", { name: /set passphrase/i });
    expect(setButton).toBeDisabled();
  });

  it("renders a code preview for fenced blocks", async () => {
    render(() => <App />);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0];
    await userEvent.clear(firstInput);
    await userEvent.type(firstInput, "```ts const x = 1;");
    const previews = await screen.findAllByText("Code preview");
    expect(previews.length).toBeGreaterThan(0);
    const snippets = await screen.findAllByText("const x = 1;");
    expect(snippets.length).toBeGreaterThan(0);
  });

  it("renders a diagram preview for fenced mermaid blocks", async () => {
    render(() => <App />);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0];
    await userEvent.clear(firstInput);
    await userEvent.type(firstInput, "```mermaid graph TD A-->B;");
    const previews = await screen.findAllByText("Diagram preview");
    expect(previews.length).toBeGreaterThan(0);
    const snippets = await screen.findAllByText("graph TD A-->B;");
    expect(snippets.length).toBeGreaterThan(0);
  });

  it("shows backlinks for referenced blocks", async () => {
    render(() => <App />);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0];
    const secondInput = inputs[1];
    const targetId = firstInput.getAttribute("data-block-id");
    expect(targetId).toBeTruthy();
    await userEvent.clear(secondInput);
    await userEvent.type(secondInput, `See ((${targetId}))`);
    await userEvent.click(firstInput);
    expect(await screen.findByText("Backlinks")).toBeInTheDocument();
    const backlinks = await screen.findAllByText(/see/i, {
      selector: ".backlink__text"
    });
    expect(backlinks.length).toBeGreaterThan(0);
  });

  it("exports markdown in browser mode", async () => {
    render(() => <App />);
    const exportButton = await screen.findByRole("button", {
      name: /export markdown/i
    });
    await userEvent.click(exportButton);
    expect(
      await screen.findByText(/preview generated in browser/i)
    ).toBeInTheDocument();
  });

  it("opens a plugin panel from the list", async () => {
    render(() => <App />);
    const openButtons = await screen.findAllByRole("button", {
      name: /open panel/i
    });
    await userEvent.click(openButtons[0]);
    expect(await screen.findByText(/active panel/i)).toBeInTheDocument();
  });

  it("blocks panel open when permission is missing", async () => {
    render(() => <App />);
    const openButtons = await screen.findAllByRole("button", {
      name: /open panel/i
    });
    await userEvent.click(openButtons[1]);
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Grant permission"
    );
  });

  it("runs a plugin command to append a block", async () => {
    render(() => <App />);
    const runButtons = await screen.findAllByRole("button", {
      name: /run command/i
    });
    await userEvent.click(runButtons[0]);
    const matches = await screen.findAllByDisplayValue(/plugin action/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("blocks command run when permission is missing", async () => {
    render(() => <App />);
    const runButtons = await screen.findAllByRole("button", {
      name: /run command/i
    });
    await userEvent.click(runButtons[1]);
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Grant permission"
    );
  });
});
