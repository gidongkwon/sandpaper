# Image Paste Implementation Checklist

## Purpose

This document explains how to add image paste support to the desktop app in a way that a junior developer can implement without guessing the intent.

The feature must work in both places:

- Capture mode composer
- Review/editor document editor

The feature must also support asset import into the vault, not just temporary browser previews.

## What Success Looks Like

After this work is done, the app should behave like this:

1. The user can paste an image into the main editor.
2. The pasted image is imported into the active vault and becomes an image block.
3. The user can paste or drag images into the capture composer.
4. The capture composer shows staged image thumbnails before send.
5. Sending the capture imports the staged images into the vault and creates hidden-inbox blocks with capture batch metadata.
6. Review and capture surfaces can show those imported images as thumbnails, not just `/assets/...` text.
7. If review content is moved into a normal page, the capture-specific metadata is removed immediately.

## Decisions Already Made

Do not reopen these decisions during implementation.

- Use a generic `Block.meta` field.
- Store capture metadata as `meta.capture = { batchId, order, role }`.
- Persist that metadata through shadow markdown using `<!--sp:{...}-->`.
- Remove `meta.capture` immediately when content is committed into a normal page.
- Capture composer uses a separate attachment tray, not inline markdown inside the textarea.
- Capture composer allows image-only sends.
- Capture composer imports staged images on `Send`, not at paste time.
- Capture draft attachments live in memory only. Do not persist them across restart.
- Capture composer supports both paste and drag-and-drop.
- Prefer image clipboard blobs over text/html or plain text when both exist.
- In the editor, only images are auto-imported from paste. Do not auto-import generic files from paste.
- In the editor, pasting into an empty text block replaces that block with the first imported image block.
- In the editor, pasting into a non-empty text block inserts image blocks below the current block.
- Capture send uses partial success:
  - successful imports are saved
  - failed imports stay in the composer tray
- Capture/review image UI for v1 only needs:
  - open/preview
  - delete one attachment
- Capture/review should show as many thumbnails as the layout allows.
- Local `/assets/...` images must render as actual images, not plain text paths.

## Read These Files First

Read these before changing anything:

- `apps/desktop/src/widgets/editor/editor-pane.tsx`
- `apps/desktop/src/widgets/capture/capture-pane.tsx`
- `apps/desktop/src/pages/main-page/model/use-main-page-state.ts`
- `apps/desktop/src/entities/block/model/block-types.ts`
- `apps/desktop/src/entities/review/model/review-types.ts`
- `packages/core-model/src/block-model.ts`
- `packages/core-model/src/markdown-parser.ts`
- `packages/core-model/src/markdown-serializer.ts`
- `packages/core-model/src/shadow-writer.ts`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src/app-editor-ux.test.tsx`
- `apps/desktop/src/widgets/editor/editor-pane.test.tsx`

## High-Level Design

There are two separate flows in this task.

### Flow A: Editor Paste

The editor already has paste and drop hooks. Extend that flow so image clipboard blobs import into the vault and become image blocks with the correct insertion rule.

### Flow B: Capture Draft Attachments

Capture currently stores only one text string before send. Add a separate in-memory attachment tray for staged image files. On send, import those files, create hidden-inbox blocks, attach `meta.capture`, and clear only the attachments that imported successfully.

### Shared Rule: Capture Batch Metadata

Capture attachments and capture text created from one send must be grouped by shared metadata so the app can render one logical capture even when it spans multiple blocks.

## Non-Goals For This Iteration

Do not do these in the first implementation:

- Do not add generic file paste to the capture composer.
- Do not add drag-reorder for staged composer attachments.
- Do not add replace-image actions.
- Do not persist unsent capture attachment drafts.
- Do not redesign the whole review model beyond what is necessary for capture batch rendering.
- Do not build a full media lightbox unless it becomes necessary to open local assets.

## Recommended New Types

Add these types before changing UI logic.

### Core Block Metadata

In `packages/core-model/src/block-model.ts`, extend `Block` with a generic metadata field.

Recommended shape:

```ts
export type CaptureBlockMeta = {
  batchId: string;
  order: number;
  role: "body" | "attachment";
};

