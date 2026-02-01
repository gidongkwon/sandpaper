import type { CaretPosition } from "../../model/position";

export const getCaretPosition = (
  textarea: HTMLTextAreaElement,
  position: number
): CaretPosition => {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "break-word";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.boxSizing = style.boxSizing;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = textarea.value.slice(0, Math.max(0, position));

  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(position) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);

  const textareaRect = textarea.getBoundingClientRect();
  const rawLineHeight = parseFloat(style.lineHeight || "");
  const lineHeight = Number.isFinite(rawLineHeight) ? rawLineHeight : 16;
  const offsetX = markerRect.left - mirrorRect.left;
  const offsetY = markerRect.top - mirrorRect.top;

  return {
    x: textareaRect.left + offsetX - textarea.scrollLeft,
    y: textareaRect.top + offsetY - textarea.scrollTop + lineHeight
  };
};
