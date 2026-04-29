import * as React from "react";
import { PlusIcon } from "@heroicons/react/20/solid";
import { ArchiveBoxXMarkIcon } from "@heroicons/react/24/outline";
import { AccordionItem, AccordionHeader, AccordionTrigger, AccordionPanel } from "./accordion";
import {
  PullRequestBadgeStatus,
  type ForgeProviderKind,
  type PullRequestSummary,
  type RepoIdentity,
} from "../../types/forge";
import { repoIdentityKey } from "../../lib/repo-identity";
import { getOwnerAvatarUrl, getOwnerLogin } from "../../lib/forge-owner";
import {
  formatPullRequestDisplayTitle,
  getDraftIndicatorLabel,
} from "../../lib/pull-request-display";
import LucideGitBranch from "../../assets/icons/LucideGitBranch";
import LucideGitPullRequestClosed from "../../assets/icons/LucideGitPullRequestClosed";
import LucideGitMerge from "../../assets/icons/LucideGitMerge";
import LucideGitPullRequestArrow from "../../assets/icons/LucideGitPullRequestArrow";

type RepoSidebarItemProps = {
  value: string;
  repo: RepoIdentity;
  provider: ForgeProviderKind;
  avatarUrl: string | null;
  host: string;
  nameWithOwner: string;
  pullRequests: PullRequestSummary[] | undefined;
  error: string | undefined;
  view: SidebarPullRequestView;
  selectedPrKey: string | null;
  trackedPullRequestNumbers?: Set<number>;
  onSelectPr: (repo: RepoIdentity, pr: PullRequestSummary) => void;
  onAddPr: (repo: RepoIdentity) => void;
  onTrackPr?: (repo: RepoIdentity, pr: PullRequestSummary) => void;
  onRemovePr: (repo: RepoIdentity, pr: PullRequestSummary) => void;
  onOpenChange: (open: boolean) => void;
};

type SidebarPullRequestView = "overview" | "tracked";

type PullRequestSidebarRowProps = {
  repo: RepoIdentity;
  provider: ForgeProviderKind;
  pullRequest: PullRequestSummary;
  selectedPrKey: string | null;
  isTrackedView: boolean;
  isTracked: boolean;
  repoLabel?: string;
  onSelectPr: (repo: RepoIdentity, pr: PullRequestSummary) => void;
  onTrackPr?: (repo: RepoIdentity, pr: PullRequestSummary) => void;
  onRemovePr: (repo: RepoIdentity, pr: PullRequestSummary) => void;
};

type PullRequestStatusViewModel = {
  status: PullRequestBadgeStatus;
  label: string;
  className: string;
};

function getPullRequestStatus(pullRequest: PullRequestSummary): PullRequestStatusViewModel {
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

  if (pullRequest.mergeable === "CONFLICTING" || pullRequest.mergeStateStatus === "DIRTY") {
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
      return <LucideGitPullRequestClosed className="text-yellow-500 dark:text-yellow-300" />;
    case PullRequestBadgeStatus.CanMerge:
      return <LucideGitPullRequestArrow className="text-green-600 dark:text-green-300" />;
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
  if (pullRequest.additions !== null && pullRequest.deletions !== null) {
    return (
      <>
        <span className="text-green-600 dark:text-green-300">+{pullRequest.additions}</span>{" "}
        <span className="text-red-600 dark:text-red-300">-{pullRequest.deletions}</span>
      </>
    );
  }

  if (pullRequest.changeCount !== null) {
    return <span className="text-ink-600">{pullRequest.changeCount} files</span>;
  }

  return <span className="text-ink-600">changes</span>;
}

function ChevronIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 12 12" fill="currentcolor" {...props}>
      <path d="M4.22 2.47a.75.75 0 0 1 1.06 0L8.53 5.72a.75.75 0 0 1 0 1.06L5.28 10.03a.75.75 0 0 1-1.06-1.06L6.97 6.25 4.22 3.53a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}

function PullRequestSidebarRow({
  repo,
  provider,
  pullRequest,
  selectedPrKey,
  isTrackedView,
  isTracked,
  repoLabel,
  onSelectPr,
  onTrackPr,
  onRemovePr,
}: PullRequestSidebarRowProps) {
  const status = getPullRequestStatus(pullRequest);
  const title = formatPullRequestDisplayTitle(pullRequest.title);
  const lookupKey = repoIdentityKey(repo);
  const isSelected = selectedPrKey === `${lookupKey}#${pullRequest.number}@${pullRequest.headSha}`;

  return (
    <div className="group relative">
      <button
        className={[
          "group relative flex w-full flex-col gap-1 bg-canvas px-3 py-2.5 text-left transition hover:bg-canvasDark focus-visible:bg-surface",
          isSelected ? "bg-canvasDark" : "",
        ].join(" ")}
        onClick={() => onSelectPr(repo, pullRequest)}
        type="button"
      >
        <p className="truncate text-xs text-ink-500">
          {repoLabel ? `${repoLabel} · ` : ""}
          {pullRequest.authorLogin}
        </p>

        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="shrink-0">
              <PullRequestStatusIcon status={status.status} />
            </div>
            {pullRequest.isDraft ? <DraftIndicator provider={provider} /> : null}
            <p className="min-w-0 flex-1 truncate text-sm text-ink-700">{title}</p>
          </div>
          <p className="shrink-0 whitespace-nowrap text-xs font-mono font-semibold transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
            {formatChangeSummary(pullRequest)}
          </p>
        </div>
      </button>
      {isTrackedView ? (
        <button
          aria-label={`Remove PR #${pullRequest.number}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-500 opacity-0 transition hover:bg-surface hover:text-ink-700 group-hover:opacity-100"
          onClick={() => onRemovePr(repo, pullRequest)}
          type="button"
        >
          <ArchiveBoxXMarkIcon className="size-4 shrink-0" />
        </button>
      ) : !isTracked && onTrackPr ? (
        <button
          aria-label={`Track PR #${pullRequest.number}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-500 opacity-0 transition hover:bg-surface hover:text-ink-700 group-hover:opacity-100"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onTrackPr(repo, pullRequest);
          }}
          type="button"
        >
          <PlusIcon className="size-4 shrink-0" />
        </button>
      ) : null}
    </div>
  );
}

