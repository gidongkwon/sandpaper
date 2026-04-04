import { For, type JSX } from "solid-js";
import { cx } from "class-variance-authority";
import {
  INLINE_MARKDOWN_PATTERN,
  parseInlineLinkToken,
  parseMarkdownList,
  parseMarkdownTable,
  parseWikilinkToken
} from "../lib/markdown/inline-parser";

export type MarkdownDisplayHandlers = {
  onOpenWikilink?: (target: string) => void;
  onOpenWikilinkPreview?: (target: string, anchor: HTMLElement) => void;
  onCloseWikilinkPreview?: () => void;
};

export const renderInlineMarkdownNodes = (
  text: string,
  handlers: MarkdownDisplayHandlers = {}
): Array<string | JSX.Element> => {
  const nodes: Array<string | JSX.Element> = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE_MARKDOWN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }
    const token = match[0];
    if (token.startsWith("[[")) {
      const parsed = parseWikilinkToken(token);
      if (parsed) {
        if (handlers.onOpenWikilink) {
          nodes.push(
            <button
              type="button"
              class="wikilink"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handlers.onOpenWikilink?.(parsed.target);
              }}
              onMouseEnter={(event) =>
                handlers.onOpenWikilinkPreview?.(parsed.target, event.currentTarget)
              }
              onMouseLeave={() => handlers.onCloseWikilinkPreview?.()}
              onFocus={(event) =>
                handlers.onOpenWikilinkPreview?.(parsed.target, event.currentTarget)
              }
              onBlur={() => handlers.onCloseWikilinkPreview?.()}
            >
              {parsed.label}
            </button>
          );
        } else {
          nodes.push(<span class="wikilink">{parsed.label}</span>);
        }
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("[")) {
      const parsed = parseInlineLinkToken(token);
      if (parsed) {
        nodes.push(
          <a
            href={parsed.href}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-link"
          >
            {parsed.label}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("`")) {
      nodes.push(<code>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~")) {
      nodes.push(<del>{token.slice(2, -2)}</del>);
    } else if (token.startsWith("*")) {
      nodes.push(<em>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
};

export const renderMarkdownDisplayContent = (
  text: string,
  handlers: MarkdownDisplayHandlers = {}
): JSX.Element => {
  const table = parseMarkdownTable(text);
  if (table) {
    return (
      <div class="markdown-table-wrap">
        <table class="markdown-table">
          <thead>
            <tr>
              <For each={table.headers}>
                {(cell) => <th>{renderInlineMarkdownNodes(cell, handlers)}</th>}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={table.rows}>
              {(row) => (
                <tr>
                  <For each={row}>
                    {(cell) => <td>{renderInlineMarkdownNodes(cell, handlers)}</td>}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    );
  }
  const list = parseMarkdownList(text);
  if (list) {
    const items = (
      <For each={list.items}>
        {(item) => <li>{renderInlineMarkdownNodes(item, handlers)}</li>}
      </For>
    );
    if (list.type === "ol") {
      return <ol class="markdown-list">{items}</ol>;
    }
    return <ul class="markdown-list">{items}</ul>;
  }
  return <span>{renderInlineMarkdownNodes(text, handlers)}</span>;
};

type MarkdownDisplayProps = MarkdownDisplayHandlers & {
  text: string;
  class?: string;
};

export const MarkdownDisplay = (props: MarkdownDisplayProps) => {
  return (
    <div class={cx("block__display", props.class)}>
      {renderMarkdownDisplayContent(props.text, props)}
    </div>
  );
};
