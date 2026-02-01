import { Show, type Accessor } from "solid-js";
import type { PerfStats } from "../../shared/lib/perf/perf";

type PerfHudProps = {
  enabled: Accessor<boolean>;
  stats: Accessor<PerfStats>;
  scrollFps: Accessor<number>;
};

export const PerfHud = (props: PerfHudProps) => {
  return (
    <Show when={props.enabled()}>
      <aside class="perf-hud">
        <div class="perf-hud__title">Perf</div>
        <div class="perf-hud__row">
          Input p50 <span>{props.stats().p50?.toFixed(1) ?? "--"}ms</span>
        </div>
        <div class="perf-hud__row">
          Input p95 <span>{props.stats().p95?.toFixed(1) ?? "--"}ms</span>
        </div>
        <div class="perf-hud__row">
          Scroll <span>{props.scrollFps()} fps</span>
        </div>
        <div class="perf-hud__row">
          Samples <span>{props.stats().count}</span>
        </div>
      </aside>
    </Show>
  );
};
