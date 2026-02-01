import { For, Show, createEffect, createSignal, on, onMount } from "solid-js";
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

type PluginBlockCacheEntry = {
  view: PluginBlockView;
  fetchedAt: number;
  ttlMs: number;
};

const DEFAULT_CACHE_TTL_MS = 15000;
const MAX_CACHE_ENTRIES = 200;
const blockViewCache = new Map<string, PluginBlockCacheEntry>();

export const __clearPluginBlockCache = () => {
  blockViewCache.clear();
};

const normalizeCacheKeyText = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return text;
  const rest = trimmed.slice(3).trim();
  if (!rest) return text;
  const summaryIndex = rest.indexOf("::");
  const left = (summaryIndex >= 0 ? rest.slice(0, summaryIndex) : rest).trim();
  if (!left) return text;
  const [lang, ...configParts] = left.split(/\s+/);
  if (!lang) return text;
  let configText = configParts.join(" ").trim();
  if (configText) {
    configText = configText
      .replace(/(^|\s)cache_ts=("[^"]*"|'[^']*'|\S+)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return configText ? `${lang.toLowerCase()} ${configText}` : lang.toLowerCase();
};

const cacheKeyFor = (renderer: PluginRenderer, blockId: string, text: string) =>
  `${renderer.plugin_id}::${renderer.id}::${blockId}::${normalizeCacheKeyText(
    text
  )}`;

const resolveCacheTtlMs = (view: PluginBlockView) => {
  const ttlSeconds = view.cache?.ttlSeconds;
  if (typeof ttlSeconds === "number") {
    if (!Number.isFinite(ttlSeconds)) return DEFAULT_CACHE_TTL_MS;
    if (ttlSeconds <= 0) return null;
    return ttlSeconds * 1000;
  }
  return DEFAULT_CACHE_TTL_MS;
};

const readCachedView = (key: string) => {
  const entry = blockViewCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > entry.ttlMs) {
    blockViewCache.delete(key);
    return null;
  }
  return entry.view;
};

const storeCachedView = (key: string, view: PluginBlockView) => {
  const ttlMs = resolveCacheTtlMs(view);
  if (ttlMs === null) return;
  blockViewCache.set(key, { view, fetchedAt: Date.now(), ttlMs });
  if (blockViewCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = blockViewCache.keys().next().value;
    if (oldestKey) {
      blockViewCache.delete(oldestKey);
    }
  }
};

const applyNextText = (
  current: string,
  nextText: string | null | undefined,
  onUpdateText: (value: string) => void,
  onSkipNextRender: (value: string) => void
) => {
  if (!nextText) return;
  if (nextText === current) return;
  onSkipNextRender(nextText);
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
  const [skipNextRender, setSkipNextRender] = createSignal<string | null>(null);

  const loadView = async () => {
    if (!props.isTauri()) return;
    const key = cacheKeyFor(props.renderer, props.block.id, props.block.text);
    const cached = readCachedView(key);
    if (cached) {
      setError(null);
      setView(cached);
      setLoading(false);
      applyNextText(
        props.block.text,
        cached.next_text,
        props.onUpdateText,
        (value) => setSkipNextRender(value)
      );
      return;
    }

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
      storeCachedView(key, result);
      if (result.next_text && result.next_text !== props.block.text) {
        const nextKey = cacheKeyFor(
          props.renderer,
          props.block.id,
          result.next_text
        );
        storeCachedView(nextKey, result);
      }
      applyNextText(
        props.block.text,
        result.next_text,
        props.onUpdateText,
        (value) => setSkipNextRender(value)
      );
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
      const key = cacheKeyFor(props.renderer, props.block.id, props.block.text);
      storeCachedView(key, result);
      if (result.next_text && result.next_text !== props.block.text) {
        const nextKey = cacheKeyFor(
          props.renderer,
          props.block.id,
          result.next_text
        );
        storeCachedView(nextKey, result);
      }
      applyNextText(
        props.block.text,
        result.next_text,
        props.onUpdateText,
        (value) => setSkipNextRender(value)
      );
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
        if (skipNextRender() && props.block.text === skipNextRender()) {
          setSkipNextRender(null);
          return;
        }
        void loadView();
      },
      { defer: true }
    )
  );

  onMount(() => {
    if (props.isTauri()) {
      void loadView();
    }
  });

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
            <Show
              when={
                !resolved().body &&
                (resolved().message || resolved().summary)
              }
            >
              <div
                class={
                  resolved().status === "error"
                    ? "plugin-block__error"
                    : "plugin-block__summary"
                }
              >
                {resolved().message ?? resolved().summary}
              </div>
            </Show>
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
