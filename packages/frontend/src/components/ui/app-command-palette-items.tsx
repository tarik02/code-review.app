import { FileCode2Icon, MessageSquareMoreIcon } from 'lucide-react';
import { usePatchViewerStore } from '../../stores/patch-viewer-store';
import type { PullRequestSummary, RepoSummary } from '../../types/forge';
import {
  getReviewThreadRefKey,
  getThreadRootComment,
  isActiveReviewThread,
  isFileReviewThread,
  isGlobalReviewThread,
  normalizePath,
  type ReviewThread,
} from '../../lib/review-threads';
import { getPullRequestStatus } from './forge-search-result-parts';
import type { CommandPaletteItem } from './command-palette';

function ActiveBadge({ label = 'Active' }: { label?: string }) {
  return (
    <span className="rounded border border-ink-300 px-1.5 py-0.5 text-[10px] font-semibold text-ink-700">
      {label}
    </span>
  );
}

function PullRequestStatusBadge({ pullRequest }: { pullRequest: PullRequestSummary }) {
  const status = getPullRequestStatus(pullRequest);
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${status.className}`}>
      {status.label}
    </span>
  );
}

function formatThreadLocation(thread: ReviewThread) {
  if (isGlobalReviewThread(thread)) {
    return 'Global comment';
  }

  const lineLabel =
    thread.line !== null
      ? `line ${thread.line}`
      : isFileReviewThread(thread)
        ? 'file comment'
        : 'comment';
  return `${normalizePath(thread.path)} · ${lineLabel}`;
}

function buildRepoNamespacePrefixes(nameWithOwner: string) {
  const segments = nameWithOwner.split('/').filter(Boolean);
  if (segments.length < 2) {
    return [];
  }

  const prefixes: string[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    prefixes.push(segments.slice(0, index + 1).join('/'));
  }

  return prefixes;
}

function repoMatchesNamespaceFilter(
  repo: Pick<RepoSummary, 'nameWithOwner'>,
  namespacePath: string | null,
) {
  if (!namespacePath) {
    return true;
  }

  return repo.nameWithOwner === namespacePath || repo.nameWithOwner.startsWith(`${namespacePath}/`);
}

function buildPullRequestContentPaletteItems(args: {
  changedFiles: string[];
  patchViewerSessionKey: string | null;
  reviewThreads: ReviewThread[];
}) {
  const requestNavigationIntent = usePatchViewerStore.getState().requestNavigationIntent;
  const fileItems: CommandPaletteItem[] = args.changedFiles.map((path) => {
    const basename = path.split('/').at(-1) ?? path;
    return {
      id: `file:${path}`,
      group: 'Files',
      title: path,
      subtitle: basename === path ? null : basename,
      keywords: [basename],
      icon: <FileCode2Icon className="size-4" />,
      onSelect: () => {
        if (!args.patchViewerSessionKey) {
          return;
        }

        requestNavigationIntent(args.patchViewerSessionKey, {
          kind: 'file',
          path,
        });
      },
    };
  });

  const threadItems: CommandPaletteItem[] = args.reviewThreads.map((thread) => {
    const rootComment = getThreadRootComment(thread);
    const preview = rootComment?.body.trim() || 'Open comment thread';
    const author = rootComment?.authorLogin ?? 'unknown';
    const statusLabel = [
      isGlobalReviewThread(thread) ? 'global' : null,
      thread.isResolved ? 'resolved' : null,
      thread.isOutdated ? 'outdated' : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' · ');

    return {
      id: `thread:${getReviewThreadRefKey(thread)}`,
      group: 'Comments',
      title: preview,
      subtitle: `${formatThreadLocation(thread)} · ${author}${statusLabel ? ` · ${statusLabel}` : ''}`,
      keywords: [
        preview,
        normalizePath(thread.path),
        author,
        String(thread.line ?? ''),
        thread.isResolved ? 'resolved' : 'unresolved',
        thread.isOutdated ? 'outdated' : 'active',
      ],
      icon: <MessageSquareMoreIcon className="size-4" />,
      badge: !isActiveReviewThread(thread) ? (
        <span className="rounded border border-ink-300 px-1.5 py-0.5 text-[10px] font-semibold text-ink-600">
          {thread.isResolved ? 'Resolved' : 'Outdated'}
        </span>
      ) : undefined,
      onSelect: () => {
        if (!args.patchViewerSessionKey) {
          return;
        }

        requestNavigationIntent(args.patchViewerSessionKey, {
          kind: 'thread',
          threadKey: getReviewThreadRefKey(thread),
          filePath: isGlobalReviewThread(thread) ? null : normalizePath(thread.path),
          isGlobal: isGlobalReviewThread(thread),
          expandInactiveComments: isFileReviewThread(thread) && !isActiveReviewThread(thread),
        });
      },
    };
  });

  return [...fileItems, ...threadItems];
}

export {
  ActiveBadge,
  PullRequestStatusBadge,
  buildPullRequestContentPaletteItems,
  buildRepoNamespacePrefixes,
  repoMatchesNamespaceFilter,
};
