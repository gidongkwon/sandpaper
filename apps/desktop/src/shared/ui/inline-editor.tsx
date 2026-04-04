import { cva, cx, type VariantProps } from "class-variance-authority";
import {
  Show,
  createEffect,
  createSignal,
  onMount,
  splitProps,
  type JSX
} from "solid-js";
import { MarkdownDisplay, type MarkdownDisplayHandlers } from "./markdown-display";

export const inlineEditorVariants = cva("ui-inline-editor", {
  variants: {
    font: {
      body: "ui-inline-editor--body",
      mono: "ui-inline-editor--mono"
    }
  },
  defaultVariants: {
    font: "body"
  }
});

export type InlineEditorProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> &
  VariantProps<typeof inlineEditorVariants> & {
    maxHeight?: number;
    autoResize?: boolean;
    displayMode?: "markdown";
    markdownDisplayHandlers?: MarkdownDisplayHandlers;
  };

export const InlineEditor = (props: InlineEditorProps) => {
  let textareaRef: HTMLTextAreaElement | undefined;
  let displayRef: HTMLDivElement | undefined;
  const [isEditing, setIsEditing] = createSignal(false);
  let storedSelection: { start: number; end: number } | null = null;
  let suppressNextDisplayFocus = false;

  const [local, rest] = splitProps(props, [
    "class",
    "font",
    "ref",
    "onFocus",
    "onInput",
    "onBlur",
    "onKeyDown",
    "onSelect",
    "value",
    "maxHeight",
    "autoResize",
    "displayMode",
    "markdownDisplayHandlers",
    "placeholder"
  ]);

  const resize = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "auto";
    const maxHeight = local.maxHeight ?? 120;
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, maxHeight)}px`;
  };

  const assignRef = (el: HTMLTextAreaElement) => {
    textareaRef = el;
    if (typeof local.ref === "function") {
      local.ref(el);
    }
  };
  const stringValue = () => String(local.value ?? "");
  const canRenderDisplay = () => local.displayMode === "markdown" && !isEditing();
  const rememberSelection = () => {
    if (!textareaRef) return;
    storedSelection = {
      start: textareaRef.selectionStart ?? 0,
      end: textareaRef.selectionEnd ?? 0
    };
  };

  const dispatchInput = () => {
    if (!textareaRef) return;
    textareaRef.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const applyMarkdownWrap = (prefix: string, suffix = prefix) => {
    if (!textareaRef) return;
    const start = textareaRef.selectionStart ?? 0;
    const end = textareaRef.selectionEnd ?? start;
    const selected = textareaRef.value.slice(start, end);
    const wrapped = `${prefix}${selected}${suffix}`;
    textareaRef.setRangeText(wrapped, start, end, "end");
    if (selected.length > 0) {
      textareaRef.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    } else {
      const caret = start + prefix.length;
      textareaRef.setSelectionRange(caret, caret);
    }
    rememberSelection();
    dispatchInput();
    if (local.autoResize !== false) {
      resize();
    }
  };

  const closeEditMode = (restoreDisplayFocus = false) => {
    if (local.displayMode !== "markdown" || !isEditing()) return;
    rememberSelection();
    setIsEditing(false);
    if (restoreDisplayFocus) {
      suppressNextDisplayFocus = true;
      requestAnimationFrame(() => {
        displayRef?.focus();
        suppressNextDisplayFocus = false;
      });
    }
  };

  const focusEditor = () => {
    requestAnimationFrame(() => {
      if (!textareaRef) return;
      textareaRef.focus();
      const selection = storedSelection;
      requestAnimationFrame(() => {
        if (!textareaRef) return;
        if (selection) {
          textareaRef.setSelectionRange(selection.start, selection.end);
        } else {
          const length = textareaRef.value.length;
          textareaRef.setSelectionRange(length, length);
        }
      });
      if (local.autoResize !== false) {
        resize();
      }
    });
  };

  const enterEditMode = () => {
    if (local.displayMode !== "markdown" || isEditing()) return;
    setIsEditing(true);
    focusEditor();
  };

  onMount(() => {
    if (local.autoResize !== false && local.displayMode !== "markdown") {
      requestAnimationFrame(resize);
    }
  });

  createEffect(() => {
    const currentValue = local.value;
    void currentValue;
    if (local.autoResize === false || canRenderDisplay()) return;
    requestAnimationFrame(resize);
  });

  return (
    <Show
      when={!canRenderDisplay()}
      fallback={
        <div
          ref={displayRef}
          class={cx(
            inlineEditorVariants({ font: local.font }),
            "ui-inline-editor--display",
            local.class
          )}
          tabIndex={0}
          onMouseDown={(event) => {
            if (event.target instanceof HTMLElement && event.target.closest("a, button")) {
              return;
            }
            event.preventDefault();
            enterEditMode();
          }}
          onFocus={() => {
            if (suppressNextDisplayFocus) return;
            enterEditMode();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              enterEditMode();
            }
          }}
        >
          <Show
            when={stringValue().trim().length > 0}
            fallback={<span class="block__placeholder">{local.placeholder ?? ""}</span>}
          >
            <MarkdownDisplay
              class="ui-inline-editor__display-markdown"
              text={stringValue()}
              {...local.markdownDisplayHandlers}
            />
          </Show>
        </div>
      }
    >
      <textarea
        {...rest}
        ref={(el) => assignRef(el)}
        value={local.value}
        placeholder={local.placeholder}
        class={cx(
          inlineEditorVariants({ font: local.font }),
          local.class
        )}
        onFocus={(event) => {
          (
            local.onFocus as
              | JSX.EventHandler<HTMLTextAreaElement, FocusEvent>
              | undefined
          )?.(event);
          const selection = storedSelection;
          if (!selection) return;
          const target = event.currentTarget;
          requestAnimationFrame(() => {
            if (document.contains(target)) {
              target.setSelectionRange(selection.start, selection.end);
            }
          });
        }}
        onInput={(event) => {
          (
            local.onInput as
              | JSX.EventHandler<HTMLTextAreaElement, InputEvent>
              | undefined
          )?.(event);
          rememberSelection();
          if (local.autoResize !== false) {
            resize();
          }
        }}
        onSelect={(event) => {
          (
            local.onSelect as
              | JSX.EventHandler<HTMLTextAreaElement, Event>
              | undefined
          )?.(event);
          rememberSelection();
        }}
        onKeyDown={(event) => {
          (
            local.onKeyDown as
              | JSX.EventHandler<HTMLTextAreaElement, KeyboardEvent>
              | undefined
          )?.(event);
          if (event.defaultPrevented) return;
          const hasCommandKey = event.ctrlKey || event.metaKey;
          if (event.key === "Escape" && local.displayMode === "markdown") {
            event.preventDefault();
            storedSelection = {
              start: event.currentTarget.selectionStart ?? 0,
              end: event.currentTarget.selectionEnd ?? 0
            };
            closeEditMode(true);
            return;
          }
          if (!hasCommandKey) return;
          if (event.key.toLowerCase() === "b") {
            event.preventDefault();
            applyMarkdownWrap("**");
            return;
          }
          if (event.key.toLowerCase() === "i") {
            event.preventDefault();
            applyMarkdownWrap("*");
            return;
          }
          if (event.shiftKey && event.key === "`") {
            event.preventDefault();
            applyMarkdownWrap("`");
          }
        }}
        onBlur={(event) => {
          (
            local.onBlur as
              | JSX.EventHandler<HTMLTextAreaElement, FocusEvent>
              | undefined
          )?.(event);
          closeEditMode(false);
        }}
      />
    </Show>
  );
};
