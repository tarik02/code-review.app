import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useNavigate } from '@tanstack/react-router';
import { FolderGit2Icon, GitPullRequestIcon, UserCircle2Icon } from 'lucide-react';
import { dedupeOverviewPullRequestEntries, useSavedRepos } from '../hooks/use-forge-queries';
import { useEnabledProviderAccounts } from '../hooks/use-enabled-provider-accounts';
import {
  forgeKeys,
  savedReposQueryOptions,
  setTrackedPullRequestOrder,
  trackedReposQueryOptions,
} from '../queries/forge';
import { trpc } from '../lib/trpc';
import { repoIdentity, repoIdentityKey, sameRepoIdentity } from '../lib/repo-identity';
import {
  prependTrackedPullRequestOrderEntry,
  toTrackedPullRequestOrderEntry,
} from '../lib/tracked-pull-request-order';
import { applyProfileFilterChange, applyRepoFilterChange } from '../stores/main-app-view-store';
import type {
  OverviewPullRequestSummary,
  PullRequestSearchState,
  PullRequestSummary,
  RepoSummary,
  TrackedPullRequestOrderEntry,
} from '../types/forge';
import { CommandPalette, type CommandPaletteItem } from '../components/ui/command-palette';
import {
  PullRequestStatusIcon,
  RepoAvatar,
  formatPullRequestDisplayTitle,
  getPullRequestStatus,
} from '../components/ui/forge-search-result-parts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { ActiveBadge, PullRequestStatusBadge } from './items';
import {
  buildRepoNamespacePrefixes,
  selectBrowseNamespaceItems,
  selectBrowsePullRequestEntries,
  selectBrowseRepos,
  selectFilteredBrowsePullRequests,
  selectFilteredBrowseRepos,
  selectRepoAccountIdByKey,
} from './selectors';
import { useCommandPaletteStore } from './store';
import { FilterChipButton } from './FilterChipButton';

const PULL_REQUEST_STATE_LABELS: Record<PullRequestSearchState, string> = {
  open: 'Open',
  draft_open: 'Draft/Open',
  all: 'All states',
};

type BrowsePaletteProps = {
  localPullRequests?: OverviewPullRequestSummary[];
};

