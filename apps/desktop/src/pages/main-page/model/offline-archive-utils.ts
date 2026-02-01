export type OfflineExportManifest = {
  version: number;
  exported_at: string;
  page_count: number;
  asset_count: number;
  vault_name?: string;
  pages: Array<{ uid: string; title: string; file: string }>;
};

type OfflineExportPage = {
  uid: string;
  title: string;
};

type BuildManifestInput = {
  pages: OfflineExportPage[];
  exportedAt: string;
  vaultName?: string;
};

export const buildOfflineExportManifest = (input: BuildManifestInput) => {
  const manifest: OfflineExportManifest = {
    version: 1,
    exported_at: input.exportedAt,
    page_count: input.pages.length,
    asset_count: 0,
    vault_name: input.vaultName,
    pages: input.pages.map((page) => ({
      uid: page.uid,
      title: page.title,
      file: `pages/${page.uid}.md`
    }))
  };
  return manifest;
};
