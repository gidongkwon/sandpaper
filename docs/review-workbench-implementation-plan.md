# Review Workbench Implementation Plan

## Purpose

This document explains how to replace the current review UI with a new review workbench that matches the agreed product direction:

- One review session handles one capture thread and one destination document.
- The left side shows a review-only reference surface.
- The right side shows the real editor for the destination document.
- Completing a review archives the capture thread instead of deleting it.
- Review session state must survive app restart, but stale sessions must be invalidated safely.

This plan is written for a junior developer who does not already know this codebase.

## Product Summary

The new review workflow should behave like this:

1. The user opens Review mode.
2. The left side shows a stacked deck of capture-thread cards in `To Review`.
3. The active card is the thread currently being summarized.
4. The right side opens a recommended destination document in the real editor.
5. The recommended document is not final yet. It is only "soft-selected".
6. When the user clicks into the editor and starts editing, the destination becomes "hard-selected".
7. At the moment of hard-selection, the app stores a baseline hash of the destination page.
8. The review can only be completed when the destination page has changed compared to that baseline.
9. Completing the review archives the thread and stores which destination page it was summarized into.
10. Archived threads can later be browsed in `Archived`. Clicking one opens its destination document on the right.

## Terms

- Capture thread: A group of captured entries currently derived from the hidden inbox page.
- To Review: Threads that are still waiting to be summarized.
- Archived: Threads that were already reviewed and have a destination page.
- Destination page: The note the user writes into during review.
- Soft-selected destination: A recommended page is open, but the user has not started editing yet.
- Hard-selected destination: The user has started editing that page for this review session.
- Baseline hash: A hash of the destination page captured at the moment of hard-selection.
- Session diff: The current destination page differs from the stored baseline hash.
- Invalidated session: A restored session can no longer safely revert because the destination page changed outside the session.

## Current Relevant Files

Read these files before changing anything:

- `apps/desktop/src/pages/main-page/model/use-main-page-state.ts`
- `apps/desktop/src/widgets/review/review-pane.tsx`
- `apps/desktop/src/widgets/capture/capture-pane.tsx`
- `apps/desktop/src/widgets/editor/editor-pane.tsx`
- `apps/desktop/src/pages/main-page/ui/main-page-workspace.tsx`
- `apps/desktop/src/entities/review/model/review-types.ts`
- `apps/desktop/src/features/vault/model/use-vault-loaders.ts`
- `apps/desktop/src/app-editor-ux.test.tsx`
- `apps/desktop/src/app-modes.test.tsx`

Also read these helper files because they already contain logic that will be reused:

- `apps/desktop/src/pages/main-page/model/use-page-ops.ts`
- `apps/desktop/src/pages/main-page/model/use-review.ts`
- `apps/desktop/src/pages/main-page/model/use-search.tsx`
- `apps/desktop/src/pages/main-page/model/use-backlinks.ts`

## High-Level Architecture Changes

The current review feature mixes together two different ideas:

- A capture-thread workbench.
- A separate review queue system.

For this task, focus on the capture-thread workbench flow first. The new workbench should introduce explicit review-session state and explicit archived-thread state.

Implement the new design with these building blocks:

- A new `ReviewWorkbench` container component.
- A new `ReviewQueueDeck` component for `To Review`.
- A new `ReviewArchiveList` component for `Archived`.
- A new `ReviewReferenceCard` component for rendering one thread as a read-only reference card.
- A new `ReviewSessionBar` component above the editor.
- New review model types for:
  - review tabs
  - archived review records
  - destination recommendations
  - review session persistence

## Non-Goals For This Iteration

Do not do these in the first implementation:

- Do not add AI recommendations yet.
- Do not add restore-from-archive actions.
- Do not add permanent delete for archived threads.
- Do not add explicit copy buttons to the reference pane.
- Do not redesign Capture mode in this task unless needed to support archive storage.
- Do not merge the old database-backed `review_queue` feature into this new workflow yet.

## Required UX Decisions

These are already decided and must not be re-opened during implementation:

