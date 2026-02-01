import { For, Show, createEffect, createSignal, type Accessor, type Setter } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import type { SyncConfig, SyncConflict, SyncLogEntry, SyncStatus } from "../../entities/sync/model/sync-types";
import type { VaultKeyStatus } from "../../entities/vault/model/vault-types";
import type { PageId } from "../../shared/model/id-types";
import { ensureMermaid } from "../../shared/lib/diagram/mermaid";
import { makeRandomId } from "../../shared/lib/id/id-factory";

type SettingsSyncProps = {
  status: Accessor<SyncStatus>;
  stateLabel: Accessor<string>;
  stateDetail: Accessor<string>;
  serverUrl: Accessor<string>;
  setServerUrl: Setter<string>;
  vaultIdInput: Accessor<string>;
  setVaultIdInput: Setter<string>;
  deviceIdInput: Accessor<string>;
  setDeviceIdInput: Setter<string>;
  busy: Accessor<boolean>;
  connected: Accessor<boolean>;
  connect: () => void | Promise<void>;
  syncNow: () => void | Promise<void>;
  message: Accessor<string | null>;
  config: Accessor<SyncConfig | null>;
  log: Accessor<SyncLogEntry[]>;
  copyLog: () => void | Promise<void>;
  conflicts: Accessor<SyncConflict[]>;
  resolveConflict: (
    conflict: SyncConflict,
    resolution: "local" | "remote" | "merge",
    mergeText?: string
  ) => void | Promise<void>;
  startMerge: (conflict: SyncConflict) => void;
  cancelMerge: () => void;
  mergeId: Accessor<string | null>;
  mergeDrafts: Record<string, string>;
  setMergeDrafts: SetStoreFunction<Record<string, string>>;
  getConflictPageTitle: (pageUid: PageId) => string;
};

type SettingsSyncTabProps = {
  isTauri: () => boolean;
  vaultKeyStatus: Accessor<VaultKeyStatus>;
  sync: SettingsSyncProps;
};

const SyncConflictDiagram = () => {
  const [svg, setSvg] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let containerRef: HTMLDivElement | undefined;
  let renderToken = 0;

  createEffect(() => {
    const token = (renderToken += 1);
    setSvg(null);
    setError(null);
    const content =
      "flowchart LR\n  L[Local edit] --> C{Conflict}\n  R[Remote edit] --> C\n  C --> M[Merged result]";

    void (async () => {
      try {
        const engine = ensureMermaid();
        const result = await engine.render(
          `mermaid-sync-${makeRandomId()}`,
          content
        );
        if (token !== renderToken) return;
        setSvg(result.svg ?? "");
        if (result.bindFunctions && containerRef) {
          Promise.resolve().then(() => {
            if (token !== renderToken) return;
            result.bindFunctions?.(containerRef);
          });
        }
      } catch {
        if (token !== renderToken) return;
        setError("Conflict diagram unavailable.");
      }
    })();
  });

  return (
    <div class="sync-conflict-diagram">
      <Show
        when={svg()}
        fallback={
          <div class="sync-conflict-diagram__fallback">
            {error() ?? "Rendering conflict diagram..."}
          </div>
        }
      >
        {(value) => (
          <div
            ref={containerRef}
            class="sync-conflict-diagram__svg"
            innerHTML={value() ?? ""}
          />
        )}
      </Show>
    </div>
  );
};

