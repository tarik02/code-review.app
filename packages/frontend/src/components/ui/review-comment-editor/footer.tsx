import { ArrowUpIcon } from "@heroicons/react/20/solid";
import { Button } from "../button";

type ReviewCommentEditorFooterProps = {
  canSubmit: boolean;
  cancelLabel: string;
  isPending: boolean;
  submitLabel: string;
  onCancel?: () => void;
  onSubmit: () => void;
};

function ReviewCommentEditorFooter({
  canSubmit,
  cancelLabel,
  isPending,
  submitLabel,
  onCancel,
  onSubmit,
}: ReviewCommentEditorFooterProps) {
  return (
    <footer className="rudu-comment-editor-footer">
      {onCancel ? (
        <Button disabled={isPending} variant="ghost" onClick={onCancel} type="button">
          {cancelLabel}
        </Button>
      ) : null}
      <Button disabled={!canSubmit} onClick={onSubmit} type="button">
        <ArrowUpIcon className="size-4" data-icon="inline-start" />
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </footer>
  );
}

export { ReviewCommentEditorFooter };
