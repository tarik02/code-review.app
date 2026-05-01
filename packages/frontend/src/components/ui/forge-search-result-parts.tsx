import { useState, type ReactNode } from 'react';
import { getOwnerInitials, getOwnerLogin } from '../../lib/forge-owner';
import { hostNameFromInput } from '../../lib/forge-links';
import { cx } from '../../lib/cx';
import {
  formatPullRequestDisplayTitle,
  getDraftIndicatorLabel,
} from '../../lib/pull-request-display';
import {
  PullRequestBadgeStatus,
  type ForgeProviderKind,
  type PullRequestSummary,
  type RepoSummary,
} from '../../types/forge';
import LucideGitBranch from '../../assets/icons/LucideGitBranch';
import LucideGitPullRequestClosed from '../../assets/icons/LucideGitPullRequestClosed';
import LucideGitMerge from '../../assets/icons/LucideGitMerge';
import LucideGitPullRequestArrow from '../../assets/icons/LucideGitPullRequestArrow';

type PullRequestStatusViewModel = {
  status: PullRequestBadgeStatus;
  label: string;
  className: string;
};

function getRepoProviderLabel(repo: RepoSummary) {
  return `${repo.provider === 'github' ? 'GitHub' : 'GitLab'} · ${repo.providerAccountLabel}`;
}

function AvatarFallback({ className, initials }: { className?: string; initials: string }) {
  return (
    <div
      className={cx(
        'flex size-7 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[11px] font-semibold text-ink-700',
        className,
      )}
    >
      {initials}
    </div>
  );
}

function AvatarImage({
  alt,
  fallback,
  src,
}: {
  alt: string;
  fallback: ReactNode;
  src: string | null;
}) {
  if (!src) {
    return fallback;
  }

  return <AvatarImageInner alt={alt} fallback={fallback} key={src} src={src} />;
}

function AvatarImageInner({
  alt,
  fallback,
  src,
}: {
  alt: string;
  fallback: ReactNode;
  src: string;
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  return (
    <div className="relative size-7 shrink-0">
      {status !== 'loaded' ? fallback : null}
      <img
        alt={alt}
        className={cx(
          'absolute inset-0 size-7 rounded-full object-cover transition-opacity',
          status === 'loaded' ? 'opacity-100' : 'opacity-0',
        )}
        loading="lazy"
        onError={() => {
          setStatus('error');
        }}
        onLoad={() => {
          setStatus('loaded');
        }}
        src={src}
      />
    </div>
  );
}

function RepoAvatar({ repo }: { repo: RepoSummary }) {
  const avatarUrl = repo.avatarUrl;
  const initials = getOwnerInitials(repo.nameWithOwner);
  return (
    <AvatarImage
      alt={`${getOwnerLogin(repo.nameWithOwner)} avatar`}
      fallback={<AvatarFallback initials={initials} />}
      src={avatarUrl}
    />
  );
}

function RepoMetaLabel({ repo }: { repo: RepoSummary }) {
  return (
    <>
      {getRepoProviderLabel(repo)}
      {hostNameFromInput(repo.host) === 'github.com' ||
      hostNameFromInput(repo.host) === 'gitlab.com'
        ? ''
        : ` · ${repo.host}`}
    </>
  );
}

function getPullRequestStatus(pullRequest: PullRequestSummary): PullRequestStatusViewModel {
  if (pullRequest.state === 'MERGED') {
    return {
      status: PullRequestBadgeStatus.Merged,
      label: 'Merged',
      className:
        'border-[#BFE1CC] bg-[#EAF6EF] text-[#1C6B3A] dark:border-green-900/30 dark:bg-green-950/40 dark:text-green-300',
    };
  }

  if (pullRequest.state !== 'OPEN') {
    return {
      status: PullRequestBadgeStatus.Closed,
      label: 'Closed',
      className: 'border-ink-300 bg-surface text-ink-600',
    };
  }

  if (pullRequest.isDraft) {
    return {
      status: PullRequestBadgeStatus.Draft,
      label: 'Draft',
      className: 'border-ink-300 bg-surface text-ink-600',
    };
  }

  if (pullRequest.mergeable === 'CONFLICTING' || pullRequest.mergeStateStatus === 'DIRTY') {
    return {
      status: PullRequestBadgeStatus.Conflicting,
      label: 'Conflicting',
      className:
        'border-[#F1C9C9] bg-[#FBEAEA] text-danger-600 dark:border-red-900/30 dark:bg-red-950/40 dark:text-red-300',
    };
  }

  if (pullRequest.mergeable === 'MERGEABLE') {
    return {
      status: PullRequestBadgeStatus.CanMerge,
      label: 'Can Merge',
      className:
        'border-[#BFE1CC] bg-[#EAF6EF] text-[#1C6B3A] dark:border-green-900/30 dark:bg-green-950/40 dark:text-green-300',
    };
  }

  return {
    status: PullRequestBadgeStatus.Open,
    label: 'Open',
    className: 'border-ink-300 bg-surface text-ink-600',
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

function formatPullRequestChangeSummary(pullRequest: PullRequestSummary): ReactNode {
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

  return <span className="text-ink-600">changes</span>;
}

export {
  DraftIndicator,
  PullRequestStatusIcon,
  RepoAvatar,
  RepoMetaLabel,
  formatPullRequestChangeSummary,
  formatPullRequestDisplayTitle,
  getPullRequestStatus,
  getRepoProviderLabel,
};