export type BlockMeta = {
  capture?: CaptureBlockMeta;
};

export type Block = {
  id: string;
  text: string;
  indent: number;
  block_type?: BlockType;
  meta?: BlockMeta;
};
```

Keep the same shape in the desktop app block types.

### Capture Draft Attachment

Add a desktop-only type for unsent capture attachments.

Recommended shape:

```ts
type CaptureDraftAttachment = {
  id: string;
  file: File;
  name: string;
  mimeType: string;
  previewUrl: string;
};
```

Do not put this type into core-model. It is UI-only draft state.

### Capture Batch View Models

Current capture UI assumes one block equals one item. That is no longer enough.

Add normalized view models for the UI:

```ts
type CaptureBatchEntry = {
  id: string;
  indent: number;
  blocks: Block[];
  capturedAt: number | null;
};

type CaptureThreadView = {
  id: string;
  root: CaptureBatchEntry;
  replies: CaptureBatchEntry[];
};
```

The UI should work from normalized batch entries, not raw blocks.

## Implementation Strategy

Use TDD. Each phase starts by adding or updating tests first.

### Phase 1: Add Tests For Metadata Round-Trips

Goal: prove that block metadata survives parse and serialize before changing product code.

Checklist:

- [ ] Add tests in `packages/core-model/src/markdown-serializer.test.ts`.
- [ ] Add tests in `packages/core-model/src/markdown-parser.test.ts`.
- [ ] Verify `Block.meta.capture` survives markdown round-trip.
- [ ] Verify markdown-native image blocks still emit `<!--sp:{...}-->` when `meta` exists.
- [ ] Verify parsing still works for old markdown that only stores `{"type":"callout"}` style metadata.
- [ ] Verify markdown without metadata still parses exactly as before.

Acceptance criteria:

- [ ] A text block with `meta.capture` round-trips correctly.
- [ ] An image block with `meta.capture` round-trips correctly.
- [ ] Existing parser behavior for legacy files is not broken.

### Phase 2: Add `Block.meta` Plumbing Everywhere

Goal: make metadata legal in all TypeScript and Rust payloads before using it.

Checklist:

- [ ] Update `packages/core-model/src/block-model.ts`.
- [ ] Update `apps/desktop/src/entities/block/model/block-types.ts`.
- [ ] Update block payload types that cross the Tauri boundary.
- [ ] Update block creation helpers so new blocks can optionally receive metadata.
- [ ] Keep existing callers working by making `meta` optional.
- [ ] Update Rust-side serialize/deserialize structs in `apps/desktop/src-tauri/src/lib.rs`.
- [ ] Search for all block clone or snapshot code and make sure metadata is copied, not dropped.

Acceptance criteria:

- [ ] The app compiles.
- [ ] No existing block save path silently strips metadata.

### Phase 3: Generalize Shadow Markdown Metadata

Goal: persist block type and block metadata together.

Important note:

Current markdown serialization only emits `<!--sp:{...}-->` for non-markdown-native block types. That logic must change. If a block has `meta`, serialization must emit an `sp` marker even when the block type is markdown-native.

Checklist:

- [ ] Update `packages/core-model/src/markdown-serializer.ts`.
- [ ] Update `packages/core-model/src/markdown-parser.ts`.
- [ ] Support `<!--sp:{"type":"callout"}-->`.
- [ ] Support `<!--sp:{"meta":{"capture":...}}-->`.
- [ ] Support `<!--sp:{"type":"image","meta":{"capture":...}}-->`.
- [ ] Keep the `type` field optional in parsing.
- [ ] Keep the `meta` field optional in parsing.
- [ ] Do not require `type` when markdown text already implies the block type.

Acceptance criteria:

- [ ] Old files still load.
- [ ] New files with capture metadata reload without loss.
- [ ] Image and file markdown can carry extra metadata safely.

### Phase 4: Add Shared Image Intake Helpers

Goal: avoid duplicating clipboard and drop parsing logic in the editor and capture composer.

Recommended new helper files:

- `apps/desktop/src/shared/lib/assets/extract-image-files.ts`
- `apps/desktop/src/shared/lib/assets/import-image-asset.ts`
- `apps/desktop/src/shared/lib/assets/resolve-asset-src.ts`

Checklist:

- [ ] Add one helper that reads image `File` objects from `ClipboardEvent`.
- [ ] Add support for both `clipboardData.files` and `clipboardData.items`.
- [ ] Ignore non-image clipboard entries.
- [ ] Add one helper that reads image `File` objects from drag-and-drop.
- [ ] Add one helper that imports an image `File` through the Tauri command `import_image_asset_bytes`.
- [ ] Keep editor and capture using the same image import helper.
- [ ] Add unit tests for clipboard item extraction if the helper is pure enough to test directly.

Acceptance criteria:

- [ ] A screenshot pasted from the OS is accepted even if it only appears in clipboard items.
- [ ] Browser-style clipboard entries that include image plus html do not duplicate input.

### Phase 5: Finish Editor Paste And Drop Behavior

Goal: make the editor behavior match the agreed UX.

Checklist:

- [ ] Add tests in `apps/desktop/src/widgets/editor/editor-pane.test.tsx` or `apps/desktop/src/app-editor-ux.test.tsx`.
- [ ] Test paste into an empty text block.
- [ ] Test paste into a non-empty text block.
- [ ] Test multiple pasted images.
- [ ] Test that paste with image blob prevents text/html insertion.
- [ ] Test that generic non-image clipboard content still behaves normally.
- [ ] Update editor paste handling to use the shared intake helper.
- [ ] Keep generic file paste disabled.
- [ ] Replace the current block when:
  - the active block is text
  - the block is empty after trim
  - at least one image imported successfully
- [ ] Insert below the active block when the current block is not empty.
- [ ] Preserve the current indentation rule for inserted image blocks.
- [ ] Focus the first inserted image block after import.

Acceptance criteria:

- [ ] Empty text block paste does not leave a stray blank block above the image.
- [ ] Non-empty text block paste does not split the paragraph.
- [ ] Multiple pasted images appear in pasted order.

### Phase 6: Add Local Asset Image Rendering

Goal: imported `/assets/...` paths should render as images in the webview.

Important note:

Do not assume `/assets/foo.png` can be used directly as an `img src` inside the Tauri webview. Add an explicit resolver.

Recommended approach:

1. Add a Tauri command that resolves a vault-relative asset path like `/assets/foo.png` to an absolute file path.
2. On the client, convert that absolute file path to a webview-safe URL.
3. Cache resolved URLs so lists of thumbnails do not spam the backend.

Checklist:

- [ ] Add a Tauri command in `apps/desktop/src-tauri/src/lib.rs` for resolving an asset path.
- [ ] Add a shared client helper in `apps/desktop/src/shared/lib/assets/resolve-asset-src.ts`.
- [ ] Add memoization or lightweight caching on the client side.
- [ ] Update editor image rendering to use the resolved URL for local assets.
- [ ] Reuse the same helper in capture and review thumbnail UI.
- [ ] Add tests for the client helper if the logic is isolated enough.

Acceptance criteria:

- [ ] Imported local asset images display as thumbnails.
- [ ] Remote image URLs continue to work.
- [ ] Broken asset paths fail gracefully.

### Phase 7: Add Capture Composer Draft Attachment State

Goal: the capture composer must hold staged attachments before send.

Checklist:

- [ ] Add attachment draft state in `apps/desktop/src/pages/main-page/model/use-main-page-state.ts`.
- [ ] Recommended signals:
  - `captureAttachments`
  - `setCaptureAttachments`
- [ ] Add helpers:
  - `addCaptureAttachments(files)`
  - `removeCaptureAttachment(id)`
  - `clearSuccessfulCaptureAttachments(ids)`
- [ ] Generate `previewUrl` with `URL.createObjectURL`.
- [ ] Revoke preview URLs when an attachment is removed.
- [ ] Revoke preview URLs on cleanup when the state owner unmounts.
- [ ] Do not persist this draft state to local storage.
- [ ] Reset draft attachments when the user intentionally clears or sends them.

Acceptance criteria:

- [ ] The composer can contain zero text and multiple staged images.
- [ ] Attachment previews disappear cleanly when removed.
- [ ] Object URLs are not leaked forever.

### Phase 8: Update Capture Composer UI

Goal: render a proper attachment tray and support image paste/drop.

Checklist:

- [ ] Update `apps/desktop/src/widgets/capture/capture-pane.tsx`.
- [ ] Add a visible attachment tray above or below the composer input.
- [ ] Show image thumbnails for all staged attachments when space allows.
- [ ] Add a remove button for each staged attachment.
- [ ] Add an open/preview action if practical in v1.
- [ ] Add paste handling for image clipboard blobs.
- [ ] Add dragover/drop handling for image files.
- [ ] Prevent default browser file-drop behavior in the capture surface.
- [ ] Keep existing Enter and Ctrl+Enter capture shortcuts working.
- [ ] Allow send when:
  - text exists
  - or at least one attachment is staged
- [ ] Keep send disabled only when both are empty.
- [ ] Add UI affordance for drop target state if it can be done cheaply.

Acceptance criteria:

- [ ] Pasting an image into the composer creates a staged thumbnail.
- [ ] Dropping an image into the composer creates a staged thumbnail.
- [ ] Sending with no text but with images works.

### Phase 9: Create Capture Batches On Send

Goal: one send action may create multiple blocks that still belong to one logical capture.

Checklist:

- [ ] Update the capture send path in `apps/desktop/src/pages/main-page/model/use-main-page-state.ts`.
- [ ] Keep plain-text capture send working.
- [ ] When sending attachments:
  - import each attachment through the shared image import helper
  - build one `batchId`
  - create block metadata with `order` matching staged order
  - use `role: "body"` for the text block when text exists
  - use `role: "attachment"` for imported image blocks
- [ ] Allow image-only batches:
  - first image may have `order: 0`
  - there is no required text block
- [ ] Preserve current reply behavior:
  - replies still belong to the existing capture thread
  - batch metadata groups the blocks inside one reply payload
- [ ] On partial import failure:
  - save successful imports
  - leave failed attachments in the tray
  - keep unsent text only if nothing at all was saved
  - notify the user about partial failure
- [ ] Clear the composer text only when the text was successfully sent.
- [ ] Keep focus behavior consistent after send.

Acceptance criteria:

- [ ] One send can create text plus multiple image blocks under one batch id.
- [ ] Image-only sends work.
- [ ] A failed image import does not lose the successful ones.

### Phase 10: Normalize Hidden Inbox Blocks Into Batch Entries

Goal: capture and review surfaces must render one logical capture entry even when it spans multiple blocks.

Important note:

Current `captureItems()` logic assumes:

- one root block per thread
- replies are any later blocks with `indent > 0`

That is no longer sufficient. The code must group contiguous blocks that share the same `meta.capture.batchId`.

Recommended grouping rule:

1. Scan hidden inbox blocks in order.
2. When a block has `meta.capture.batchId`, collect contiguous sibling blocks with:
   - the same `batchId`
   - the same `indent`
3. Treat that group as one logical batch entry.
4. Use indent to decide whether the batch entry is a thread root or a reply.
5. If a block has no capture metadata, treat it as a one-block batch entry for backward compatibility.

Checklist:

- [ ] Replace raw block-based capture item derivation with batch-based derivation.
- [ ] Update `captureItems()` output shape accordingly.
- [ ] Update `reviewThreads()` logic if it depends on raw block assumptions.
- [ ] Keep old hidden inbox content without metadata visible and editable.
- [ ] Add tests for:
  - text-only batch
  - image-only batch
  - text plus multiple images
  - reply batch with attachments
  - legacy single-block capture without metadata

Acceptance criteria:

- [ ] Capture and review treat one send as one logical item.
- [ ] Reply threading still works.
- [ ] Legacy data still renders.

### Phase 11: Update Capture And Review Rendering For Batches

Goal: render batch content instead of assuming one text block per item.

Checklist:

- [ ] Update `apps/desktop/src/widgets/capture/capture-pane.tsx`.
- [ ] Update review UI components in `apps/desktop/src/widgets/review/`.
- [ ] For each batch entry, show:
  - text body if present
  - image thumbnails for attachments
- [ ] For image-only batches, show the thumbnails without forcing fake text.
- [ ] Show as many thumbnails as the layout allows before any `+N` fallback.
- [ ] Keep the layout readable on narrow widths.
- [ ] Add delete actions for one attachment.
- [ ] When deleting one attachment block:
  - remove only that block
  - if the batch becomes empty, remove the whole batch entry
  - if the deleted batch was the last content in a thread, remove the thread
- [ ] Make sure timestamp labels still describe the whole batch entry.

Acceptance criteria:

- [ ] Review users can visually identify image captures quickly.
- [ ] Capture users can edit or remove mistaken attachments after send.

### Phase 12: Remove Capture Metadata When Moving Into Normal Pages

Goal: capture grouping rules must not leak into ordinary note editing.

Checklist:

- [ ] Find the review completion path in `apps/desktop/src/pages/main-page/model/use-main-page-state.ts`.
- [ ] Add a helper like `stripCaptureMeta(blocks)` before committing capture content into a normal page.
- [ ] Remove only `meta.capture`.
- [ ] Keep any future non-capture metadata intact if it exists.
- [ ] Make sure the stripped blocks are the version saved into the destination page.
- [ ] Add tests covering:
  - review completion into destination page
  - restored destination page state after completion
  - metadata not present in the final normal page blocks

Acceptance criteria:

- [ ] Normal page editing does not carry hidden capture grouping state.
- [ ] Capture/review still work before completion.

### Phase 13: Final Validation

Goal: prove the whole feature works end to end.

Checklist:

- [ ] Run targeted tests for core-model metadata parsing and serialization.
- [ ] Run targeted editor tests.
- [ ] Run targeted app-level capture/review tests.
- [ ] Add one end-to-end style app test that covers:
  - paste image into capture composer
  - send capture
  - open review
  - see thumbnails
  - commit into destination page
  - confirm destination page has no `meta.capture`
- [ ] Run `vp run -r check`.
- [ ] Run `vp run -r test`.

Acceptance criteria:

- [ ] No type errors.
- [ ] No regressions in existing editor and capture workflows.
- [ ] The new image flows are covered by tests, not just manual QA.

## Recommended Order Of Actual Code Changes

If you are implementing this for the first time, follow this order exactly:

1. Add metadata types.
2. Add parser and serializer tests.
3. Make metadata survive save and load.
4. Add shared image intake and import helpers.
5. Finish editor paste behavior.
6. Add local asset URL resolution and thumbnail rendering.
7. Add capture draft attachment state.
8. Add capture composer tray UI.
9. Make send create batch metadata.
10. Change capture/review normalization to batch entries.
11. Update capture/review rendering.
12. Strip capture metadata during review commit.
13. Run validation.

## Common Mistakes To Avoid

- Do not store unsent capture `File` objects in local storage.
- Do not import capture assets immediately on paste.
- Do not assume `clipboardData.files` is enough for screenshots.
- Do not keep using raw hidden inbox block order without batch grouping.
- Do not leave `meta.capture` inside normal page blocks after review completion.
- Do not render `/assets/...` as plain text once local image resolution exists.
- Do not skip tests for markdown round-trip. Metadata persistence is easy to break silently.

## Definition Of Done

This task is done only when all of these are true:

- [ ] Editor image paste works.
- [ ] Capture composer image paste works.
- [ ] Capture composer image drop works.
- [ ] Asset import is used in both flows.
- [ ] Imported local assets render as images.
- [ ] Capture batch metadata persists through shadow markdown.
- [ ] Capture/review UI groups one send as one logical item.
- [ ] Review completion strips capture metadata from normal pages.
- [ ] Tests cover the new behavior.
- [ ] `vp run -r check` passes.
- [ ] `vp run -r test` passes.