function RepoSidebarItem({
  value,
  repo,
  provider,
  avatarUrl,
  host,
  nameWithOwner,
  pullRequests,
  error,
  view,
  selectedPrKey,
  trackedPullRequestNumbers,
  onSelectPr,
  onAddPr,
  onTrackPr,
  onRemovePr,
  onOpenChange,
}: RepoSidebarItemProps) {
  const ownerLogin = getOwnerLogin(nameWithOwner);
  const hasPullRequests = Boolean(pullRequests && pullRequests.length > 0);
  const isTrackedView = view === "tracked";

  return (
    <AccordionItem value={value} onOpenChange={onOpenChange}>
      <AccordionHeader className="group relative">
        <AccordionTrigger className="group border-0 pr-9 font-normal">
          <div className="relative size-5 shrink-0">
            <img
              alt={`${ownerLogin} avatar`}
              className="absolute inset-0 size-5 rounded-full object-cover transition-opacity duration-200 group-hover:opacity-0"
              loading="lazy"
              src={avatarUrl ?? getOwnerAvatarUrl(nameWithOwner)}
            />
            <ChevronIcon className="absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-[transform,opacity] duration-200 group-hover:opacity-100 group-data-[panel-open]:rotate-90" />
          </div>
          <span className="min-w-0 flex-1 truncate">
            {nameWithOwner}
            {host !== "github.com" ? (
              <span className="ml-1 text-xs text-ink-500">{host}</span>
            ) : null}
          </span>
        </AccordionTrigger>
        <button
          aria-label={`Add PR to ${nameWithOwner}`}
          className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded p-1 text-ink-500 opacity-0 transition-[opacity,color,background-color] duration-200 hover:bg-canvasDark hover:text-ink-700 group-hover:opacity-100"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAddPr(repo);
          }}
          type="button"
        >
          <PlusIcon className="size-4 shrink-0" />
        </button>
      </AccordionHeader>
      <AccordionPanel>
        <div className="overflow-hidden">
          <div className="flex flex-col">
            {error && !hasPullRequests ? (
              <div className="text-sm text-danger-600">{error}</div>
            ) : null}
            {!error && pullRequests?.length === 0 && isTrackedView ? (
              <div className="px-3 py-2.5 text-sm text-ink-500">
                No tracked PRs yet.{" "}
                <button
                  className="font-medium text-ink-700 underline-offset-2 hover:underline"
                  onClick={() => onAddPr(repo)}
                  type="button"
                >
                  Add a PR
                </button>
              </div>
            ) : null}
            {!error && pullRequests?.length === 0 && !isTrackedView ? (
              <div className="px-3 py-2.5 text-sm text-ink-500">No open PRs or MRs.</div>
            ) : null}
            {pullRequests
              ? pullRequests.map((pullRequest) => {
                  const prKey = `${value}#${pullRequest.number}`;
                  const isTracked = trackedPullRequestNumbers?.has(pullRequest.number) ?? false;

                  return (
                    <PullRequestSidebarRow
                      key={prKey}
                      repo={repo}
                      provider={provider}
                      pullRequest={pullRequest}
                      selectedPrKey={selectedPrKey}
                      isTrackedView={isTrackedView}
                      isTracked={isTracked}
                      onSelectPr={onSelectPr}
                      onTrackPr={onTrackPr}
                      onRemovePr={onRemovePr}
                    />
                  );
                })
              : null}
          </div>
        </div>
      </AccordionPanel>
    </AccordionItem>
  );
}

export { PullRequestSidebarRow, RepoSidebarItem };
export type {
  PullRequestSidebarRowProps,
  RepoSidebarItemProps,
  PullRequestSummary,
  SidebarPullRequestView,
};
