export type CodeLanguageOption = {
  value: string;
  label: string;
  shiki: string;
};

export const CODE_LANGUAGE_OPTIONS: CodeLanguageOption[] = [
  { value: "text", label: "Plain text", shiki: "txt" },
  { value: "js", label: "JavaScript", shiki: "javascript" },
  { value: "ts", label: "TypeScript", shiki: "typescript" },
  { value: "jsx", label: "JSX", shiki: "jsx" },
  { value: "tsx", label: "TSX", shiki: "tsx" },
  { value: "json", label: "JSON", shiki: "json" },
  { value: "bash", label: "Bash", shiki: "bash" },
  { value: "python", label: "Python", shiki: "python" },
  { value: "rust", label: "Rust", shiki: "rust" },
  { value: "go", label: "Go", shiki: "go" },
  { value: "java", label: "Java", shiki: "java" },
  { value: "c", label: "C", shiki: "c" },
  { value: "cpp", label: "C++", shiki: "cpp" },
  { value: "css", label: "CSS", shiki: "css" },
  { value: "html", label: "HTML", shiki: "html" },
  { value: "sql", label: "SQL", shiki: "sql" },
  { value: "yaml", label: "YAML", shiki: "yaml" },
  { value: "toml", label: "TOML", shiki: "toml" },
  { value: "markdown", label: "Markdown", shiki: "markdown" }
];

const CODE_LANGUAGE_LOOKUP = new Map(
  CODE_LANGUAGE_OPTIONS.map((option) => [option.value, option])
);

const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  plaintext: "text",
  txt: "text",
  text: "text",
  javascript: "js",
  typescript: "ts",
  py: "python",
  rs: "rust",
  shell: "bash",
  sh: "bash",
  cxx: "cpp",
  "c++": "cpp",
  yml: "yaml",
  md: "markdown"
};

export const normalizeCodeLanguage = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "text";
  if (CODE_LANGUAGE_LOOKUP.has(trimmed)) return trimmed;
  const alias = CODE_LANGUAGE_ALIASES[trimmed];
  if (alias && CODE_LANGUAGE_LOOKUP.has(alias)) return alias;
  return "text";
};

export const resolveShikiLanguage = (value: string) => {
  const normalized = normalizeCodeLanguage(value);
  return CODE_LANGUAGE_LOOKUP.get(normalized)?.shiki ?? "txt";
};

