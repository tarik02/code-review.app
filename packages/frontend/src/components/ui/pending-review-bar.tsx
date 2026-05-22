import type { PendingReviewSubmitAction, PullRequestApprovalState } from '../../types/forge';
import { getPatchViewerSessionState, usePatchViewerStore } from '../../stores/patch-viewer-store';
import { cx } from '../../lib/cx';
import { Button } from './button';
import { PullRequestApprovalSummary } from './pull-request-approval-summary';
import { RadioGroup, RadioGroupItem } from './radio-group';
import { Textarea } from './textarea';

type PendingReviewBarProps = {
  sessionKey: string | null;
  count: number;
  error: string;
  isLoading: boolean;
  isPublishing: boolean;
  isDiscarding: boolean;
  approvalState: PullRequestApprovalState | null;
  approvalStateError: string;
  isApprovalStateLoading: boolean;
  isApprovePending: boolean;
  isRemovePending: boolean;
  onPublish: (action: PendingReviewSubmitAction, summary: string) => void;
  onDiscard: () => void;
  onApprove: () => void;
  onRemoveApproval: () => void;
  canApprove: boolean;
  canRequestChanges: boolean;
};

function PendingReviewBar({
  sessionKey,
  count,
  error,
  isLoading,
  isPublishing,
  isDiscarding,
  approvalState,
  approvalStateError,
  isApprovalStateLoading,
  isApprovePending,
  isRemovePending,
  onPublish,
  onDiscard,
  onApprove,
  onRemoveApproval,
  canApprove,
  canRequestChanges,
}: PendingReviewBarProps) {
  const action = usePatchViewerStore(
    (state) => getPatchViewerSessionState(state, sessionKey).pendingReviewAction,
  );
  const summary = usePatchViewerStore(
    (state) => getPatchViewerSessionState(state, sessionKey).pendingReviewSummary,
  );
  const setPendingReviewAction = usePatchViewerStore((state) => state.setPendingReviewAction);
  const setPendingReviewSummary = usePatchViewerStore((state) => state.setPendingReviewSummary);
  const effectiveAction =
    action === 'approve' && !canApprove
      ? 'comment'
      : action === 'request_changes' && !canRequestChanges
        ? 'comment'
        : action;
  const shouldKeepReviewDetailsVisible = effectiveAction !== 'comment';
  const submitReviewTypeOptions: Array<{
    value: PendingReviewSubmitAction;
    label: string;
    disabled?: boolean;
  }> = [
    { value: 'comment', label: 'Comment' },
    { value: 'approve', label: 'Approve', disabled: !canApprove },
    { value: 'request_changes', label: 'Request changes', disabled: !canRequestChanges },
  ];

  function publishReview() {
    onPublish(effectiveAction, summary);
  }

  return (
    <div className="group pointer-events-auto relative flex w-[min(44rem,calc(100vw-3rem))] flex-col text-sm">
      {count > 0 ? (
        <div
          className={cx('pointer-events-none absolute inset-x-0 bottom-full z-0 overflow-hidden')}
        >
          <div
            className={cx(
              'origin-bottom translate-y-full transition-transform duration-200 ease-out will-change-transform group-focus-within:translate-y-0 group-hover:translate-y-0',
              shouldKeepReviewDetailsVisible && 'translate-y-0',
            )}
          >
            <div
              className={cx(
                'pointer-events-none -mb-px rounded-t-lg border border-ink-200 bg-canvas/95 px-3 pb-1 pt-3 shadow-lg backdrop-blur group-focus-within:pointer-events-auto group-hover:pointer-events-auto',
                shouldKeepReviewDetailsVisible && 'pointer-events-auto',
              )}
            >
              <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-600">Review type</span>
                  <RadioGroup<PendingReviewSubmitAction>
                    className="gap-0.5"
                    disabled={isPublishing || isDiscarding}
                    value={effectiveAction}
                    onValueChange={(value) =>
                      setPendingReviewAction(sessionKey, value as PendingReviewSubmitAction)
                    }
                  >
                    {submitReviewTypeOptions.map((option) => {
                      const id = `pending-review-action-${sessionKey ?? 'none'}-${option.value}`;
                      const isSelected = effectiveAction === option.value;

                      return (
                        <label
                          className={cx(
                            'flex items-center gap-2 rounded-sm px-1 py-1 text-sm text-ink-900 transition',
                            option.disabled
                              ? 'cursor-not-allowed opacity-50'
                              : 'cursor-pointer hover:bg-canvasDark',
                            isSelected && 'bg-canvasDark',
                          )}
                          htmlFor={id}
                          key={option.value}
                        >
                          <RadioGroupItem disabled={option.disabled} id={id} value={option.value} />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </RadioGroup>
                </div>
                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-xs font-medium text-ink-600">Notes</span>
                  <Textarea
                    className="min-h-20 resize-y border-ink-200 bg-canvas text-ink-900 placeholder:text-ink-400 focus-visible:border-ink-400 focus-visible:ring-0"
                    disabled={isPublishing || isDiscarding}
                    placeholder="Add notes"
                    value={summary}
                    onChange={(event) => setPendingReviewSummary(sessionKey, event.target.value)}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <div
        className={cx(
          'relative z-10 overflow-hidden border border-ink-200 bg-canvas/95 shadow-lg backdrop-blur transition-all duration-200 ease-out',
          'rounded-lg',
          count > 0 && 'group-focus-within:rounded-t-none group-hover:rounded-t-none',
          count > 0 && 'group-focus-within:border-t-transparent group-hover:border-t-transparent',
          shouldKeepReviewDetailsVisible && 'rounded-t-none',
          shouldKeepReviewDetailsVisible && 'border-t-transparent',
        )}
      >
        {count > 0 || error ? (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="font-medium text-ink-900">
                {count} pending review {count === 1 ? 'comment' : 'comments'}
              </span>
              {isLoading ? <span className="text-xs text-ink-500">Refreshing...</span> : null}
              {error ? <span className="text-xs text-danger-600">{error}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                disabled={count === 0 || isPublishing || isDiscarding}
                onClick={onDiscard}
                size="sm"
                type="button"
                variant="outline"
              >
                {isDiscarding ? 'Discarding...' : 'Discard'}
              </Button>
              <Button
                disabled={count === 0 || isPublishing || isDiscarding}
                onClick={publishReview}
                size="sm"
                type="button"
              >
                {isPublishing ? 'Submitting...' : 'Submit review'}
              </Button>
            </div>
          </div>
        ) : null}
        <div className={cx((count > 0 || error) && 'border-t border-ink-200')}>
          <PullRequestApprovalSummary
            approvalState={approvalState}
            canApprove={canApprove}
            error={approvalStateError}
            isApprovePending={isApprovePending}
            isLoading={isApprovalStateLoading}
            isRemovePending={isRemovePending}
            onApprove={onApprove}
            onRemoveApproval={onRemoveApproval}
          />
        </div>
      </div>
    </div>
  );
}

export { PendingReviewBar };
