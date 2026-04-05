import { readFileSync } from "node:fs";

const IMPORT_PATTERN = /^@import\s+(?:url\()?(?:"([^"]+)"|'([^']+)')\)?\s*;/gmu;

const getCandidateUrls = (relativePath: string) => {
  const runtime = globalThis as {
    process?: {
      cwd?: () => string;
    };
  };
  const cwd = runtime.process?.cwd?.() ?? "";

  return [
    new URL(`../${relativePath}`, import.meta.url),
    ...(cwd
      ? [
          new URL(`file://${cwd}/src/${relativePath}`),
          new URL(`file://${cwd}/apps/desktop/src/${relativePath}`)
        ]
      : [])
  ];
};

const readFromCandidates = (relativePath: string): string => {
  for (const candidate of getCandidateUrls(relativePath)) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
  }

  throw new Error(`Unable to resolve app path for ${relativePath}`);
};

const inlineLocalImports = (
  relativePath: string,
  visited = new Set<string>()
): string => {
  if (visited.has(relativePath)) return "";
  visited.add(relativePath);

  const source = readFromCandidates(relativePath);

  return source.replace(IMPORT_PATTERN, (_full, doubleQuoted, singleQuoted) => {
    const importPath = String(doubleQuoted ?? singleQuoted ?? "");
    if (!importPath.startsWith(".")) return "";

    const normalizedPath = relativePath.replace(/\\/gu, "/");
    const basePath = normalizedPath.slice(0, normalizedPath.lastIndexOf("/") + 1);
    const nextPath = new URL(importPath, `file:///virtual/${basePath}`).pathname.replace(
      /^\/virtual\//u,
      ""
    );

    return inlineLocalImports(nextPath, visited);
  });
};

export const readAppStyleFile = (relativePath: string) => readFromCandidates(relativePath);

export const readAppStyles = () => inlineLocalImports("app/styles/index.css");

export const readAppSourceFile = (relativePath: string) => readFromCandidates(relativePath);