- One thread maps to one destination document per review session.
- The right side always uses the real `EditorPane`.
- The left review surface is read-only.
- The left `To Review` view is a 3D-style stacked deck.
- The left `Archived` view is a flattened, scrollable list with a transition from the deck state.
- The deck shows:
  - one active card
  - two next cards peeking behind it
  - an `n more` label for the remaining queue count
- Cards do not show a thread title.
- Cards do not show entry count.
- Cards show a single time-range label:
  - `captured A`
  - or `captured A - B`
- All entries inside a card have equal visual weight.
- Entry order must match capture order.
- Soft-selected destinations show a `Recommended` badge.
- Hard-selected destinations do not show that badge.
- Hard-selected destination switching must require confirmation if there is a session diff.
- Review completion requires:
  - an active thread
  - a hard-selected destination
  - a destination page diff relative to the baseline hash
- Completing review archives the thread instead of deleting it.
- Archived items must always have a destination page.
- Review session state must persist across restart.
- If the restored baseline is stale, the session must be invalidated.

## Implementation Strategy

Do the work in phases. Do not jump ahead.

### Phase 1: Add New Types

Goal: make the data model explicit before replacing UI.

Checklist:

- [x] Open `apps/desktop/src/entities/review/model/review-types.ts`.
- [x] Add a `ReviewTab` type with values:
  - `to-review`
  - `archived`
- [x] Add a `DestinationRecommendation` type with fields:
  - `page_uid`
  - `title`
  - `score`
  - `reasons`
  - `provider`
- [x] Add a `ReviewThreadStatus` type with values:
  - `to-review`
  - `archived`
- [x] Add a `ReviewThreadArchiveRecord` type with fields:
  - `thread_id`
  - `destination_page_uid`
  - `archived_at`
  - `captured_at_start`
  - `captured_at_end`
- [x] Add a `ReviewSessionState` type with fields:
  - `active_thread_id`
  - `tab`
  - `selected_archived_thread_id`
  - `destination_page_uid`
  - `destination_recommendations`
  - `is_hard_selected`
  - `baseline_page_hash`
  - `invalidated`
  - `updated_at`
- [x] Keep naming kebab-case for files and existing TypeScript style.
- [x] Do not remove existing review types yet unless they are clearly unused by the new flow.

Acceptance criteria:

- [x] Types compile.
- [x] A reader can understand session state without searching other files.

### Phase 2: Add State For Archived Threads And Review Session

Goal: teach `use-main-page-state.ts` about archived threads and session persistence.

Checklist:

- [x] Open `apps/desktop/src/pages/main-page/model/use-main-page-state.ts`.
- [x] Find current capture-thread logic around `captureInboxBlocks`, `captureItems`, `reviewThreads`, and `reviewThreadOrder`.
- [x] Add local state for archived thread metadata.
- [x] Add local state for the current review session.
- [x] Add local-storage keys for:
  - active review tab
  - archived thread metadata
  - active review session
  - selected archived thread
- [x] Keep existing hidden inbox page as the source of active review threads for now.
- [x] Do not store archived threads in the same active queue list.
- [x] When a thread is archived:
  - remove it from the active review queue
  - store archive metadata
  - keep the source thread data accessible for the archive UI
- [x] Decide how archived source data is stored for v1.
- [x] Recommended v1 approach:
  - keep archived thread snapshots in persisted local state
  - do not try to rebuild them only from the inbox after archive
- [x] Add helper selectors:
  - `toReviewThreads`
  - `archivedThreads`
  - `activeReviewThread`
  - `selectedArchivedThread`
- [x] Add helper methods:
  - `startReviewSession`
  - `hardSelectDestination`
  - `invalidateReviewSession`
  - `archiveReviewThread`
  - `discardReviewSessionChanges`
- [x] Keep function names plain and specific.

Acceptance criteria:

- [x] Review state exists even before the new UI is built.
- [x] Archiving no longer depends on deleting source data permanently.
- [x] Session state can be serialized and restored.

### Phase 3: Add Page Hash Utilities

Goal: implement safe diff detection and stale-session invalidation.

Checklist:

- [x] Create a small helper module if needed, for example:
  - `apps/desktop/src/pages/main-page/model/review-session-hash.ts`
