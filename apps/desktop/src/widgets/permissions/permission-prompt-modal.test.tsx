import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { vi } from "vitest";
import type { PermissionPrompt } from "../../entities/plugin/model/plugin-types";
import { PermissionPromptModal } from "./permission-prompt-modal";

describe("PermissionPromptModal", () => {
  it("renders the prompt and triggers actions", async () => {
    const [prompt, setPrompt] = createSignal<PermissionPrompt | null>(null);
    const onDeny = vi.fn();
    const onAllow = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <PermissionPromptModal prompt={prompt} onDeny={onDeny} onAllow={onAllow} />
    ));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    setPrompt({
      pluginId: "plugin-1",
      pluginName: "Sample Plugin",
      permission: "network"
    });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Sample Plugin")).toBeInTheDocument();
    expect(screen.getByText("network")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /deny/i }));
    await user.click(screen.getByRole("button", { name: /allow/i }));

    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(onAllow).toHaveBeenCalledTimes(1);
  });
});
