/// <reference types="vite/client" />

declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "node:fs" {
  export function readFileSync(
    path: string | URL,
    encoding: "utf8"
  ): string;
}