- [x] Add a function that computes a stable page hash from:
  - page uid
  - page title
  - block ids
  - block text
  - block indent
  - block type
- [x] Use a deterministic representation such as JSON stringification of a normalized object.
- [x] Keep the helper synchronous.
- [x] Do not use a cryptographic hash unless already present in the repo and convenient.
- [x] Add tests for the hash helper:
  - same input -> same hash
  - changed block text -> different hash
  - changed indent -> different hash
  - changed title -> different hash
- [x] At hard-selection time, compute and store the baseline hash.
- [x] At completion time, compare current hash with baseline hash.
- [x] On app restore, compare restored baseline with current page hash.
- [x] If the destination page has changed in a way that invalidates the session:
  - mark the session as invalidated
  - stop offering revert-based switching for that session
  - require the session to restart from soft-selected state

Acceptance criteria:

- [x] Completion can be blocked on real page changes.
- [x] A stale restored session is detected reliably.

### Phase 4: Add Destination Recommendation Provider Interface

Goal: keep v1 heuristic-based, but make AI upgrade possible later.

Checklist:

- [x] Create a recommendation provider module, for example:
  - `apps/desktop/src/pages/main-page/model/review-destination-recommender.ts`
- [x] Define a provider interface or plain function contract that accepts:
  - the active thread
  - available pages
  - optional recent review history
- [x] Return `DestinationRecommendation[]`.
- [x] Implement a heuristic v1 provider.
- [x] Use explainable scoring rules only.
- [x] Start with these signals:
  - existing wikilinks inside thread entries
  - page-title overlap with thread entry text
  - recent destination history as a small tie-breaker
- [x] Limit results to 5 recommendations.
- [x] The first recommendation becomes the default soft-selected destination.
- [x] Keep the provider field in the result so AI can be plugged in later.
- [x] Add tests for recommendation ranking.

Acceptance criteria:

- [x] Recommendation logic is isolated from UI rendering.
- [x] The UI does not care whether recommendations come from heuristics or AI.

### Phase 5: Replace Review UI Container

Goal: remove the old queue panel layout and install the new two-pane workbench.

Checklist:

- [x] Replace usage of the current `ReviewPane` in `apps/desktop/src/pages/main-page/ui/main-page-workspace.tsx`.
- [x] Create a new component:
  - `apps/desktop/src/widgets/review/review-workbench.tsx`
- [x] `ReviewWorkbench` must render:
  - left review surface
  - right editor surface
- [x] The right side must continue to use the existing `EditorPane`.
- [x] Add a new top bar above the editor:
  - `apps/desktop/src/widgets/review/review-session-bar.tsx`
- [x] In soft-selected state:
  - show `Recommended`
  - show destination search UI
  - do not auto-focus the editor
- [x] In hard-selected state:
  - hide the recommendation badge
  - collapse destination search
  - show `Change destination`
  - keep `Complete review` visible
- [x] Do not keep the old `Review mode / Review workbench / Threads / Current` header if it no longer matches the new UI.
- [x] Keep the new UI accessible:
  - buttons need labels
  - tab switch controls need ARIA semantics
  - disabled complete button needs understandable labeling

Acceptance criteria:

- [x] Review mode uses the new two-pane structure.
- [x] The right pane is always the real editor.

### Phase 6: Build `To Review` Deck

Goal: create the stacked-card experience for active review threads.

Checklist:

- [x] Create `apps/desktop/src/widgets/review/review-queue-deck.tsx`.
- [x] Create `apps/desktop/src/widgets/review/review-reference-card.tsx`.
- [x] A thread card must render:
  - thread entries in capture order
  - no thread title
  - no entry count
  - card-level time range label
- [x] Do not render a composer.
- [x] Do not render reply buttons.
- [x] Do not render delete buttons.
- [x] Allow text selection in the card.
- [x] Do not add explicit copy buttons.
- [x] The deck must show:
  - one active card
  - two peek cards behind it
  - `n more` for the remaining unseen queue count
