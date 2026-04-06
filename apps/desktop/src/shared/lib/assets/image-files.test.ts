import { describe, expect, it } from "vitest";
import {
  extractImageFilesFromClipboardData,
  extractImageFilesFromDataTransfer,
  isImageFile
} from "./image-files";

describe("image-files", () => {
  it("detects image files by mime type or extension", () => {
    expect(isImageFile(new File(["a"], "cat.png", { type: "image/png" }))).toBe(true);
    expect(isImageFile(new File(["a"], "cat.webp", { type: "" }))).toBe(true);
    expect(isImageFile(new File(["a"], "notes.txt", { type: "text/plain" }))).toBe(false);
  });

  it("extracts image files from data transfer files", () => {
    const image = new File(["a"], "cat.png", { type: "image/png" });
    const text = new File(["b"], "note.txt", { type: "text/plain" });

    expect(extractImageFilesFromDataTransfer({ files: [image, text] })).toEqual([image]);
  });

  it("falls back to clipboard items when files are empty", () => {
    const image = new File(["a"], "shot.png", { type: "image/png" });

    expect(
      extractImageFilesFromClipboardData({
        files: [],
        items: [
          {
            kind: "string",
            type: "text/html",
            getAsFile: () => null
          },
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => image
          }
        ]
      })
    ).toEqual([image]);
  });

  it("prefers image files over clipboard html or text payloads", () => {
    const image = new File(["a"], "shot.png", { type: "image/png" });

    expect(
      extractImageFilesFromClipboardData({
        files: [image],
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => image
          },
          {
            kind: "string",
            type: "text/html",
            getAsFile: () => null
          }
        ]
      })
    ).toEqual([image]);
  });
});
