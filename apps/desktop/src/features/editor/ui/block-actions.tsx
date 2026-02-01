import { IconButton } from "../../../shared/ui/icon-button";

type BlockActionsProps = {
  onInsertBelow: () => void;
  onAddReview: () => void;
  onLinkToPage: () => void;
  onDuplicate: () => void;
};

export const BlockActions = (props: BlockActionsProps) => {
  return (
    <div class="block__actions">
      <IconButton
        class="block__action"
        label="Insert block below"
        title="Insert block below"
        onClick={props.onInsertBelow}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v8M8 9h8" />
          <path d="M5 19h14" />
        </svg>
      </IconButton>
      <IconButton
        class="block__action"
        label="Add to review"
        title="Add to review"
        onClick={props.onAddReview}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </IconButton>
      <IconButton
        class="block__action"
        label="Link to page"
        title="Link to page"
        onClick={props.onLinkToPage}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </IconButton>
      <IconButton
        class="block__action"
        label="Duplicate block"
        title="Duplicate block"
        onClick={props.onDuplicate}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <rect x="2" y="2" width="13" height="13" rx="2" />
        </svg>
      </IconButton>
    </div>
  );
};
