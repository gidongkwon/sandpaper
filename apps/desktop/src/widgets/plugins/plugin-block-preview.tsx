import { For, Show, createEffect, createSignal, on } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { Block } from "../../entities/block/model/block-types";
import type {
  PluginBlockControl,
  PluginBlockView,
  PluginRenderer
} from "../../entities/plugin/model/plugin-types";
import { copyToClipboard } from "../../shared/lib/clipboard/copy-to-clipboard";

type PluginBlockPreviewProps = {
  block: Block;
  renderer: PluginRenderer;
  isTauri: () => boolean;
  onUpdateText: (nextText: string) => void;
};

const applyNextText = (
  current: string,
  nextText: string | null | undefined,
  onUpdateText: (value: string) => void
) => {
  if (!nextText) return;
  if (nextText === current) return;
  onUpdateText(nextText);
};

const renderBody = (body: PluginBlockView["body"]) => {
  if (!body) return null;
  if (body.kind === "text") {
    return <p class="plugin-block__text">{body.text}</p>;
  }
  if (body.kind === "list") {
    return (
      <ul class="plugin-block__list">
        <For each={body.items}>{(item) => <li>{item}</li>}</For>
      </ul>
    );
  }
  if (body.kind === "stats") {
    return (
      <div class="plugin-block__stats">
        <For each={body.items}>
          {(item) => (
            <div class="plugin-block__stat">
              <span class="plugin-block__stat-label">{item.label}</span>
              <span class="plugin-block__stat-value">{item.value}</span>
            </div>
          )}
        </For>
      </div>
    );
  }
  return (
    <pre class="plugin-block__debug">
      {JSON.stringify(body, null, 2)}
    </pre>
  );
};

const renderControl = (
  control: PluginBlockControl,
  onAction: (controlId: string, value?: string) => void
) => {
  if (control.type === "button") {
    return (
      <button
        class="plugin-block__control"
        type="button"
        onClick={() => onAction(control.id)}
      >
        {control.label}
      </button>
    );
  }
  if (control.type === "select") {
    return (
      <label class="plugin-block__control plugin-block__control--select">
        <span>{control.label}</span>
        <select
          value={control.value ?? ""}
          onChange={(event) => onAction(control.id, event.currentTarget.value)}
        >
          <For each={control.options}>
            {(option) => (
              <option value={option.value}>{option.label}</option>
            )}
          </For>
        </select>
      </label>
    );
  }
  if (control.type === "clipboard") {
    return (
      <button
        class="plugin-block__control"
        type="button"
        onClick={() => void copyToClipboard(control.text)}
      >
        {control.label}
      </button>
    );
  }
  return null;
};

export const PluginBlockPreview = (props: PluginBlockPreviewProps) => {
  const [view, setView] = createSignal<PluginBlockView | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const loadView = async () => {
    if (!props.isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<PluginBlockView>("plugin_render_block", {
        pluginId: props.renderer.plugin_id,
        plugin_id: props.renderer.plugin_id,
        rendererId: props.renderer.id,
        renderer_id: props.renderer.id,
        blockUid: props.block.id,
        block_uid: props.block.id,
        text: props.block.text
      });
      setView(result);
      applyNextText(props.block.text, result.next_text, props.onUpdateText);
    } catch (err) {
      console.error("Failed to render plugin block", err);
      setError(err instanceof Error ? err.message : "Failed to render block.");
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (controlId: string, value?: string) => {
    if (!props.isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<PluginBlockView>("plugin_block_action", {
        pluginId: props.renderer.plugin_id,
        plugin_id: props.renderer.plugin_id,
        rendererId: props.renderer.id,
        renderer_id: props.renderer.id,
        blockUid: props.block.id,
        block_uid: props.block.id,
        text: props.block.text,
        actionId: controlId,
        action_id: controlId,
        value
      });
      setView(result);
      applyNextText(props.block.text, result.next_text, props.onUpdateText);
    } catch (err) {
      console.error("Failed to run plugin action", err);
      setError(err instanceof Error ? err.message : "Failed to run action.");
    } finally {
      setLoading(false);
    }
  };

  createEffect(
    on(
      () => [props.block.text, props.renderer.id],
      () => {
        if (!props.isTauri()) {
          setView(null);
          return;
        }
        void loadView();
      },
      { defer: true }
    )
  );

  return (
    <div class="plugin-block">
      <div class="plugin-block__header">
        <span class="plugin-block__title">{props.renderer.title}</span>
        <Show when={loading()}>
          <span class="plugin-block__status">Loading...</span>
        </Show>
      </div>
      <Show when={error()}>
        {(message) => <div class="plugin-block__error">{message()}</div>}
      </Show>
      <Show when={view()}>
        {(resolved) => (
          <>
            {renderBody(resolved().body ?? null)}
            <Show when={(resolved().controls ?? []).length > 0}>
              <div class="plugin-block__controls">
                <For each={resolved().controls ?? []}>
                  {(control) => renderControl(control, runAction)}
                </For>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};
