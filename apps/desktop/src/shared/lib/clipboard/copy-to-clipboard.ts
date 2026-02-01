export const copyToClipboard = async (content: string) => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return;
    } catch (error) {
      console.warn("Clipboard write failed", error);
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  } catch (error) {
    console.warn("Clipboard fallback failed", error);
  }
};
