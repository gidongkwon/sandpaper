import { invoke } from "@tauri-apps/api/core";

export type ImportedImageAssetPayload = {
  asset_path: string;
  markdown: string;
  mime_type: string;
  original_name: string;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
};

export const importImageAssetFile = async (
  file: File,
  invokeFn: typeof invoke = invoke
) => {
  const filename = file.name || "image";
  const mimeType = file.type || "application/octet-stream";
  const buffer = await file.arrayBuffer();
  const bytesB64 = bytesToBase64(new Uint8Array(buffer));
  return invokeFn<ImportedImageAssetPayload>("import_image_asset_bytes", {
    payload: {
      filename,
      mimeType,
      mime_type: mimeType,
      bytesB64,
      bytes_b64: bytesB64
    }
  });
};