- [x] Clicking a peek card must move that card to the front.
- [x] Reordering must update the actual persisted review thread order.
- [x] If the current review session has a diff, card switching must first show a confirmation step.
- [x] Keep the visual style moderate.
- [x] Do not make the 3D effect so strong that it hurts readability.
- [x] Keep the active card height fixed.
- [x] If the active card content overflows, scroll inside the card only.

Acceptance criteria:

- [x] The deck works with mouse interaction.
- [x] The active review thread is clear.
- [x] Switching cards updates the underlying queue order.

### Phase 7: Build `Archived` List

Goal: support browsing previously reviewed threads without breaking the two-pane layout.

Checklist:

- [x] Create `apps/desktop/src/widgets/review/review-archive-list.tsx`.
- [x] Archived view must use a bottom tab control inside the left review surface.
- [x] Tab values:
  - `To Review`
  - `Archived`
- [x] In `Archived`:
  - flatten the deck into a planar list
  - use a scrollable container
  - show compressed cards
- [x] Archived card content should include:
  - source preview
  - `captured A - B`
  - `archived at`
  - destination note label
- [x] Clicking an archived card must open its destination note on the right.
- [x] Archived items must always have a destination note.
- [x] Do not add restore or permanent-delete actions in v1.
- [x] Keep the right editor editable even in archived view.

Acceptance criteria:

- [x] Archived can be browsed without leaving Review mode.
- [x] Clicking an archived item opens the destination note.

### Phase 8: Add Destination Search And Switching Flow

Goal: make destination selection explicit and safe.

Checklist:

- [x] Add inline destination-search UI inside `ReviewSessionBar`.
- [x] In soft-selected state:
  - show recommendations
  - allow search
  - allow create-new-page
- [x] The top recommendation should preload in the editor as a soft-selected page.
- [x] Do not auto-focus the editor in soft-selected state.
- [x] When the user starts editing:
  - mark the destination as hard-selected
  - compute and store the baseline hash
- [x] In hard-selected state:
  - hide the search UI
  - show `Change destination`
- [x] Clicking `Change destination` should expand the inline search UI again.
- [x] If the session has diff and the user tries to switch destination:
  - show a confirmation modal
  - offer:
    - continue writing
    - discard and switch
- [x] If the user discards and switches:
  - revert to the baseline snapshot or otherwise reset the session safely
  - select the new destination
- [x] If the restored session is invalidated:
  - clearly reset back to recommendation mode
  - do not try unsafe revert behavior

Acceptance criteria:

- [x] Destination changes are safe.
- [x] Hard-selection begins only when the user really starts writing.

### Phase 9: Replace Delete-On-Complete With Archive-On-Complete

Goal: complete the actual review lifecycle.

Checklist:

- [x] Find the current complete-review path in `use-main-page-state.ts`.
- [x] Stop using `deleteCaptureThread` as the completion action.
- [x] Replace completion with archive behavior.
- [x] Archive behavior must:
  - remove the thread from active `To Review`
  - add an archived record
  - store destination page uid
  - store archived timestamp
- [x] Keep enough source snapshot data so the archived card can still render.
- [x] After completion:
  - the next thread should become active automatically
  - recommendations for the next thread should load
- [x] If no threads remain:
  - show an empty review state
- [x] Completion button must remain disabled until there is a real diff.

Acceptance criteria:

- [x] Completing a review no longer destroys the source data.
- [x] Archived threads are visible in the archive list.

### Phase 10: Persist And Restore Review Session

Goal: keep the workbench useful across restart.

Checklist:

- [x] Persist the current review session state whenever important fields change.
- [x] Persist:
  - current tab
  - active thread id
  - selected archived thread id
  - destination page uid
  - recommendation list if needed
  - hard-selected flag
  - baseline page hash
  - invalidated flag
- [x] On app startup or vault load:
  - restore session state
  - restore tab state
  - reopen the destination page if still valid
- [x] If baseline hash no longer matches current page state:
  - mark session invalidated
  - do not keep hard-selected behavior active
  - reset user into a safe selection flow
- [x] Add a visible message for invalidated sessions.
- [x] Keep the message actionable and short.

Acceptance criteria:

- [x] Restarting the app returns the user to the same review context when safe.
- [x] Unsafe stale sessions are downgraded safely.

### Phase 11: Add Motion And Interaction Polish

