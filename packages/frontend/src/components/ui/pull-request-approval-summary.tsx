import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { Button } from "./button";
import { cx } from "../../lib/cx";
import type { PullRequestApprovalActor, PullRequestApprovalState } from "../../types/forge";

type PullRequestApprovalSummaryProps = {
  approvalState: PullRequestApprovalState | null;
  isLoading: boolean;
  error: string;
  isApprovePending: boolean;
  isRemovePending: boolean;
  onApprove: () => Promise<void> | void;
  onRemoveApproval: () => Promise<void> | void;
};

function getInitials(actor: PullRequestApprovalActor) {
  const source = actor.name.trim() || actor.login.trim();
  return source.slice(0, 1).toUpperCase() || "?";
}

function ApprovalAvatar({ actor, className }: { actor: PullRequestApprovalActor; className?: string }) {
  if (!actor.avatarUrl) {
    return (
      <div
        aria-label={actor.login}
        className={cx(
          "flex size-7 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-canvas text-[10px] font-semibold text-ink-700",
          className,
        )}
        title={actor.name || actor.login}
      >
        {getInitials(actor)}
      </div>
    );
  }

  return (
    <img
      alt={actor.login}
      className={cx("size-7 shrink-0 rounded-full border border-ink-200 object-cover", className)}
      src={actor.avatarUrl}
      title={actor.name || actor.login}
    />
  );
}

function PullRequestApprovalSummary({
  approvalState,
  isLoading,
  error,
  isApprovePending,
  isRemovePending,
  onApprove,
  onRemoveApproval,
}: PullRequestApprovalSummaryProps) {
  const [isDismissConfirmOpen, setIsDismissConfirmOpen] = useState(false);
  const visibleApprovals = useMemo(() => approvalState?.approvedBy.slice(0, 4) ?? [], [approvalState]);
  const overflowCount = Math.max((approvalState?.approvedBy.length ?? 0) - visibleApprovals.length, 0);
  const hasApprovalState = approvalState !== null;
  const approvalCount = approvalState?.approvedBy.length ?? 0;
  const approvalCountLabel = hasApprovalState ? `${approvalCount} approved` : null;
  const countersLabel =
    approvalState?.approvalsRequired != null && approvalState.approvalsLeft != null
      ? `${approvalState.approvalsLeft} left of ${approvalState.approvalsRequired}`
      : null;
  const isBusy = isApprovePending || isRemovePending;

  return (
    <>
      <div className="border-b border-ink-200 px-4 pb-3 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink-900">Review approvals</span>
              {isLoading ? <span className="text-xs text-ink-500">Loading approvals...</span> : null}
              {!isLoading && approvalCountLabel ? (
                <span className="text-xs text-ink-500">{approvalCountLabel}</span>
              ) : null}
              {!isLoading && countersLabel ? (
                <span className="text-xs text-ink-500">{countersLabel}</span>
              ) : null}
            </div>

            {!isLoading && approvalState ? (
              approvalState.approvedBy.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <div className="flex items-center">
                    {visibleApprovals.map((actor, index) => (
                      <ApprovalAvatar
                        actor={actor}
                        className={index === 0 ? "" : "-ml-2"}
                        key={`${actor.login}:${actor.approvedAt ?? index}`}
                      />
                    ))}
                    {overflowCount > 0 ? (
                      <div className="-ml-2 flex size-7 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-canvas text-[10px] font-semibold text-ink-700">
                        +{overflowCount}
                      </div>
                    ) : null}
                  </div>
                  <p className="min-w-0 text-xs text-ink-600">
                    {approvalState.approvedBy.map((actor) => actor.login).join(", ")}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-ink-500">No approvals yet</p>
              )
            ) : null}
          </div>

          {approvalState ? (
            <div className="flex shrink-0 items-center gap-2">
              {!approvalState.viewerApproved ? (
                <Button
                  disabled={isBusy}
                  onClick={() => void onApprove()}
                  size="sm"
                  type="button"
                >
                  {isApprovePending ? "Approving..." : "Approve"}
                </Button>
              ) : (
                <Button
                  disabled={isBusy}
                  onClick={() => {
                    if (approvalState.viewerRemoveStrategy === "dismiss") {
                      setIsDismissConfirmOpen(true);
                      return;
                    }
                    void onRemoveApproval();
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isRemovePending ? "Removing..." : "Remove approval"}
                </Button>
              )}
            </div>
          ) : null}
        </div>

        {error ? <div className="mt-2 text-sm text-danger-600">{error}</div> : null}
      </div>

      <AlertDialog onOpenChange={setIsDismissConfirmOpen} open={isDismissConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader className="px-5 pt-5">
            <AlertDialogTitle>Remove approval</AlertDialogTitle>
            <AlertDialogDescription>
              Removing approval on GitHub dismisses your latest approved review and adds a
              dismissal note to the pull request conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="px-5 pb-5 pt-4">
            <AlertDialogCancel disabled={isRemovePending} type="button">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRemovePending}
              onClick={() => {
                void onRemoveApproval();
                setIsDismissConfirmOpen(false);
              }}
              type="button"
            >
              {isRemovePending ? "Removing..." : "Remove approval"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export { PullRequestApprovalSummary };
