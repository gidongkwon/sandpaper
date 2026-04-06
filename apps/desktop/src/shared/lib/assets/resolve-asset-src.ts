import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const resolvedAssetSrcCache = new Map<string, Promise<string>>();

export const clearResolvedAssetSrcCache = () => {
  resolvedAssetSrcCache.clear();
};

export const resolveAssetSrc = async (
  source: string,
  isTauri: boolean,
  invokeFn: typeof invoke = invoke,
  convertFileSrcFn: typeof convertFileSrc = convertFileSrc
) => {
  if (!source.startsWith("/assets/") || !isTauri) {
    return source;
  }
  const cached = resolvedAssetSrcCache.get(source);
  if (cached) {
    return cached;
  }
  const pending = invokeFn<string>("resolve_asset_path", {
    assetPath: source,
    asset_path: source
  })
    .then((resolvedPath) => convertFileSrcFn(resolvedPath))
    .catch(() => {
      resolvedAssetSrcCache.delete(source);
      return source;
    });
  resolvedAssetSrcCache.set(source, pending);
  return pending;
};
