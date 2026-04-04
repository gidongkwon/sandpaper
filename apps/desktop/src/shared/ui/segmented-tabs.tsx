import * as SegmentedControl from "@kobalte/core/segmented-control";
import { For } from "solid-js";

type SegmentedTabsItem<T extends string> = {
  value: T;
  label: string;
};

type SegmentedTabsProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  items: readonly SegmentedTabsItem<T>[];
  "aria-label": string;
  class?: string;
  triggerClass?: string;
  ref?: HTMLElement | ((el: HTMLElement) => void);
};

export const SegmentedTabs = <T extends string>(props: SegmentedTabsProps<T>) => {
  return (
    <SegmentedControl.Root
      value={props.value}
      onChange={(value) => {
        if (value) props.onChange(value as T);
      }}
      class={`segmented-tabs ${props.class ?? ""}`.trim()}
      aria-label={props["aria-label"]}
      ref={props.ref}
    >
      <For each={props.items}>
        {(item) => (
          <SegmentedControl.Item
            class={`segmented-tabs__trigger ${props.triggerClass ?? ""}`.trim()}
            value={item.value}
          >
            <SegmentedControl.ItemInput />
            <SegmentedControl.ItemLabel class="segmented-tabs__label">
              {item.label}
            </SegmentedControl.ItemLabel>
          </SegmentedControl.Item>
        )}
      </For>
    </SegmentedControl.Root>
  );
};