export const SettingsSyncTab = (props: SettingsSyncTabProps) => (
  <>
    <div class="settings-section">
      <h3 class="settings-section__title">Connection</h3>
      <div class="settings-status">
        <span class={`settings-status__dot ${props.sync.status().state}`} />
        <span class="settings-status__label">{props.sync.stateLabel()}</span>
      </div>
      <p class="settings-section__desc">{props.sync.stateDetail()}</p>
      <input
        class="settings-input"
        type="text"
        placeholder="Sync server URL"
        value={props.sync.serverUrl()}
        onInput={(e) => props.sync.setServerUrl(e.currentTarget.value)}
      />
      <input
        class="settings-input"
        type="text"
        placeholder="Vault ID (optional)"
        value={props.sync.vaultIdInput()}
        onInput={(e) => props.sync.setVaultIdInput(e.currentTarget.value)}
      />
      <input
        class="settings-input"
        type="text"
        placeholder="Device ID (optional)"
        value={props.sync.deviceIdInput()}
        onInput={(e) => props.sync.setDeviceIdInput(e.currentTarget.value)}
      />
      <div class="settings-actions">
        <button
          class="settings-action is-primary"
          disabled={
            !props.isTauri() ||
            props.sync.busy() ||
            !props.vaultKeyStatus().configured ||
            !props.sync.serverUrl().trim()
          }
          onClick={() => void props.sync.connect()}
        >
          {props.sync.busy() ? "Connecting..." : "Connect"}
        </button>
        <button
          class="settings-action"
          disabled={
            !props.isTauri() || props.sync.busy() || !props.sync.connected()
          }
          onClick={() => void props.sync.syncNow()}
        >
          Sync now
        </button>
      </div>
      <Show when={props.sync.message()}>
        <div class="settings-message">{props.sync.message()}</div>
      </Show>
    </div>
    <Show when={props.sync.connected()}>
      <div class="settings-section">
        <h3 class="settings-section__title">Statistics</h3>
        <div class="settings-stats">
          <div class="settings-stat">
            <span class="settings-stat__value">{props.sync.status().pending_ops}</span>
            <span class="settings-stat__label">Queue</span>
          </div>
          <div class="settings-stat">
            <span class="settings-stat__value">{props.sync.status().last_push_count}</span>
            <span class="settings-stat__label">Pushed</span>
          </div>
          <div class="settings-stat">
            <span class="settings-stat__value">{props.sync.status().last_pull_count}</span>
            <span class="settings-stat__label">Pulled</span>
          </div>
          <div class="settings-stat">
            <span class="settings-stat__value">{props.sync.status().last_apply_count}</span>
            <span class="settings-stat__label">Applied</span>
          </div>
        </div>
        <div class="settings-row">
          <label class="settings-label">Vault ID</label>
          <code class="settings-code">{props.sync.config()?.vault_id}</code>
        </div>
        <div class="settings-row">
          <label class="settings-label">Device ID</label>
          <code class="settings-code">{props.sync.config()?.device_id}</code>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section__header">
          <h3 class="settings-section__title">Activity log</h3>
          <button
            class="settings-action"
            onClick={() => void props.sync.copyLog()}
            disabled={props.sync.log().length === 0}
          >
            Copy log
          </button>
        </div>
        <Show
          when={props.sync.log().length > 0}
          fallback={<p class="settings-section__desc">No sync activity yet.</p>}
        >
          <div class="sync-log">
            <For each={[...props.sync.log()].reverse()}>
              {(entry) => (
                <div
                  class={`sync-log__row ${
                    entry.status === "error" ? "is-error" : ""
                  }`}
                >
                  <span class="sync-log__time">{entry.at}</span>
                  <span class={`sync-log__action is-${entry.action}`}>
                    {entry.action}
                  </span>
                  <span class="sync-log__count">{entry.count}</span>
                  <Show when={entry.detail}>
                    <span class="sync-log__detail">{entry.detail}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={props.sync.conflicts().length > 0}>
        <div class="settings-section">
          <div class="settings-section__header">
            <h3 class="settings-section__title">Sync conflicts</h3>
            <span class="sync-conflict-count">
              {props.sync.conflicts().length} open
            </span>
          </div>
          <p class="settings-section__desc">
            Conflicting edits were detected during sync. Choose a version or merge
            the text before continuing.
          </p>
          <SyncConflictDiagram />
          <div class="sync-conflicts">
            <For each={props.sync.conflicts()}>
              {(conflict) => (
                <div class="sync-conflict">
                  <div class="sync-conflict__header">
                    <div>
                      <div class="sync-conflict__title">
                        {props.sync.getConflictPageTitle(conflict.page_uid)}
                      </div>
                      <div class="sync-conflict__meta">
                        Block {conflict.block_uid}
                      </div>
                    </div>
                  </div>
                  <div class="sync-conflict__diff">
                    <div class="sync-conflict__pane is-local">
                      <div class="sync-conflict__label">Local</div>
                      <pre class="sync-conflict__text">{conflict.local_text}</pre>
                    </div>
                    <div class="sync-conflict__pane is-remote">
                      <div class="sync-conflict__label">Remote</div>
                      <pre class="sync-conflict__text">{conflict.remote_text}</pre>
                    </div>
                  </div>
                  <div class="sync-conflict__actions">
                    <button
                      class="settings-action"
                      onClick={() => void props.sync.resolveConflict(conflict, "local")}
                    >
                      Use local
                    </button>
                    <button
                      class="settings-action"
                      onClick={() => void props.sync.resolveConflict(conflict, "remote")}
                    >
                      Use remote
                    </button>
                    <button
                      class="settings-action is-primary"
                      onClick={() => props.sync.startMerge(conflict)}
                    >
                      Merge
                    </button>
                  </div>
                  <Show when={props.sync.mergeId() === conflict.op_id}>
                    <div class="sync-conflict__merge">
                      <label class="sync-conflict__label">Merged</label>
                      <textarea
                        class="sync-conflict__textarea"
                        value={props.sync.mergeDrafts[conflict.op_id] ?? ""}
                        onInput={(event) =>
                          props.sync.setMergeDrafts(
                            conflict.op_id,
                            event.currentTarget.value
                          )
                        }
                      />
                      <div class="sync-conflict__actions">
                        <button
                          class="settings-action is-primary"
                          onClick={() =>
                            void props.sync.resolveConflict(
                              conflict,
                              "merge",
                              props.sync.mergeDrafts[conflict.op_id] ?? ""
                            )
                          }
                        >
                          Apply merge
                        </button>
                        <button
                          class="settings-action"
                          onClick={props.sync.cancelMerge}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </Show>
  </>
);
