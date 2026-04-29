import type { ReactNode } from 'react';
import {
  PullRequestBadgeStatus,
  type PullRequestSummary,
  type RepoSummary,
} from '../../types/forge';
import { cx } from '../../lib/cx';
import { repoIdentityKey } from '../../lib/repo-identity';
import {
  formatPullRequestDisplayTitle,
  getDraftIndicatorLabel,
} from '../../lib/pull-request-display';
import LucideGitBranch from '../../assets/icons/LucideGitBranch';
import LucideGitPullRequestArrow from '../../assets/icons/LucideGitPullRequestArrow';
import LucideGitPullRequestClosed from '../../assets/icons/LucideGitPullRequestClosed';
import LucideGitMerge from '../../assets/icons/LucideGitMerge';

type PullRequestListCardProps = {
  repo: RepoSummary;
  pullRequest: PullRequestSummary;
  selectedPrKey: string | null;
  repoLabel?: string;
  isDimmed?: boolean;
  leadingActions?: ReactNode;
  trailingActions?: ReactNode;
  onSelectPr: (repo: RepoSummary, pullRequest: PullRequestSummary) => void;
};

type PullRequestStatusViewModel = {
  status: PullRequestBadgeStatus;
};

function getRepoLabel(repo: RepoSummary) {
  if (repo.host === 'github.com') {
    return repo.nameWithOwner;
  }

  return `${repo.nameWithOwner} · ${repo.host}`;
}

function getPullRequestStatus(pullRequest: PullRequestSummary): PullRequestStatusViewModel {
  if (pullRequest.state === 'MERGED') {
    return {
      status: PullRequestBadgeStatus.Merged,
    };
  }

  if (pullRequest.state !== 'OPEN') {
    return {
      status: PullRequestBadgeStatus.Closed,
    };
  }

  if (pullRequest.isDraft) {
    return {
      status: PullRequestBadgeStatus.Draft,
    };
  }

  if (pullRequest.mergeable === 'CONFLICTING' || pullRequest.mergeStateStatus === 'DIRTY') {
    return {
      status: PullRequestBadgeStatus.Conflicting,
    };
  }

  if (pullRequest.mergeable === 'MERGEABLE') {
    return {
      status: PullRequestBadgeStatus.CanMerge,
    };
  }

  return {
    status: PullRequestBadgeStatus.Open,
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

function DraftIndicator({ repo }: { repo: RepoSummary }) {
  return (
    <span className="shrink-0 rounded border border-ink-300 bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-ink-600">
      {getDraftIndicatorLabel(repo.provider)}
    </span>
  );
}

function formatChangeSummary(pullRequest: PullRequestSummary) {
  if (pullRequest.additions !== null && pullRequest.deletions !== null) {
    return (
      <>
        <span className="text-green-600 dark:text-green-300">+{pullRequest.additions}</span>{' '}
        <span className="text-red-600 dark:text-red-300">-{pullRequest.deletions}</span>
      </>
    );
  }

  if (pullRequest.changeCount !== null) {
    return <span className="text-ink-600">{pullRequest.changeCount} files</span>;
  }

  return null;
}

function PullRequestListCard({
  repo,
  pullRequest,
  selectedPrKey,
  repoLabel,
  isDimmed = false,
  leadingActions,
  trailingActions,
  onSelectPr,
}: PullRequestListCardProps) {
  const status = getPullRequestStatus(pullRequest);
  const title = formatPullRequestDisplayTitle(pullRequest.title);
  const changeSummary = formatChangeSummary(pullRequest);
  const lookupKey = repoIdentityKey(repo);
  const isSelected = selectedPrKey === `${lookupKey}#${pullRequest.number}@${pullRequest.headSha}`;

  return (
    <div className={cx('group relative', isDimmed && 'opacity-60')}>
      <div
        className={cx(
          'flex items-stretch bg-canvas transition hover:bg-canvasDark focus-within:bg-surface',
          isSelected && 'bg-canvasDark',
        )}
      >
        {leadingActions ? (
          <div className="flex shrink-0 items-center gap-1 pl-2">{leadingActions}</div>
        ) : null}
        <button
          className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5 text-left"
          onClick={() => onSelectPr(repo, pullRequest)}
          type="button"
        >
          <p className="truncate text-xs text-ink-500">
            {repoLabel ? `${repoLabel} · ` : ''}
            {pullRequest.authorLogin}
          </p>

          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="shrink-0">
                <PullRequestStatusIcon status={status.status} />
              </div>
              {pullRequest.isDraft ? <DraftIndicator repo={repo} /> : null}
              <p className="min-w-0 flex-1 truncate text-sm text-ink-700">{title}</p>
            </div>
            {changeSummary ? (
              <p className="shrink-0 whitespace-nowrap text-xs font-mono font-semibold">
                {changeSummary}
              </p>
            ) : null}
          </div>
        </button>

        {trailingActions ? (
          <div
            className={cx(
              'pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center pl-1 pr-2 opacity-0 transition group-hover:opacity-100',
              'shadow-[-24px_0_32px_-12px_rgba(15,23,42,0.5)]',
              isSelected ? 'bg-canvasDark' : 'bg-canvas group-hover:bg-canvasDark',
            )}
          >
            <div className="pointer-events-auto">{trailingActions}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { PullRequestListCard, getRepoLabel };
export type { PullRequestListCardProps };