function BrowsePalette({ localPullRequests = [] }: BrowsePaletteProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { enabledAccountIds, enabledProviderAccounts } = useEnabledProviderAccounts();
  const { repos: savedRepos = [] } = useSavedRepos();
  const trackedReposQuery = useQuery(trackedReposQueryOptions());
  const trackedRepos = trackedReposQuery.data ?? [];
  const browseFilters = useCommandPaletteStore((state) => state.browseFilters);
  const open = useCommandPaletteStore((state) => state.browseOpen);
  const query = useCommandPaletteStore((state) => state.browseQuery);
  const debouncedQuery = useCommandPaletteStore((state) => state.browseDebouncedQuery);
  const pullRequestState = useCommandPaletteStore((state) => state.browsePullRequestState);
  const browseSearch = useCommandPaletteStore((state) => state.browseSearchSnapshot);
  const openBrowse = useCommandPaletteStore((state) => state.openBrowse);
  const setBrowseDebouncedQuery = useCommandPaletteStore((state) => state.setBrowseDebouncedQuery);
  const setBrowseFilters = useCommandPaletteStore((state) => state.setBrowseFilters);
  const setBrowseOpen = useCommandPaletteStore((state) => state.setBrowseOpen);
  const setBrowsePullRequestState = useCommandPaletteStore(
    (state) => state.setBrowsePullRequestState,
  );
  const setBrowseQuery = useCommandPaletteStore((state) => state.setBrowseQuery);
  const profileFilterAccountId = browseFilters.profileFilterAccountId;
  const repoFilterKey = browseFilters.repoFilterKey;
  const namespaceFilterPath = browseFilters.namespaceFilterPath;
  const hasQuery = query.trim().length > 0;
  const hasDebouncedQuery = debouncedQuery.trim().length > 0;
  const hasScopedPullRequestSource = Boolean(repoFilterKey || namespaceFilterPath);
  const hasGlobalPullRequestSearch = hasQuery && hasDebouncedQuery && !hasScopedPullRequestSource;
  const enabledAccountIdSet = new Set(enabledAccountIds);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      openBrowse(enabledAccountIds);
      return;
    }

    setBrowseOpen(false);
  }

  useHotkey('Mod+K', (event) => {
    event.preventDefault();
    openBrowse(enabledAccountIds);
  });

  const localPullRequestEntries = dedupeOverviewPullRequestEntries(localPullRequests);
  const browseRepos = selectBrowseRepos({
    enabledAccountIds: enabledAccountIdSet,
    localPullRequestEntries,
    remoteRepos: browseSearch.repos,
    savedRepos,
    trackedRepos,
  });

  const repoAccountIdByKey = selectRepoAccountIdByKey({
    localPullRequestEntries,
    pullRequestEntries: browseSearch.pullRequests,
    repos: browseRepos,
  });
  const namespaceItems = selectBrowseNamespaceItems({
    namespaces: browseSearch.namespaces,
    profileFilterAccountId,
    repos: browseRepos,
  });
  const filteredRepos = selectFilteredBrowseRepos({
    namespaceFilterPath,
    profileFilterAccountId,
    repoFilterKey,
    repos: browseRepos,
  });
  const pullRequestEntries = selectBrowsePullRequestEntries({
    hasGlobalPullRequestSearch,
    hasScopedPullRequestSource,
    localPullRequestEntries,
    remotePullRequestEntries: browseSearch.pullRequests,
  });
  const filteredPullRequests = selectFilteredBrowsePullRequests({
    enabledAccountIds: enabledAccountIdSet,
    namespaceFilterPath,
    profileFilterAccountId,
    pullRequestEntries,
    pullRequestState,
    repoFilterKey,
  });
  const isSearchPending =
    (hasQuery || hasScopedPullRequestSource) && (query !== debouncedQuery || browseSearch.loading);
  const inputFooter = (() => {
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
  })();

  const footer = (() => {
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
    const searchErrors = browseSearch.errors;

    if (query !== debouncedQuery) {
      statusParts.push('Updating search...');
    }

    if (browseSearch.loading) {
      statusParts.push(
        hasScopedPullRequestSource
          ? `Loading pull requests for ${filteredRepos.length} matching repos...`
          : `Searching ${browseSearch.pendingCount} of ${browseSearch.accountIds.length} profile${browseSearch.accountIds.length === 1 ? '' : 's'}...`,
      );
    } else if (hasDebouncedQuery || hasScopedPullRequestSource) {
      statusParts.push(
        hasScopedPullRequestSource
          ? `Loaded pull requests for ${filteredRepos.length} matching repos.`
          : `Loaded pull requests for ${browseSearch.completedCount} of ${browseSearch.accountIds.length} profile${browseSearch.accountIds.length === 1 ? '' : 's'}.`,
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
  })();

  function cacheSavedRepo(repo: RepoSummary) {
    queryClient.setQueryData<RepoSummary[]>(savedReposQueryOptions().queryKey, (current) => {
      if (!current) {
        return [repo];
      }
      if (current.some((entry) => sameRepoIdentity(entry, repo))) {
        return current;
      }
      return [...current, repo];
    });
  }

  function cacheTrackedRepo(repo: RepoSummary) {
    queryClient.setQueryData<RepoSummary[]>(forgeKeys.trackedRepos(), (current) => {
      if (!current) {
        return [repo];
      }
      if (current.some((entry) => sameRepoIdentity(entry, repo))) {
        return current;
      }
      return [...current, repo];
    });
  }

  function cacheTrackedPullRequest(repo: RepoSummary, pullRequest: PullRequestSummary) {
    queryClient.setQueryData<PullRequestSummary[]>(
      forgeKeys.trackedPullRequestList(repo),
      (current) => {
        const next = current ?? [];
        return [pullRequest, ...next.filter((entry) => entry.number !== pullRequest.number)];
      },
    );
  }

  async function moveTrackedPullRequestToTop(repo: RepoSummary, pullRequest: PullRequestSummary) {
    const currentOrder =
      queryClient.getQueryData<TrackedPullRequestOrderEntry[]>(
        forgeKeys.trackedPullRequestOrder(),
      ) ?? (await trpc.tracked.getOrder.query());
    const nextOrder = prependTrackedPullRequestOrderEntry(
      currentOrder,
      toTrackedPullRequestOrderEntry({ repo, pullRequest }),
    );
    queryClient.setQueryData(forgeKeys.trackedPullRequestOrder(), nextOrder);
    const persisted = await setTrackedPullRequestOrder(nextOrder);
    queryClient.setQueryData(forgeKeys.trackedPullRequestOrder(), persisted);
  }

  const items = (() => {
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
          setBrowseQuery('');
          setBrowseDebouncedQuery('');
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
        subtitle:
          namespaceItem.repoCount > 0
            ? `${namespaceItem.providerAccountLabel} · ${namespaceItem.repoCount} repo${namespaceItem.repoCount === 1 ? '' : 's'}`
            : `${namespaceItem.providerAccountLabel} · ${namespaceItem.kind}`,
        keywords: [namespaceItem.providerAccountLabel],
        icon: <FolderGit2Icon className="size-4" />,
        onSelect: () => {
          setBrowseFilters((current) => ({
            ...applyProfileFilterChange(current, namespaceItem.accountId, repoAccountIdByKey),
            namespaceFilterPath: namespaceItem.namespacePath,
            repoFilterKey: null,
          }));
          setBrowseQuery('');
          setBrowseDebouncedQuery('');
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
            setBrowseQuery('');
            setBrowseDebouncedQuery('');
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
            setBrowseOpen(false);
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
  })();

  return (
    <CommandPalette
      accessory={
        <Select
          value={pullRequestState}
          onValueChange={(value) => setBrowsePullRequestState(value as PullRequestSearchState)}
        >
          <SelectTrigger
            className="h-8 min-w-[132px] border-neutral-300 bg-surface text-xs"
            size="sm"
          >
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
            : (browseSearch.errors[0] ??
              'Try a repository name, pull request title, author, or number.')
          : 'Tracked and overview pull requests appear locally. Start typing to search globally.'
      }
      emptyTitle={
        isSearchPending ? 'Searching...' : 'No matching profiles, repositories, or pull requests'
      }
      footer={footer}
      inputFooter={inputFooter}
      items={items}
      numberedShortcuts
      open={open}
      onOpenChange={handleOpenChange}
      placeholder="Browse profiles, repositories, and pull requests"
      query={query}
      onQueryChange={setBrowseQuery}
      searchKeys={[
        { name: 'title', weight: 0.7 },
        { name: 'keywords', weight: 0.5 },
        { name: 'subtitle', weight: 0.3 },
      ]}
    />
  );
}

export { BrowsePalette };
export type { BrowsePaletteProps };
