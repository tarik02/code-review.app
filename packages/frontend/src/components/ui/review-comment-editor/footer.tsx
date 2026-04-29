import { ArrowUpIcon } from '@heroicons/react/20/solid';
import { Button } from '../button';

type ReviewCommentEditorFooterProps = {
  canSubmit: boolean;
  cancelLabel: string;
  isPending: boolean;
  submitLabel: string;
  secondarySubmitLabel?: string;
  onCancel?: () => void;
  onSubmit: () => void;
  onSecondarySubmit?: () => void;
};

function ReviewCommentEditorFooter({
  canSubmit,
  cancelLabel,
  isPending,
  submitLabel,
  secondarySubmitLabel,
  onCancel,
  onSubmit,
  onSecondarySubmit,
}: ReviewCommentEditorFooterProps) {
  return (
    <footer className="comment-editor-footer">
      {onCancel ? (
        <Button disabled={isPending} variant="ghost" onClick={onCancel} type="button">
          {cancelLabel}
        </Button>
      ) : null}
      {onSecondarySubmit && secondarySubmitLabel ? (
        <Button disabled={!canSubmit} variant="outline" onClick={onSecondarySubmit} type="button">
          {secondarySubmitLabel}
        </Button>
      ) : null}
      <Button disabled={!canSubmit} onClick={onSubmit} type="button">
        <ArrowUpIcon className="size-4" data-icon="inline-start" />
        {isPending ? 'Saving...' : submitLabel}
      </Button>
    </footer>
  );
}

export { ReviewCommentEditorFooter };
