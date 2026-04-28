import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import { AlertDialog, AlertDialogContent } from "./alert-dialog";
import { getOwnerAvatarUrl, getOwnerLogin } from "../../lib/forge-owner";
import {
  PullRequestBadgeStatus,
  type ForgeProviderKind,
  type PullRequestSummary,
  type RepoSummary,
} from "../../types/forge";
import {
  formatPullRequestDisplayTitle,
  getDraftIndicatorLabel,
} from "../../lib/pull-request-display";
import LucideGitBranch from "../../assets/icons/LucideGitBranch";
import LucideGitPullRequestClosed from "../../assets/icons/LucideGitPullRequestClosed";
import LucideGitMerge from "../../assets/icons/LucideGitMerge";
import LucideGitPullRequestArrow from "../../assets/icons/LucideGitPullRequestArrow";

type TrackPullRequestModalMode = "repo-then-pr" | "pr-only";
type TrackPullRequestModalStep = "repo" | "pull-request";

type TrackPullRequestModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: TrackPullRequestModalMode;
  step: TrackPullRequestModalStep;
  selectedRepo: RepoSummary | null;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  isLoadingRepos: boolean;
  availableReposError: unknown;
  hasRepoSources: boolean;
  filteredRepos: RepoSummary[];
  isSavingRepo: boolean;
  onPickRepo: (repo: RepoSummary) => void;
  pullRequests: PullRequestSummary[];
  isLoadingPullRequests: boolean;
  pullRequestsError: string;
  isTrackingPullRequest: boolean;
  onPickPullRequest: (pullRequest: PullRequestSummary) => void;
  onBack: () => void;
};

type RepoSelectionStepProps = {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  isLoadingRepos: boolean;
  availableReposError: unknown;
  hasRepoSources: boolean;
  filteredRepos: RepoSummary[];
  isSavingRepo: boolean;
  onPickRepo: (repo: RepoSummary) => void;
};

function getRepoProviderLabel(repo: RepoSummary) {
  return `${repo.provider === "github" ? "GitHub" : "GitLab"} · ${repo.providerAccountLabel}`;
}

