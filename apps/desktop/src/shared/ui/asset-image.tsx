import { createEffect, createSignal, onCleanup } from "solid-js";
import { resolveAssetSrc } from "../lib/assets/resolve-asset-src";

type AssetImageProps = {
  source: string;
  isTauri: boolean;
  class?: string;
  alt?: string;
};

export const AssetImage = (props: AssetImageProps) => {
  const [resolvedSource, setResolvedSource] = createSignal(props.source);

  createEffect(() => {
    const source = props.source;
    let cancelled = false;
    setResolvedSource(source);
    void resolveAssetSrc(source, props.isTauri).then((resolved) => {
      if (!cancelled) {
        setResolvedSource(resolved);
      }
    });
    onCleanup(() => {
      cancelled = true;
    });
  });

  return <img class={props.class} src={resolvedSource()} alt={props.alt ?? ""} loading="lazy" />;
};
