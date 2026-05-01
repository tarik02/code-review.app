import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useNavigate } from '@tanstack/react-router';
import {
  CheckIcon,
  EyeIcon,
  FilterXIcon,
  FolderGit2Icon,
  GitPullRequestIcon,
  MessageSquareMoreIcon,
  PanelsTopLeftIcon,
  PaintbrushIcon,
  Settings2Icon,
  UserCircle2Icon,
} from 'lucide-react';
import {
  usePullRequestApprovalMutations,
  usePullRequestReviewCommentMutations,
  usePullRequestSearchForAccounts,
  useRepoPickerReposForAccounts,
  useSavedRepos,
  dedupeOverviewPullRequestEntries,
} from '../../hooks/use-forge-queries';
import { useEnabledProviderAccounts } from '../../hooks/use-enabled-provider-accounts';
import {
  forgeKeys,
  pullRequestListQueryOptions,
  savedReposQueryOptions,
  setTrackedPullRequestOrder,
  trackedReposQueryOptions,
} from '../../queries/forge';
import { trpc } from '../../lib/trpc';
import { repoIdentity, repoIdentityKey, sameRepoIdentity } from '../../lib/repo-identity';
import { matchesPullRequestSearchState } from '../../lib/pull-request-search';
import {
  prependTrackedPullRequestOrderEntry,
  toTrackedPullRequestOrderEntry,
} from '../../lib/tracked-pull-request-order';
import type { ReviewThread } from '../../lib/review-threads';
import {
  applyProfileFilterChange,
  applyRepoFilterChange,
  initialMainAppViewState,
  useMainAppViewStore,
} from '../../stores/main-app-view-store';
import { useCommandPaletteStore } from '../../stores/command-palette-store';
import { usePatchViewerStore } from '../../stores/patch-viewer-store';
import { useReviewCommentEditorStore } from '../../stores/review-comment-editor-store';
import type {
  OverviewPullRequestSummary,
  PendingReviewState,
  PullRequestApprovalState,
  PullRequestSearchState,
  PullRequestSummary,
  RepoSummary,
  SelectedPullRequest,
  TrackedPullRequestOrderEntry,
} from '../../types/forge';
import { Button } from './button';
import { CommandPalette, type CommandPaletteItem } from './command-palette';
import {
  PullRequestStatusIcon,
  RepoAvatar,
  formatPullRequestDisplayTitle,
  getPullRequestStatus,
} from './forge-search-result-parts';
import {
  ActiveBadge,
  PullRequestStatusBadge,
  buildPullRequestContentPaletteItems,
  buildRepoNamespacePrefixes,
  repoMatchesNamespaceFilter,
} from './app-command-palette-items';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

type SidebarPullRequestView = 'overview' | 'tracked';
const BROWSE_QUERY_DEBOUNCE_MS = 250;
const PULL_REQUEST_STATE_LABELS: Record<PullRequestSearchState, string> = {
  open: 'Open',
  draft_open: 'Draft/Open',
  all: 'All states',
};

type PullRequestContentPaletteProps = {
  changedFiles: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patchViewerSessionKey: string | null;
  reviewThreads: ReviewThread[];
  selectedPr: SelectedPullRequest | null;
};