Goal: make the deck and archive transition feel intentional without becoming distracting.

Checklist:

- [x] Update `apps/desktop/src/app/app.css` or split styles if needed.
- [x] Add styles for:
  - deck depth
  - peek cards
  - flattened archived list
  - bottom tab control
  - review session bar
  - invalidated state
- [x] Keep motion at moderate intensity.
- [x] Target roughly 180ms to 260ms transitions.
- [x] Add flattening animation when switching:
  - `To Review` -> `Archived`
- [x] Add inverse animation when switching:
  - `Archived` -> `To Review`
- [x] Ensure the deck remains readable on smaller widths.
- [x] Avoid extreme transforms that blur text or cause layout jitter.

Acceptance criteria:

- [x] The deck feels distinct from a plain list.
- [x] The archive transition communicates a real state change.

### Phase 12: Add Tests

Goal: lock the workflow before polishing further.

Checklist:

- [x] Add tests near existing app-level review and editor UX tests.
- [x] Add a test for soft-selected recommendation behavior.
- [x] Add a test that editing turns soft-selected into hard-selected.
- [x] Add a test that complete is disabled before any diff exists.
- [x] Add a test that complete becomes enabled after a real diff.
- [x] Add a test that complete archives instead of deleting.
- [x] Add a test that archived items open destination notes.
- [x] Add a test that card switching reorders queue order.
- [x] Add a test that switching cards with unsaved session diff asks for confirmation.
- [x] Add a test that destination switching with diff asks for confirmation.
- [x] Add a test that session state restores after app restart.
- [x] Add a test that stale restored sessions become invalidated.
- [x] Add a test that archived view uses a flattened list state.
- [x] Add a test for `n more` count logic.
- [x] Add unit tests for recommendation ranking.
- [x] Add unit tests for baseline hash logic.

Acceptance criteria:

- [x] The new review flow is covered at both unit and integration level.

## Suggested File-Level Work Breakdown

Use this order when implementing:

1. `apps/desktop/src/entities/review/model/review-types.ts`
2. `apps/desktop/src/pages/main-page/model/review-session-hash.ts`
3. `apps/desktop/src/pages/main-page/model/review-destination-recommender.ts`
4. `apps/desktop/src/pages/main-page/model/use-main-page-state.ts`
5. `apps/desktop/src/widgets/review/review-reference-card.tsx`
6. `apps/desktop/src/widgets/review/review-queue-deck.tsx`
7. `apps/desktop/src/widgets/review/review-archive-list.tsx`
8. `apps/desktop/src/widgets/review/review-session-bar.tsx`
9. `apps/desktop/src/widgets/review/review-workbench.tsx`
10. `apps/desktop/src/pages/main-page/ui/main-page-workspace.tsx`
11. `apps/desktop/src/app/app.css`
12. tests

## Developer Notes

- Do not reuse the current `CapturePane` for review. Build a separate review-only left pane.
- Keep the editor logic in `EditorPane` as untouched as possible. Wrap it instead of forking it unless forced.
- Avoid trying to complete the old database-backed `review_queue` feature in the same change.
- Persisted review-session data must be scoped so it does not leak incorrectly across vaults.
- Be very careful with revert logic. If a session is invalidated, prefer safety over convenience.
- If the current state shape becomes too large inside `use-main-page-state.ts`, extract a dedicated review state module instead of making that file worse.

## Final Verification Checklist

- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test` passes
- [x] Review mode can complete one full thread-to-archive workflow
- [x] Review session survives restart when safe
- [x] Invalidated sessions fail safely
- [x] Archived items always have destination pages
- [x] No explicit copy buttons were added to the reference pane
- [x] No delete-on-complete behavior remains in the new review flow

## Definition Of Done

This task is done only when all of the following are true:

- The old review queue layout has been replaced by the new workbench.
- A user can summarize one active thread into one destination page.
- The app only allows completion after real document changes.
- Completion archives the source thread.
- Archived items can be browsed and reopen their destination notes.
- Review sessions restore across restart when safe.
- Stale sessions invalidate safely.
- The implementation is covered by tests and passes lint, typecheck, and test commands.