function RepoSelectionStep({
  searchQuery,
  onSearchChange,
  isLoadingRepos,
  availableReposError,
  hasRepoSources,
  filteredRepos,
  isSavingRepo,
  onPickRepo,
}: RepoSelectionStepProps) {
  return (
    <>
      {/*<AlertDialogHeader>
        <AlertDialogTitle>Add a repo</AlertDialogTitle>
        <AlertDialogDescription>
          Pick a repo first, then choose one PR to track.
        </AlertDialogDescription>
      </AlertDialogHeader>*/}

      <div className="mb-4 flex min-h-0 flex-col gap-2.5">
        <input
          autoFocus
          className="w-full border-b border-neutral-200 dark:border-neutral-700 bg-surface px-4 py-3 outline-hidden transition placeholder:text-neutral-400"
          disabled={isLoadingRepos || isSavingRepo}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          placeholder="Search repositories or paste a GitLab project path"
          value={searchQuery}
        />

        <p className="font-sans text-xs text-neutral-500 px-4">Repositories</p>

        {isLoadingRepos ? (
          <div className="px-4 py-3 text-sm text-ink-500">
            Loading repositories...
          </div>
        ) : null}

        {availableReposError ? (
          <div className="text-sm text-danger-600 px-4 py-3">
            {availableReposError instanceof Error
              ? availableReposError.message
              : String(availableReposError)}
          </div>
        ) : null}

        {!isLoadingRepos && !availableReposError ? (
          <div className="flex max-h-[340px] flex-col gap-1 overflow-y-auto px-2">
            {filteredRepos.length === 0 ? (
              <div className="px-0 py-2 text-sm text-ink-500">
                {hasRepoSources ? (
                  "No repos to add."
                ) : (
                  <>
                    No enabled accounts.{" "}
                    <Link
                      className="font-medium text-ink-700 underline-offset-2 hover:underline"
                      to="/settings/profiles"
                    >
                      Open settings
                    </Link>
                    .
                  </>
                )}
              </div>
            ) : (
              filteredRepos.map((repo) => (
                <button
                  className="w-full rounded-lg  bg-surface py-2.5 px-2 text-left transition hover:border-zinc-400 hover:bg-canvas disabled:cursor-default disabled:opacity-60"
                  disabled={isSavingRepo}
                  key={repo.id}
                  onClick={() => onPickRepo(repo)}
                  type="button"
                >
                  <div className="flex items-center gap-2.5">
                    <img
                      alt={`${getOwnerLogin(repo.nameWithOwner)} avatar`}
                      className="mt-0.5 size-7 shrink-0 rounded-full object-cover"
                      loading="lazy"
                      src={repo.avatarUrl ?? getOwnerAvatarUrl(repo.nameWithOwner)}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="truncate">{repo.nameWithOwner}</span>
                      </div>
                      {repo.description ? (
                        <div className="mt-1 truncate text-xs text-neutral-500">
                          {repo.description}
                        </div>
                      ) : null}
                      <div className="mt-1 truncate text-[11px] text-neutral-500">
                        {getRepoProviderLabel(repo)}
                        {repo.host === "github.com" || repo.host === "gitlab.com"
                          ? ""
                          : ` · ${repo.host}`}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

type PullRequestSelectionStepProps = {
  mode: TrackPullRequestModalMode;
  selectedRepo: RepoSummary | null;
  pullRequests: PullRequestSummary[];
  isLoadingPullRequests: boolean;
  pullRequestsError: string;
  isTrackingPullRequest: boolean;
  onPickPullRequest: (pullRequest: PullRequestSummary) => void;
  onBack: () => void;
};

type PullRequestStatusViewModel = {
  status: PullRequestBadgeStatus;
  label: string;
  className: string;
};

function getPullRequestStatus(
  pullRequest: PullRequestSummary,
): PullRequestStatusViewModel {
  if (pullRequest.state === "MERGED") {
    return {
      status: PullRequestBadgeStatus.Merged,
      label: "Merged",
      className:
        "border-[#BFE1CC] bg-[#EAF6EF] text-[#1C6B3A] dark:border-green-900/30 dark:bg-green-950/40 dark:text-green-300",
    };
  }

  if (pullRequest.state !== "OPEN") {
    return {
      status: PullRequestBadgeStatus.Closed,
      label: "Closed",
      className: "border-ink-300 bg-surface text-ink-600",
    };
  }

  if (pullRequest.isDraft) {
    return {
      status: PullRequestBadgeStatus.Draft,
      label: "Draft",
      className: "border-ink-300 bg-surface text-ink-600",
    };
  }

  if (
    pullRequest.mergeable === "CONFLICTING" ||
    pullRequest.mergeStateStatus === "DIRTY"
  ) {
    return {
      status: PullRequestBadgeStatus.Conflicting,
      label: "Conflicting",
      className:
        "border-[#F1C9C9] bg-[#FBEAEA] text-danger-600 dark:border-red-900/30 dark:bg-red-950/40 dark:text-red-300",
    };
  }

  if (pullRequest.mergeable === "MERGEABLE") {
    return {
      status: PullRequestBadgeStatus.CanMerge,
      label: "Can Merge",
      className:
        "border-[#BFE1CC] bg-[#EAF6EF] text-[#1C6B3A] dark:border-green-900/30 dark:bg-green-950/40 dark:text-green-300",
    };
  }

  return {
    status: PullRequestBadgeStatus.Open,
    label: "Open",
    className: "border-ink-300 bg-surface text-ink-600",
  };
}

function PullRequestStatusIcon({ status }: { status: PullRequestBadgeStatus }) {
  switch (status) {
    case PullRequestBadgeStatus.Merged:
      return <LucideGitMerge className="text-green-600 dark:text-green-300" />;
    case PullRequestBadgeStatus.Closed:
      return <LucideGitPullRequestClosed className="text-ink-500" />;
    case PullRequestBadgeStatus.Draft:
      return <LucideGitBranch className="text-ink-500" />;
    case PullRequestBadgeStatus.Conflicting:
      return (
        <LucideGitPullRequestClosed className="text-yellow-500 dark:text-yellow-300" />
      );
    case PullRequestBadgeStatus.CanMerge:
      return (
        <LucideGitPullRequestArrow className="text-green-600 dark:text-green-300" />
      );
    case PullRequestBadgeStatus.Open:
      return <LucideGitMerge className="text-green-500 dark:text-green-300" />;
    default:
      return null;
  }
}

function DraftIndicator({ provider }: { provider: ForgeProviderKind }) {
  return (
    <span className="shrink-0 rounded border border-ink-300 bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-ink-600">
      {getDraftIndicatorLabel(provider)}
    </span>
  );
}

function formatChangeSummary(pullRequest: PullRequestSummary) {
  if (
    pullRequest.additions !== null &&
    pullRequest.deletions !== null
  ) {
    return (
      <>
        <span className="text-green-600 dark:text-green-300">
          +{pullRequest.additions}
        </span>{" "}
        <span className="text-red-600 dark:text-red-300">
          -{pullRequest.deletions}
        </span>
      </>
    );
  }

  if (pullRequest.changeCount !== null) {
    return <span className="text-ink-600">{pullRequest.changeCount} files</span>;
  }

  return <span className="text-ink-600">changes</span>;
}

function PullRequestSelectionStep({
  mode,
  selectedRepo,
  pullRequests,
  isLoadingPullRequests,
  pullRequestsError,
  isTrackingPullRequest,
  onPickPullRequest,
  onBack,
}: PullRequestSelectionStepProps) {
  const provider = selectedRepo?.provider ?? "github";

  return (
    <>
      <div className="mb-4 flex min-h-0 flex-col gap-2.5">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700">
          {mode === "repo-then-pr" ? (
            <button
              aria-label="Back to repo list"
              className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvas hover:text-ink-700"
              onClick={onBack}
              type="button"
            >
              <ArrowLeftIcon className="size-4 shrink-0" />
            </button>
          ) : null}
          <p className="font-sans text-xs text-neutral-500">
            {selectedRepo
              ? `Pull Requests in ${selectedRepo.nameWithOwner}`
              : "Pull Requests"}
          </p>
        </div>

        {isLoadingPullRequests ? (
          <div className="text-sm text-ink-500 px-4 py-3">Loading...</div>
        ) : null}

        {pullRequestsError ? (
          <div className="text-sm text-danger-600 px-4 py-3">
            {pullRequestsError}
          </div>
        ) : null}

        {!isLoadingPullRequests && !pullRequestsError ? (
          <div className="flex max-h-[340px] flex-col gap-1 overflow-y-auto px-2">
            {pullRequests.length === 0 ? (
              <div className="px-0 py-2 text-sm text-ink-500">
                No PRs to add.
              </div>
            ) : (
              pullRequests.map((pullRequest) => {
                const prKey = `modal-pr-${pullRequest.number}`;
                const status = getPullRequestStatus(pullRequest);
                const title = formatPullRequestDisplayTitle(pullRequest.title);
                return (
                  <button
                    className="w-full rounded-lg bg-surface py-2.5 px-2 text-left transition hover:border-zinc-400 hover:bg-canvas disabled:cursor-default disabled:opacity-60"
                    disabled={isTrackingPullRequest}
                    key={prKey}
                    onClick={() => onPickPullRequest(pullRequest)}
                    type="button"
                  >
                    <p className="text-xs text-neutral-500">
                      {pullRequest.authorLogin}
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="shrink-0">
                          <PullRequestStatusIcon status={status.status} />
                        </div>
                        {pullRequest.isDraft ? (
                          <DraftIndicator provider={provider} />
                        ) : null}
                        <p className="min-w-0 flex-1 truncate text-sm text-ink-700">
                          {title}
                        </p>
                      </div>
                      <p className="shrink-0 whitespace-nowrap text-xs font-mono font-semibold">
                        {formatChangeSummary(pullRequest)}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

function TrackPullRequestModal({
  open,
  onOpenChange,
  mode,
  step,
  selectedRepo,
  searchQuery,
  onSearchChange,
  isLoadingRepos,
  availableReposError,
  hasRepoSources,
  filteredRepos,
  isSavingRepo,
  onPickRepo,
  pullRequests,
  isLoadingPullRequests,
  pullRequestsError,
  isTrackingPullRequest,
  onPickPullRequest,
  onBack,
}: TrackPullRequestModalProps) {
  const showRepoStep = step === "repo";
  const showPullRequestStep = step === "pull-request";

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent className="overflow-hidden border border-neutral-400 dark:border-neutral-700">
        {showRepoStep ? (
          <RepoSelectionStep
            availableReposError={availableReposError}
            filteredRepos={filteredRepos}
            hasRepoSources={hasRepoSources}
            isLoadingRepos={isLoadingRepos}
            isSavingRepo={isSavingRepo}
            onPickRepo={onPickRepo}
            onSearchChange={onSearchChange}
            searchQuery={searchQuery}
          />
        ) : null}

        {showPullRequestStep ? (
          <PullRequestSelectionStep
            isLoadingPullRequests={isLoadingPullRequests}
            isTrackingPullRequest={isTrackingPullRequest}
            mode={mode}
            onBack={onBack}
            onPickPullRequest={onPickPullRequest}
            pullRequests={pullRequests}
            pullRequestsError={pullRequestsError}
            selectedRepo={selectedRepo}
          />
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { TrackPullRequestModal };
export type {
  TrackPullRequestModalMode,
  TrackPullRequestModalProps,
  TrackPullRequestModalStep,
};