type BrowsePaletteProps = {
  localPullRequests?: OverviewPullRequestSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type HomeWorkflowPaletteProps = {
  approvalState: PullRequestApprovalState | null;
  diffSessionKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingReview: PendingReviewState;
  selectedPr: SelectedPullRequest | null;
  selectedPrKey: string | null;
  sidebarView: SidebarPullRequestView;
  setSidebarView: (view: SidebarPullRequestView) => void;
};

type HomeCommandPalettesProps = PullRequestContentPaletteProps &
  Omit<HomeWorkflowPaletteProps, 'open' | 'onOpenChange'> & {
    localPullRequests: OverviewPullRequestSummary[];
  };

type SettingsCommandPalettesProps = {
  handleBackToPrs: () => void;
};

function FilterChipButton({
  children,
  onClear,
}: {
  children: ReactNode;
  onClear: () => void;
}) {
  return (
    <button
      className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-canvas px-2 py-1 text-[11px] font-medium text-ink-700 transition hover:border-neutral-400 dark:border-neutral-700"
      onClick={onClear}
      type="button"
    >
      <span>{children}</span>
      <span aria-hidden="true" className="text-ink-500">
        x
      </span>
    </button>
  );
}

function PullRequestContentPalette({
  changedFiles,
  open,
  onOpenChange,
  patchViewerSessionKey,
  reviewThreads,
  selectedPr,
}: PullRequestContentPaletteProps) {
  const items = useMemo(
    () =>
      selectedPr
        ? buildPullRequestContentPaletteItems({
            changedFiles,
            patchViewerSessionKey,
            reviewThreads,
          }).map((item) => ({
            ...item,
            onSelect: () => {
              item.onSelect();
              onOpenChange(false);
            },
          }))
        : [],
    [changedFiles, onOpenChange, patchViewerSessionKey, reviewThreads, selectedPr],
  );

  return (
    <CommandPalette
      emptyDescription={
        selectedPr
          ? 'No files or comments matched the current query.'
          : 'Select a pull request or merge request first.'
      }
      emptyTitle={selectedPr ? 'No matches' : 'No pull request selected'}
      items={items}
      numberedShortcuts
      open={open}
      onOpenChange={onOpenChange}
      placeholder="Search files and comments"
      searchKeys={[
        { name: 'title', weight: 0.8 },
        { name: 'keywords', weight: 0.5 },
        { name: 'subtitle', weight: 0.3 },
      ]}
    />
  );
}

function BrowsePalette({ localPullRequests = [], open, onOpenChange }: BrowsePaletteProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { enabledAccountIds, enabledProviderAccounts } = useEnabledProviderAccounts();
  const { repos: savedRepos = [] } = useSavedRepos();
  const trackedReposQuery = useQuery(trackedReposQueryOptions());
  const trackedRepos = trackedReposQuery.data ?? [];
  const [browseFilters, setBrowseFilters] = useState({
    ...initialMainAppViewState,
    namespaceFilterPath: null as string | null,
  });
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [pullRequestState, setPullRequestState] = useState<PullRequestSearchState>('all');
  const profileFilterAccountId = browseFilters.profileFilterAccountId;
  const repoFilterKey = browseFilters.repoFilterKey;
  const namespaceFilterPath = browseFilters.namespaceFilterPath;
  const hasQuery = query.trim().length > 0;
  const hasDebouncedQuery = debouncedQuery.trim().length > 0;
  const hasScopedPullRequestSource = Boolean(repoFilterKey || namespaceFilterPath);
  const hasGlobalPullRequestSearch =
    hasQuery && hasDebouncedQuery && !hasScopedPullRequestSource;
  const enabledAccountIdSet = useMemo(() => new Set(enabledAccountIds), [enabledAccountIds]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebouncedQuery('');
      setPullRequestState('all');
      setBrowseFilters({
        ...initialMainAppViewState,
        namespaceFilterPath: null,
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, BROWSE_QUERY_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [open, query]);

  const { availableRepos, isLoadingRepos } = useRepoPickerReposForAccounts(
    enabledProviderAccounts,
    enabledAccountIds,
    debouncedQuery,
    open,
  );
  const pullRequestSearch = usePullRequestSearchForAccounts({
    accounts: enabledProviderAccounts,
    enabledAccountIds,
    query: debouncedQuery,
    states: pullRequestState,
    enabled: open && hasGlobalPullRequestSearch,
    limit: 12,
  });
  const localPullRequestEntries = useMemo(
    () => dedupeOverviewPullRequestEntries(localPullRequests),
    [localPullRequests],
  );
  const browseRepos = useMemo(() => {
    const reposByIdentity = new Map<string, RepoSummary>();

    for (const repo of [
      ...trackedRepos,
      ...savedRepos,
      ...availableRepos,
      ...localPullRequestEntries.map((entry) => entry.repo),
    ]) {
      if (!enabledAccountIdSet.has(repo.providerAccountId)) {
        continue;
      }

      const key = repoIdentityKey(repo);
      if (!reposByIdentity.has(key)) {
        reposByIdentity.set(key, repo);
      }
    }

    return [...reposByIdentity.values()];
  }, [availableRepos, enabledAccountIdSet, localPullRequestEntries, savedRepos, trackedRepos]);

  const repoAccountIdByKey = useMemo(() => {
    const entries = new Map<string, string>();
    for (const repo of [
      ...browseRepos,
      ...localPullRequestEntries.map((entry) => entry.repo),
      ...pullRequestSearch.pullRequests.map((entry) => entry.repo),
    ]) {
      entries.set(repo.repoKey, repo.providerAccountId);
    }
    return Object.fromEntries(entries);
  }, [browseRepos, localPullRequestEntries, pullRequestSearch.pullRequests]);
  const namespaceItems = useMemo(() => {
    const entries = new Map<
      string,
      {
        accountId: string;
        namespacePath: string;
        providerAccountLabel: string;
        repoCount: number;
      }
    >();

    for (const repo of browseRepos) {
      if (profileFilterAccountId && repo.providerAccountId !== profileFilterAccountId) {
        continue;
      }

      for (const namespacePath of buildRepoNamespacePrefixes(repo.nameWithOwner)) {
        const key = `${repo.providerAccountId}:${namespacePath}`;
        const existing = entries.get(key);
        if (existing) {
          existing.repoCount += 1;
          continue;
        }

        entries.set(key, {
          accountId: repo.providerAccountId,
          namespacePath,
          providerAccountLabel: repo.providerAccountLabel,
          repoCount: 1,
        });
      }
    }

    return [...entries.values()].sort((left, right) =>
      left.namespacePath.localeCompare(right.namespacePath),
    );
  }, [browseRepos, profileFilterAccountId]);
  const filteredRepos = useMemo(
    () =>
      browseRepos.filter(
        (repo) =>
          (!profileFilterAccountId || repo.providerAccountId === profileFilterAccountId) &&
          (!repoFilterKey || repo.repoKey === repoFilterKey) &&
          repoMatchesNamespaceFilter(repo, namespaceFilterPath),
      ),
    [browseRepos, namespaceFilterPath, profileFilterAccountId, repoFilterKey],
  );
  const repoScopedPullRequestRepos = useMemo(
    () => (hasScopedPullRequestSource ? filteredRepos : []),
    [filteredRepos, hasScopedPullRequestSource],
  );
  const repoScopedPullRequestQueries = useQueries({
    queries: repoScopedPullRequestRepos.map((repo) => ({
      ...pullRequestListQueryOptions(repoIdentity(repo)),
      enabled: open && hasScopedPullRequestSource,
    })),
  });
  const repoScopedPullRequests = useMemo(() => {
    const entriesByKey = new Map<string, OverviewPullRequestSummary>();

    for (let index = 0; index < repoScopedPullRequestRepos.length; index += 1) {
      const repo = repoScopedPullRequestRepos[index];
      const pullRequests = repoScopedPullRequestQueries[index]?.data ?? [];

      for (const pullRequest of pullRequests) {
        if (!matchesPullRequestSearchState(pullRequest, pullRequestState)) {
          continue;
        }

        const entry = { repo, pullRequest } satisfies OverviewPullRequestSummary;
        const key = `${repoIdentityKey(repo)}#${pullRequest.number}`;
        const existing = entriesByKey.get(key);
        if (
          !existing ||
          Date.parse(pullRequest.updatedAt || '') >
            Date.parse(existing.pullRequest.updatedAt || '')
        ) {
          entriesByKey.set(key, entry);
        }
      }
    }

    return [...entriesByKey.values()].sort(
      (left, right) =>
        Date.parse(right.pullRequest.updatedAt || '') -
        Date.parse(left.pullRequest.updatedAt || ''),
    );
  }, [
    pullRequestState,
    repoScopedPullRequestQueries,
    repoScopedPullRequestRepos,
  ]);
  const repoScopedPullRequestErrors = useMemo(
    () =>
      repoScopedPullRequestQueries
        .map((queryResult) => queryResult.error)
        .filter((error): error is Error => error instanceof Error)
        .map((error) => error.message),
    [repoScopedPullRequestQueries],
  );
  const repoScopedPullRequestsLoading =
    open &&
    hasScopedPullRequestSource &&
    repoScopedPullRequestQueries.some(
      (queryResult) => queryResult.isPending || queryResult.isFetching,
    );
  const pullRequestEntries = useMemo(() => {
    if (hasScopedPullRequestSource) {
      return repoScopedPullRequests;
    }

    if (hasGlobalPullRequestSearch) {
      return pullRequestSearch.pullRequests;
    }

    return localPullRequestEntries;
  }, [
    hasGlobalPullRequestSearch,
    hasScopedPullRequestSource,
    localPullRequestEntries,
    pullRequestSearch.pullRequests,
    repoScopedPullRequests,
  ]);
  const filteredPullRequests = useMemo(
    () =>
      pullRequestEntries.filter(
        (entry) =>
          enabledAccountIdSet.has(entry.repo.providerAccountId) &&
          (!profileFilterAccountId || entry.repo.providerAccountId === profileFilterAccountId) &&
          (!repoFilterKey || entry.repo.repoKey === repoFilterKey) &&
          repoMatchesNamespaceFilter(entry.repo, namespaceFilterPath) &&
          matchesPullRequestSearchState(entry.pullRequest, pullRequestState),
      ),
    [
      namespaceFilterPath,
      enabledAccountIdSet,
      profileFilterAccountId,
      pullRequestEntries,
      pullRequestState,
      repoFilterKey,
    ],
  );
  const isSearchPending =
    (hasQuery || hasScopedPullRequestSource) &&
    (query !== debouncedQuery ||
      isLoadingRepos ||
      (hasScopedPullRequestSource ? repoScopedPullRequestsLoading : pullRequestSearch.isLoading));
  const inputFooter = useMemo(() => {
    const filterButtons: ReactNode[] = [];

    if (profileFilterAccountId) {
      const account = enabledProviderAccounts.find((entry) => entry.id === profileFilterAccountId);
      filterButtons.push(
        <FilterChipButton
          key="profile-filter"
          onClear={() => {
            setBrowseFilters((current) => ({
              ...applyProfileFilterChange(current, null, repoAccountIdByKey),
              namespaceFilterPath: current.namespaceFilterPath,
            }));
          }}
        >
          {`profile: ${account?.label ?? profileFilterAccountId}`}
        </FilterChipButton>,
      );
    }

    if (repoFilterKey) {
      filterButtons.push(
        <FilterChipButton
          key="repo-filter"
          onClear={() => {
            setBrowseFilters((current) => ({
              ...current,
              repoFilterKey: null,
            }));
          }}
        >
          {`repo: ${repoFilterKey}`}
        </FilterChipButton>,
      );
    }

    if (namespaceFilterPath) {
      filterButtons.push(
        <FilterChipButton
          key="namespace-filter"
          onClear={() => {
            setBrowseFilters((current) => ({
              ...current,
              namespaceFilterPath: null,
            }));
          }}
        >
          {`group/org: ${namespaceFilterPath}`}
        </FilterChipButton>,
      );
    }

    if (filterButtons.length === 0) {
      return null;
    }

    return <div className="flex flex-wrap gap-1.5">{filterButtons}</div>;
  }, [
    enabledProviderAccounts,
    namespaceFilterPath,
    profileFilterAccountId,
    repoAccountIdByKey,
    repoFilterKey,
  ]);

  const footer = useMemo(() => {
    if (!hasQuery && !hasScopedPullRequestSource) {
      return (
        <p className="text-xs text-ink-500">
          {filteredPullRequests.length > 0
            ? `Showing ${filteredPullRequests.length} locally available pull request${filteredPullRequests.length === 1 ? '' : 's'} from tracked and overview lists.`
            : 'No local pull requests available. Type to search pull requests across enabled profiles.'}
        </p>
      );
    }

    const statusParts: string[] = [];
    const searchErrors = hasScopedPullRequestSource
      ? repoScopedPullRequestErrors
      : pullRequestSearch.errors;

    if (query !== debouncedQuery) {
      statusParts.push('Updating search...');
    }

    if (hasScopedPullRequestSource ? repoScopedPullRequestsLoading : pullRequestSearch.isLoading) {
      statusParts.push(
        hasScopedPullRequestSource
          ? `Loading pull requests for ${repoScopedPullRequestRepos.length} matching repos...`
          : `Searching ${pullRequestSearch.pendingCount} of ${pullRequestSearch.accountIds.length} profile${pullRequestSearch.accountIds.length === 1 ? '' : 's'}...`,
      );
    } else if (hasDebouncedQuery || hasScopedPullRequestSource) {
      statusParts.push(
        hasScopedPullRequestSource
          ? `Loaded pull requests for ${repoScopedPullRequestRepos.length} matching repos.`
          : `Loaded pull requests for ${pullRequestSearch.completedCount} of ${pullRequestSearch.accountIds.length} profile${pullRequestSearch.accountIds.length === 1 ? '' : 's'}.`,
      );
    }

    if (searchErrors.length > 0) {
      statusParts.push(
        hasScopedPullRequestSource
          ? `Some repositories failed: ${searchErrors[0]}`
          : `Some profiles failed: ${searchErrors[0]}`,
      );
    }

    if (statusParts.length === 0) {
      return null;
    }

    return <p className="text-xs text-ink-500">{statusParts.join(' ')}</p>;
  }, [
    debouncedQuery,
    hasDebouncedQuery,
    hasQuery,
    hasScopedPullRequestSource,
    filteredPullRequests.length,
    query,
    repoScopedPullRequestErrors,
    repoScopedPullRequestRepos.length,
    repoScopedPullRequestsLoading,
    pullRequestSearch.accountIds.length,
    pullRequestSearch.completedCount,
    pullRequestSearch.errors,
    pullRequestSearch.isLoading,
    pullRequestSearch.pendingCount,
  ]);

  const cacheSavedRepo = useCallback((repo: RepoSummary) => {
    queryClient.setQueryData<RepoSummary[]>(savedReposQueryOptions().queryKey, (current) => {
      if (!current) {
        return [repo];
      }
      if (current.some((entry) => sameRepoIdentity(entry, repo))) {
        return current;
      }
      return [...current, repo];
    });
  }, [queryClient]);

  const cacheTrackedRepo = useCallback((repo: RepoSummary) => {
    queryClient.setQueryData<RepoSummary[]>(forgeKeys.trackedRepos(), (current) => {
      if (!current) {
        return [repo];
      }
      if (current.some((entry) => sameRepoIdentity(entry, repo))) {
        return current;
      }
      return [...current, repo];
    });
  }, [queryClient]);

  const cacheTrackedPullRequest = useCallback((repo: RepoSummary, pullRequest: PullRequestSummary) => {
    queryClient.setQueryData<PullRequestSummary[]>(
      forgeKeys.trackedPullRequestList(repo),
      (current) => {
        const next = current ?? [];
        return [pullRequest, ...next.filter((entry) => entry.number !== pullRequest.number)];
      },
    );
  }, [queryClient]);

  const moveTrackedPullRequestToTop = useCallback(async (repo: RepoSummary, pullRequest: PullRequestSummary) => {
    const currentOrder =
      queryClient.getQueryData<TrackedPullRequestOrderEntry[]>(forgeKeys.trackedPullRequestOrder()) ??
      (await trpc.tracked.getOrder.query());
    const nextOrder = prependTrackedPullRequestOrderEntry(
      currentOrder,
      toTrackedPullRequestOrderEntry({ repo, pullRequest }),
    );
    queryClient.setQueryData(forgeKeys.trackedPullRequestOrder(), nextOrder);
    const persisted = await setTrackedPullRequestOrder(nextOrder);
    queryClient.setQueryData(forgeKeys.trackedPullRequestOrder(), persisted);
  }, [queryClient]);

  const items = useMemo(() => {
    const profileItems: CommandPaletteItem[] = [];
    const namespaceFilterItems: CommandPaletteItem[] = [];
    const repoItems: CommandPaletteItem[] = [];
    const pullRequestItems: CommandPaletteItem[] = [];

    if (!hasQuery && !hasScopedPullRequestSource && filteredPullRequests.length === 0) {
      pullRequestItems.push({
        id: 'local-pull-request-search-hint',
        group: 'Pull requests',
        title: 'No local pull requests',
        subtitle: 'Tracked and overview pull requests appear here before global search starts.',
        icon: <GitPullRequestIcon className="size-4" />,
        disabled: true,
        onSelect: () => {},
      });
    }

    for (const account of enabledProviderAccounts) {
      if (account.id === profileFilterAccountId) {
        continue;
      }

      profileItems.push({
        id: `profile:${account.id}`,
        group: 'Profiles',
        title: account.label,
        subtitle: `${account.provider} · ${account.host}`,
        keywords: [account.label, account.provider, account.host, account.viewerLogin ?? ''],
        icon: <UserCircle2Icon className="size-4" />,
        badge: profileFilterAccountId === account.id ? <ActiveBadge /> : undefined,
        onSelect: () => {
          setBrowseFilters((current) => ({
            ...applyProfileFilterChange(current, account.id, repoAccountIdByKey),
            namespaceFilterPath: current.namespaceFilterPath,
          }));
          setQuery('');
          setDebouncedQuery('');
        },
      });
    }

    for (const namespaceItem of namespaceItems) {
      if (namespaceItem.namespacePath === namespaceFilterPath) {
        continue;
      }

      namespaceFilterItems.push({
        id: `namespace:${namespaceItem.accountId}:${namespaceItem.namespacePath}`,
        group: 'Groups and orgs',
        title: namespaceItem.namespacePath,
        subtitle: `${namespaceItem.providerAccountLabel} · ${namespaceItem.repoCount} repo${namespaceItem.repoCount === 1 ? '' : 's'}`,
        keywords: [namespaceItem.providerAccountLabel],
        icon: <FolderGit2Icon className="size-4" />,
        onSelect: () => {
          setBrowseFilters((current) => ({
            ...applyProfileFilterChange(current, namespaceItem.accountId, repoAccountIdByKey),
            namespaceFilterPath: namespaceItem.namespacePath,
            repoFilterKey: null,
          }));
          setQuery('');
          setDebouncedQuery('');
        },
      });
    }

    for (const repo of filteredRepos) {
      if (repo.repoKey === repoFilterKey) {
        continue;
      }

      repoItems.push({
        id: `repo:${repoIdentityKey(repo)}`,
        group: 'Repositories',
        title: repo.nameWithOwner,
        subtitle: `${repo.description ? `${repo.description} · ` : ''}${repo.providerAccountLabel}`,
        keywords: [
          ...buildRepoNamespacePrefixes(repo.nameWithOwner),
          repo.description ?? '',
          repo.providerAccountLabel,
        ],
        icon: <RepoAvatar repo={repo} />,
        badge: repoFilterKey === repo.repoKey ? <ActiveBadge /> : undefined,
        onSelect: () => {
          void (async () => {
            const savedRepo =
              savedRepos.find((candidate) => sameRepoIdentity(candidate, repo)) ??
              (await trpc.repos.save.mutate({ repo }));
            await cacheSavedRepo(savedRepo);
            setBrowseFilters((current) => ({
              ...applyRepoFilterChange(current, savedRepo),
              namespaceFilterPath: current.namespaceFilterPath,
            }));
            setQuery('');
            setDebouncedQuery('');
          })();
        },
      });
    }

    for (const entry of filteredPullRequests) {
      pullRequestItems.push({
        id: `pr:${repoIdentityKey(entry.repo)}#${entry.pullRequest.number}`,
        group: 'Pull requests',
        title: formatPullRequestDisplayTitle(entry.pullRequest.title),
        subtitle: `${entry.repo.nameWithOwner} · #${entry.pullRequest.number} · ${entry.pullRequest.authorLogin}`,
        keywords: [
          ...buildRepoNamespacePrefixes(entry.repo.nameWithOwner),
          String(entry.pullRequest.number),
          entry.pullRequest.authorLogin,
          entry.pullRequest.title,
        ],
        icon: <PullRequestStatusIcon status={getPullRequestStatus(entry.pullRequest).status} />,
        badge: <PullRequestStatusBadge pullRequest={entry.pullRequest} />,
        onSelect: () => {
          void (async () => {
            const savedRepo =
              savedRepos.find((candidate) => sameRepoIdentity(candidate, entry.repo)) ??
              (await trpc.repos.save.mutate({ repo: entry.repo }));
            await cacheSavedRepo(savedRepo);

            const trackedPullRequest = await trpc.tracked.track.mutate({
              ...repoIdentity(savedRepo),
              pullRequest: entry.pullRequest,
            });
            await cacheTrackedRepo(savedRepo);
            await cacheTrackedPullRequest(savedRepo, trackedPullRequest);
            await moveTrackedPullRequestToTop(savedRepo, trackedPullRequest);
            await navigate({
              to: '/',
              search: {
                providerId: savedRepo.providerId,
                repoKey: savedRepo.repoKey,
                pr: trackedPullRequest.number,
              },
            });
            onOpenChange(false);
          })();
        },
      });
    }

    return [
      ...(profileFilterAccountId ? [] : profileItems),
      ...(namespaceFilterPath ? [] : namespaceFilterItems),
      ...(repoFilterKey ? [] : repoItems),
      ...pullRequestItems,
      ...(repoFilterKey ? repoItems : []),
      ...(namespaceFilterPath ? namespaceFilterItems : []),
      ...(profileFilterAccountId ? profileItems : []),
    ];
  }, [
    enabledProviderAccounts,
    filteredPullRequests,
    filteredRepos,
    hasQuery,
    hasScopedPullRequestSource,
    moveTrackedPullRequestToTop,
    navigate,
    onOpenChange,
    profileFilterAccountId,
    cacheSavedRepo,
    cacheTrackedPullRequest,
    cacheTrackedRepo,
    namespaceFilterPath,
    namespaceItems,
    repoAccountIdByKey,
    repoFilterKey,
    savedRepos,
  ]);

  return (
    <CommandPalette
      accessory={
        <Select value={pullRequestState} onValueChange={(value) => setPullRequestState(value as PullRequestSearchState)}>
          <SelectTrigger className="h-8 min-w-[132px] border-neutral-300 bg-surface text-xs" size="sm">
            <SelectValue>{PULL_REQUEST_STATE_LABELS[pullRequestState]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="draft_open">Draft/Open</SelectItem>
            <SelectItem value="all">All states</SelectItem>
          </SelectContent>
        </Select>
      }
      emptyDescription={
        hasQuery || hasScopedPullRequestSource
          ? isSearchPending
            ? 'Results will appear as repositories and pull requests come back.'
          : (hasScopedPullRequestSource
              ? repoScopedPullRequestErrors[0]
              : pullRequestSearch.errors[0]) ??
            'Try a repository name, pull request title, author, or number.'
          : 'Tracked and overview pull requests appear locally. Start typing to search globally.'
      }
      emptyTitle={isSearchPending ? 'Searching...' : 'No matching profiles, repositories, or pull requests'}
      footer={footer}
      inputFooter={inputFooter}
      items={items}
      numberedShortcuts
      open={open}
      onOpenChange={onOpenChange}
      placeholder="Browse profiles, repositories, and pull requests"
      query={query}
      onQueryChange={setQuery}
      searchKeys={[
        { name: 'title', weight: 0.7 },
        { name: 'keywords', weight: 0.5 },
        { name: 'subtitle', weight: 0.3 },
      ]}
    />
  );
}

function HomeWorkflowPalette({
  approvalState,
  diffSessionKey,
  open,
  onOpenChange,
  pendingReview,
  selectedPr,
  selectedPrKey,
  sidebarView,
  setSidebarView,
}: HomeWorkflowPaletteProps) {
  const navigate = useNavigate();
  const openBrowse = useCommandPaletteStore((state) => state.openBrowse);
  const clearProfileFilter = useMainAppViewStore((state) => state.clearProfileFilter);
  const clearRepoFilter = useMainAppViewStore((state) => state.clearRepoFilter);
  const profileFilterAccountId = useMainAppViewStore((state) => state.profileFilterAccountId);
  const repoFilterKey = useMainAppViewStore((state) => state.repoFilterKey);
  const { approveMutation, removeApprovalMutation } = usePullRequestApprovalMutations(selectedPr);
  const { discardPendingReviewMutation, publishPendingReviewMutation } =
    usePullRequestReviewCommentMutations(selectedPr);
  const [submitReviewMode, setSubmitReviewMode] = useState(false);
  const [submitAction, setSubmitAction] = useState<'comment' | 'approve' | 'request_changes'>('comment');
  const [submitSummary, setSubmitSummary] = useState('');

  useEffect(() => {
    if (open) {
      return;
    }

    setSubmitReviewMode(false);
    setSubmitAction('comment');
    setSubmitSummary('');
  }, [open]);

  const items = useMemo(() => {
    if (submitReviewMode) {
      return [
        {
          id: 'submit-review-comment',
          group: 'Review type',
          title: 'Comment',
          badge: submitAction === 'comment' ? <CheckIcon className="size-3.5" /> : undefined,
          icon: <MessageSquareMoreIcon className="size-4" />,
          onSelect: () => setSubmitAction('comment'),
        },
        {
          id: 'submit-review-approve',
          group: 'Review type',
          title: 'Approve',
          badge: submitAction === 'approve' ? <CheckIcon className="size-3.5" /> : undefined,
          icon: <CheckIcon className="size-4" />,
          onSelect: () => setSubmitAction('approve'),
        },
        {
          id: 'submit-review-request-changes',
          group: 'Review type',
          title: 'Request changes',
          badge: submitAction === 'request_changes' ? <CheckIcon className="size-3.5" /> : undefined,
          icon: <FilterXIcon className="size-4" />,
          onSelect: () => setSubmitAction('request_changes'),
        },
      ] satisfies CommandPaletteItem[];
    }

    const nextItems: CommandPaletteItem[] = [
      {
        id: 'section-overview',
        group: 'Sections',
        title: 'Overview',
        icon: <PanelsTopLeftIcon className="size-4" />,
        badge: sidebarView === 'overview' ? <ActiveBadge /> : undefined,
        onSelect: () => {
          setSidebarView('overview');
          onOpenChange(false);
        },
      },
      {
        id: 'section-tracked',
        group: 'Sections',
        title: 'Tracked items',
        icon: <GitPullRequestIcon className="size-4" />,
        badge: sidebarView === 'tracked' ? <ActiveBadge /> : undefined,
        onSelect: () => {
          setSidebarView('tracked');
          onOpenChange(false);
        },
      },
      {
        id: 'section-settings',
        group: 'Sections',
        title: 'Settings',
        icon: <Settings2Icon className="size-4" />,
        onSelect: () => {
          void navigate({ to: '/settings/appearance' });
          onOpenChange(false);
        },
      },
      {
        id: 'section-appearance',
        group: 'Sections',
        title: 'Appearance',
        icon: <PaintbrushIcon className="size-4" />,
        onSelect: () => {
          void navigate({ to: '/settings/appearance' });
          onOpenChange(false);
        },
      },
      {
        id: 'section-profiles',
        group: 'Sections',
        title: 'Profiles',
        icon: <UserCircle2Icon className="size-4" />,
        onSelect: () => {
          void navigate({ to: '/settings/profiles' });
          onOpenChange(false);
        },
      },
      {
        id: 'section-review',
        group: 'Sections',
        title: 'Review',
        icon: <MessageSquareMoreIcon className="size-4" />,
        onSelect: () => {
          void navigate({ to: '/settings/review' });
          onOpenChange(false);
        },
      },
      {
        id: 'action-add-tracked-pr',
        group: 'Actions',
        title: 'Add tracked PR/MR',
        icon: <GitPullRequestIcon className="size-4" />,
        shortcut: 'Mod+K',
        onSelect: () => {
          openBrowse();
        },
      },
    ];

    if (profileFilterAccountId) {
      nextItems.push({
        id: 'action-clear-profile-filter',
        group: 'Actions',
        title: 'Clear profile filter',
        icon: <FilterXIcon className="size-4" />,
        onSelect: () => {
          clearProfileFilter();
          onOpenChange(false);
        },
      });
    }

    if (repoFilterKey) {
      nextItems.push({
        id: 'action-clear-repo-filter',
        group: 'Actions',
        title: 'Clear repo filter',
        icon: <FilterXIcon className="size-4" />,
        onSelect: () => {
          clearRepoFilter();
          onOpenChange(false);
        },
      });
    }

    if (selectedPr && !approvalState?.viewerApproved) {
      nextItems.push({
        id: 'action-approve',
        group: 'Actions',
        title: 'Approve current PR/MR',
        icon: <CheckIcon className="size-4" />,
        onSelect: () => {
          void approveMutation.mutateAsync(selectedPr).then(() => onOpenChange(false));
        },
      });
    }

    if (selectedPr && approvalState?.viewerApproved) {
      nextItems.push({
        id: 'action-remove-approval',
        group: 'Actions',
        title: 'Remove approval',
        icon: <FilterXIcon className="size-4" />,
        onSelect: () => {
          void removeApprovalMutation.mutateAsync(selectedPr).then(() => onOpenChange(false));
        },
      });
    }

    if (selectedPr && selectedPrKey && diffSessionKey) {
      nextItems.push({
        id: 'action-new-global-comment',
        group: 'Actions',
        title: 'New global comment',
        icon: <MessageSquareMoreIcon className="size-4" />,
        onSelect: () => {
          useReviewCommentEditorStore.getState().openNewEditor(selectedPrKey, { type: 'global' });
          usePatchViewerStore.getState().requestNavigationIntent(diffSessionKey, {
            kind: 'global-comments',
          });
          onOpenChange(false);
        },
      });
    }

    if (selectedPr && pendingReview.comments.length > 0) {
      nextItems.push(
        {
          id: 'action-discard-review',
          group: 'Actions',
          title: 'Discard pending review',
          icon: <FilterXIcon className="size-4" />,
          onSelect: () => {
            void discardPendingReviewMutation
              .mutateAsync(selectedPr)
              .then(() => onOpenChange(false));
          },
        },
        {
          id: 'action-submit-review',
          group: 'Actions',
          title: 'Submit pending review',
          icon: <CheckIcon className="size-4" />,
          onSelect: () => setSubmitReviewMode(true),
        },
      );
    }

    return nextItems;
  }, [
    approvalState?.viewerApproved,
    approveMutation,
    clearProfileFilter,
    clearRepoFilter,
    diffSessionKey,
    discardPendingReviewMutation,
    navigate,
    openBrowse,
    onOpenChange,
    pendingReview.comments.length,
    profileFilterAccountId,
    removeApprovalMutation,
    repoFilterKey,
    selectedPr,
    selectedPrKey,
    sidebarView,
    setSidebarView,
    submitAction,
    submitReviewMode,
  ]);

  return (
    <CommandPalette
      emptyTitle="No sections or actions available"
      filterMode={submitReviewMode ? 'none' : 'fuse'}
      footer={
        submitReviewMode ? (
          <div className="flex items-center justify-between gap-3">
            <Button
              className="justify-center"
              size="sm"
              variant="ghost"
              onClick={() => setSubmitReviewMode(false)}
              type="button"
            >
              Back
            </Button>
            <Button
              className="justify-center"
              size="sm"
              onClick={() => {
                if (!selectedPr) {
                  return;
                }

                void publishPendingReviewMutation
                  .mutateAsync({
                    ...selectedPr,
                    action: submitAction,
                    summary: submitSummary.trim() || undefined,
                  })
                  .then(() => onOpenChange(false));
              }}
              type="button"
            >
              Confirm submit
            </Button>
          </div>
        ) : null
      }
      items={items}
      open={open}
      onOpenChange={onOpenChange}
      placeholder={submitReviewMode ? 'Optional notes' : 'Jump to sections and actions'}
      query={submitReviewMode ? submitSummary : undefined}
      onQueryChange={submitReviewMode ? setSubmitSummary : undefined}
    />
  );
}

function SettingsWorkflowPalette({
  handleBackToPrs,
  open,
  onOpenChange,
}: SettingsCommandPalettesProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();

  const items: CommandPaletteItem[] = [
    {
      id: 'settings-appearance',
      group: 'Sections',
      title: 'Appearance',
      icon: <PaintbrushIcon className="size-4" />,
      onSelect: () => {
        void navigate({ to: '/settings/appearance' });
        onOpenChange(false);
      },
    },
    {
      id: 'settings-profiles',
      group: 'Sections',
      title: 'Profiles',
      icon: <UserCircle2Icon className="size-4" />,
      onSelect: () => {
        void navigate({ to: '/settings/profiles' });
        onOpenChange(false);
      },
    },
    {
      id: 'settings-review',
      group: 'Sections',
      title: 'Review',
      icon: <MessageSquareMoreIcon className="size-4" />,
      onSelect: () => {
        void navigate({ to: '/settings/review' });
        onOpenChange(false);
      },
    },
    {
      id: 'settings-back',
      group: 'Sections',
      title: 'Back to PRs',
      icon: <EyeIcon className="size-4" />,
      onSelect: () => {
        handleBackToPrs();
        onOpenChange(false);
      },
    },
  ];

  return (
    <CommandPalette
      emptyTitle="No settings destinations available"
      items={items}
      open={open}
      onOpenChange={onOpenChange}
      placeholder="Jump between settings sections"
    />
  );
}

function HomeCommandPalettes(props: HomeCommandPalettesProps) {
  const browseOpen = useCommandPaletteStore((state) => state.browseOpen);
  const contentOpen = useCommandPaletteStore((state) => state.contentOpen);
  const openBrowse = useCommandPaletteStore((state) => state.openBrowse);
  const openContent = useCommandPaletteStore((state) => state.openContent);
  const openWorkflow = useCommandPaletteStore((state) => state.openWorkflow);
  const setBrowseOpen = useCommandPaletteStore((state) => state.setBrowseOpen);
  const setContentOpen = useCommandPaletteStore((state) => state.setContentOpen);
  const setWorkflowOpen = useCommandPaletteStore((state) => state.setWorkflowOpen);
  const workflowOpen = useCommandPaletteStore((state) => state.workflowOpen);

  useHotkey('Mod+P', (event) => {
    event.preventDefault();
    openContent();
  });

  useHotkey('Mod+Shift+P', (event) => {
    event.preventDefault();
    openWorkflow();
  });

  useHotkey('Mod+K', (event) => {
    event.preventDefault();
    openBrowse();
  });

  return (
    <>
      <PullRequestContentPalette
        changedFiles={props.changedFiles}
        open={contentOpen}
        onOpenChange={setContentOpen}
        patchViewerSessionKey={props.patchViewerSessionKey}
        reviewThreads={props.reviewThreads}
        selectedPr={props.selectedPr}
      />
      <HomeWorkflowPalette
        approvalState={props.approvalState}
        diffSessionKey={props.diffSessionKey}
        open={workflowOpen}
        onOpenChange={setWorkflowOpen}
        pendingReview={props.pendingReview}
        selectedPr={props.selectedPr}
        selectedPrKey={props.selectedPrKey}
        sidebarView={props.sidebarView}
        setSidebarView={props.setSidebarView}
      />
      <BrowsePalette
        localPullRequests={props.localPullRequests}
        open={browseOpen}
        onOpenChange={setBrowseOpen}
      />
    </>
  );
}

function SettingsCommandPalettes({ handleBackToPrs }: SettingsCommandPalettesProps) {
  const browseOpen = useCommandPaletteStore((state) => state.browseOpen);
  const openBrowse = useCommandPaletteStore((state) => state.openBrowse);
  const openWorkflow = useCommandPaletteStore((state) => state.openWorkflow);
  const setBrowseOpen = useCommandPaletteStore((state) => state.setBrowseOpen);
  const setWorkflowOpen = useCommandPaletteStore((state) => state.setWorkflowOpen);
  const workflowOpen = useCommandPaletteStore((state) => state.workflowOpen);

  useHotkey('Mod+Shift+P', (event) => {
    event.preventDefault();
    openWorkflow();
  });

  useHotkey('Mod+K', (event) => {
    event.preventDefault();
    openBrowse();
  });

  return (
    <>
      <SettingsWorkflowPalette
        handleBackToPrs={handleBackToPrs}
        open={workflowOpen}
        onOpenChange={setWorkflowOpen}
      />
      <BrowsePalette open={browseOpen} onOpenChange={setBrowseOpen} />
    </>
  );
}

export {
  HomeCommandPalettes,
  SettingsCommandPalettes,
  buildPullRequestContentPaletteItems,
};
