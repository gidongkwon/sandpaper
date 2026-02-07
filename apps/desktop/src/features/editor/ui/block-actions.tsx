import { IconButton } from "../../../shared/ui/icon-button";
import {
  Add16Icon,
  AddSquareMultiple16Icon,
  Copy16Icon,
  Link16Icon
} from "../../../shared/ui/icons";

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
        <AddSquareMultiple16Icon width="12" height="12" />
      </IconButton>
      <IconButton
        class="block__action"
        label="Add to review"
        title="Add to review"
        onClick={props.onAddReview}
      >
        <Add16Icon width="12" height="12" />
      </IconButton>
      <IconButton
        class="block__action"
        label="Link to page"
        title="Link to page"
        onClick={props.onLinkToPage}
      >
        <Link16Icon width="12" height="12" />
      </IconButton>
      <IconButton
        class="block__action"
        label="Duplicate block"
        title="Duplicate block"
        onClick={props.onDuplicate}
      >
        <Copy16Icon width="12" height="12" />
      </IconButton>
    </div>
  );
};
