import js from "@eslint/js";
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid";

export default [
  { ignores: ["dist", "src-tauri/target", "src-tauri/gen"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"] ,
    plugins: { solid },
    rules: {
      "solid/reactivity": "warn",
      "solid/no-destructure": "warn",
      "solid/prefer-for": "warn"
    }
  }
];
