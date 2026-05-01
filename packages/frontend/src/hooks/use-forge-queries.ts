import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReviewThread } from '../lib/review-threads';
import { trpc } from '../lib/trpc';
import {
  approvePullRequest,
  createPendingReviewGlobal,
  createPendingReviewReply,
  createPendingReviewThread,
  createPullRequestReviewComment,
  deletePullRequestReviewComment,
  deletePendingReviewComment,
  discardPendingReview,
  forgeKeys,
  initialReposQueryOptions,
  pullRequestCachedListQueryOptions,
  pullRequestListQueryOptions,
  pullRequestSearchQueryOptions,
  pullRequestOverviewQueryOptions,
  removePullRequestApproval,
  replyToPullRequestReviewComment,
  publishPendingReview,
  savedReposQueryOptions,
  searchNamespacesQueryOptions,
  searchReposQueryOptions,
  setPullRequestReviewThreadResolved,
  trackedPullRequestListQueryOptions,
  updatePendingReviewComment,
  updatePullRequestReviewComment,
  viewerLoginQueryOptions,
} from '../queries/forge';
import type {
  BrowseSearchSnapshot,
  CreatePendingReviewGlobalInput,
  CreatePendingReviewReplyInput,
  CreatePendingReviewThreadInput,
  CreatePullRequestReviewCommentInput,
  DeletePullRequestReviewCommentInput,
  DeletePendingReviewCommentInput,
  DiffDataMode,
  DiscardPendingReviewInput,
  ForgeProviderKind,
  NamespaceSummary,
  OverviewPullRequestSummary,
  PendingReviewState,
  PublishPendingReviewInput,
  PullRequestApprovalState,
  PullRequestSearchState,
  PrPatch,
  ProviderAccount,
  PullRequestQualityReport,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoIdentity,
  RepoSummary,
  SelectedPullRequest,
  SetPullRequestReviewThreadResolvedInput,
  UpdatePendingReviewCommentInput,
  UpdatePullRequestReviewCommentInput,
} from '../types/forge';
import {
  providerAccountIdFromProviderId,
  repoIdentity,
  repoIdentityKey,
} from '../lib/repo-identity';
import { normalizeHostInput, parseForgeResourceUrl } from '../lib/forge-links';
import { matchesPullRequestSearchState } from '../lib/pull-request-search';

function getErrorMessage(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) return error.message;
  return String(error);
}

type ParsedPullRequestUrl = NonNullable<ReturnType<typeof parseForgeResourceUrl>> & {
  number: number;
};

function emptyBrowseSearchSnapshot(accountIds: string[] = []): BrowseSearchSnapshot {
  return {
    repos: [],
    namespaces: [],
    pullRequests: [],
    accountIds,
    pendingCount: 0,
    completedCount: 0,
    errors: [],
    loading: false,
  };
}

function useBrowseSearch(args: {
  accountIds: string[];
  query: string;
  states: PullRequestSearchState;
  profileFilterAccountId: string | null;
  repoFilterKey: string | null;
  namespaceFilterPath: string | null;
  enabled?: boolean;
}) {
  const {
    accountIds,
    query,
    states,
    profileFilterAccountId,
    repoFilterKey,
    namespaceFilterPath,
    enabled = true,
  } = args;
  const [snapshot, setSnapshot] = useState<BrowseSearchSnapshot>(() =>
    emptyBrowseSearchSnapshot(accountIds),
  );
  const accountIdKey = useMemo(() => accountIds.join('\0'), [accountIds]);

  useEffect(() => {
    if (!enabled || accountIds.length === 0) {
      window.setTimeout(() => setSnapshot(emptyBrowseSearchSnapshot(accountIds)), 0);
      return;
    }

    window.setTimeout(() => {
      setSnapshot((current) => ({ ...current, accountIds, loading: true }));
    }, 0);
    const subscription = trpc.browse.search.subscribe(
      {
        accountIds,
        query,
        states,
        profileFilterAccountId,
        repoFilterKey,
        namespaceFilterPath,
        repoLimit: 20,
        namespaceLimit: 20,
        pullRequestLimit: 12,
      },
      {
        onData: (nextSnapshot) => {
          setSnapshot((current) => {
            if (nextSnapshot.loading && nextSnapshot.completedCount === 0) {
              return {
                ...nextSnapshot,
                repos: current.repos,
                namespaces: current.namespaces,
                pullRequests: current.pullRequests,
              };
            }
            return nextSnapshot;
          });
        },
        onError: (error) => {
          setSnapshot((current) => ({
            ...current,
            accountIds,
            errors: [...current.errors, getErrorMessage(error)],
            loading: false,
            pendingCount: 0,
          }));
        },
      },
    );

    return () => subscription.unsubscribe();
  }, [
    accountIdKey,
    accountIds,
    enabled,
    namespaceFilterPath,
    profileFilterAccountId,
    query,
    repoFilterKey,
    states,
  ]);

  return snapshot;
}

function filterAccountsForRepoSearch(accounts: ProviderAccount[], query: string) {
  const trimmedQuery = query.trim();
  const parsedUrl = parseForgeResourceUrl(trimmedQuery);
  if (!parsedUrl) {
    const pathSegments = trimmedQuery
      .replace(/\.git$/, '')
      .split('/')
      .filter(Boolean);
    const repoOwner = pathSegments.length >= 2 ? pathSegments[0]?.toLowerCase() : '';
    if (!repoOwner) {
      return accounts;
    }

    const ownerGithubAccounts = accounts.filter(
      (account) =>
        account.provider === 'github' && account.viewerLogin?.toLowerCase() === repoOwner,
    );
    if (ownerGithubAccounts.length === 0) {
      return accounts;
    }

    return accounts.filter(
      (account) =>
        account.provider !== 'github' || account.viewerLogin?.toLowerCase() === repoOwner,
    );
  }

  const matchingAccounts = accounts.filter(
    (account) =>
      account.provider === parsedUrl.provider &&
      normalizeHostInput(account.host) === parsedUrl.host,
  );

  if (parsedUrl.provider !== 'github') {
    return matchingAccounts;
  }

  const repoOwner = parsedUrl.repoPath.split('/')[0]?.toLowerCase() ?? '';
  const ownerAccounts = matchingAccounts.filter(
    (account) => account.viewerLogin?.toLowerCase() === repoOwner,
  );
  return ownerAccounts.length > 0 ? ownerAccounts : matchingAccounts;
}

function encodeProviderIdComponent(value: string) {
  return value.replace(/%/g, '%25').replace(/:/g, '%3A');
}

function createProviderId(account: ProviderAccount, host: string) {
  const normalizedHost = encodeProviderIdComponent(normalizeHostInput(host));
  const accountId = encodeProviderIdComponent(account.id);
  return `${account.provider}:${normalizedHost}:${accountId}`;
}

function repoNameFromPath(repoPath: string) {
  const segments = repoPath.split('/').filter(Boolean);
  return segments.at(-1) ?? repoPath;
}

function createSearchRepoFallback(account: ProviderAccount, repoPath: string, host: string) {
  const normalizedRepoPath = repoPath
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '');
  return {
    providerId: createProviderId(account, host),
    repoKey: normalizedRepoPath,
    provider: account.provider,
    host: normalizeHostInput(host),
    providerAccountId: account.id,
    providerAccountLabel: account.label,
    name: repoNameFromPath(normalizedRepoPath),
    nameWithOwner: normalizedRepoPath,
    description: null,
    isPrivate: null,
    avatarUrl: null,
  } satisfies RepoSummary;
}

function createRepoSearchFallbacks(accounts: ProviderAccount[], query: string) {
  const trimmedQuery = query.trim();
  const parsedUrl = parseForgeResourceUrl(trimmedQuery);
  if (parsedUrl) {
    return accounts
      .filter(
        (account) =>
          account.provider === parsedUrl.provider &&
          normalizeHostInput(account.host) === parsedUrl.host,
      )
      .map((account) => createSearchRepoFallback(account, parsedUrl.repoPath, parsedUrl.host));
  }

  const repoPath = trimmedQuery.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  const pathSegmentCount = repoPath.split('/').filter(Boolean).length;
  if (pathSegmentCount < 2) {
    return [];
  }

  return accounts
    .filter(
      (account) =>
        (account.provider === 'github' && pathSegmentCount === 2) ||
        (account.provider === 'gitlab' && pathSegmentCount >= 2),
    )
    .map((account) => createSearchRepoFallback(account, repoPath, account.host));
}

function useSavedRepos() {
  const query = useQuery(savedReposQueryOptions());
  return {
    ...query,
    repos: query.data ?? [],
  };
}

function useRepoPickerRepos(
  debouncedQuery: string,
  accountId: string,
  provider: ForgeProviderKind,
  host: string,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const trimmedQuery = debouncedQuery.trim();

  const { data: initialRepos = [], isPending: isInitialLoading } = useQuery({
    ...initialReposQueryOptions(accountId),
    enabled,
  });

  const {
    data: searchRepos = [],
    error: searchError,
    isPending: isSearchLoading,
  } = useQuery({
    ...searchReposQueryOptions(debouncedQuery, accountId, provider, host),
    enabled: enabled && trimmedQuery.length > 0,
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void queryClient.prefetchQuery(initialReposQueryOptions(accountId));
  }, [accountId, enabled, queryClient]);

  const availableRepos = trimmedQuery.length > 0 ? searchRepos : initialRepos;
  const isLoadingRepos = enabled && (trimmedQuery.length > 0 ? isSearchLoading : isInitialLoading);

  return {
    availableRepos,
    availableReposError: searchError,
    isLoadingRepos,
  };
}

function useRepoPickerReposForAccounts(
  accounts: ProviderAccount[],
  enabledAccountIds: string[],
  debouncedQuery: string,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const trimmedQuery = debouncedQuery.trim();
  const enabledAccountIdSet = useMemo(() => new Set(enabledAccountIds), [enabledAccountIds]);
  const activeAccounts = useMemo(
    () => accounts.filter((account) => enabledAccountIdSet.has(account.id)),
    [accounts, enabledAccountIdSet],
  );
  const isSearching = trimmedQuery.length > 0;
  const searchableAccounts = useMemo(
    () =>
      isSearching ? filterAccountsForRepoSearch(activeAccounts, trimmedQuery) : activeAccounts,
    [activeAccounts, isSearching, trimmedQuery],
  );
  const shouldQuery = enabled && searchableAccounts.length > 0;

  const initialRepoQueries = useQueries({
    queries: activeAccounts.map((account) => ({
      ...initialReposQueryOptions(account.id),
      enabled: shouldQuery && !isSearching,
    })),
  });
  const searchRepoQueries = useQueries({
    queries: searchableAccounts.map((account) => ({
      ...searchReposQueryOptions(debouncedQuery, account.id, account.provider, account.host),
      enabled: shouldQuery && isSearching,
      placeholderData: (previousData: RepoSummary[] | undefined) => previousData,
    })),
  });
  const searchNamespaceQueries = useQueries({
    queries: searchableAccounts.map((account) => ({
      ...searchNamespacesQueryOptions(debouncedQuery, account.id),
      enabled: shouldQuery && isSearching,
      placeholderData: (previousData: NamespaceSummary[] | undefined) => previousData,
    })),
  });

  useEffect(() => {
    if (!enabled || activeAccounts.length === 0) {
      return;
    }

    for (const account of activeAccounts) {
      void queryClient.prefetchQuery(initialReposQueryOptions(account.id));
    }
  }, [activeAccounts, enabled, queryClient]);

  const activeQueries = isSearching ? searchRepoQueries : initialRepoQueries;
  const availableRepos = useMemo(() => {
    const byId = new Map<string, RepoSummary>();
    for (const query of activeQueries) {
      for (const repo of query.data ?? []) {
        byId.set(repoIdentityKey(repo), repo);
      }
    }
    if (isSearching) {
      for (const repo of createRepoSearchFallbacks(searchableAccounts, trimmedQuery)) {
        if (!byId.has(repoIdentityKey(repo))) {
          byId.set(repoIdentityKey(repo), repo);
        }
      }
    }
    return [...byId.values()];
  }, [activeQueries, isSearching, searchableAccounts, trimmedQuery]);
  const isLoadingRepos =
    shouldQuery &&
    (activeQueries.some((query) => query.isPending || query.isFetching) ||
      (isSearching && searchNamespaceQueries.some((query) => query.isPending || query.isFetching)));
  const availableNamespaces = useMemo(() => {
    const byId = new Map<string, NamespaceSummary>();
    if (!isSearching) {
      return [];
    }

    for (const query of searchNamespaceQueries) {
      for (const namespace of query.data ?? []) {
        byId.set(`${namespace.providerAccountId}:${namespace.path}`, namespace);
      }
    }
    return [...byId.values()];
  }, [isSearching, searchNamespaceQueries]);
  const availableReposError = useMemo(() => {
    if (!shouldQuery || isLoadingRepos) {
      return null;
    }

    const errors = activeQueries
      .map((query) => query.error)
      .filter((error): error is Error => error instanceof Error);
    if (errors.length === 0) {
      return null;
    }

    if (availableRepos.length === 0) {
      return errors.map(getErrorMessage).join('; ');
    }

    return null;
  }, [activeQueries, availableRepos.length, isLoadingRepos, shouldQuery]);
  return {
    availableRepos,
    availableNamespaces,
    availableReposError,
    isLoadingRepos,
  };
}

function useInitialReposForAccounts(
  accounts: ProviderAccount[],
  enabledAccountIds: string[],
  enabled: boolean,
) {
  const accountIds = useMemo(
    () =>
      accounts
        .map((account) => account.id)
        .filter((accountId) => enabledAccountIds.includes(accountId)),
    [accounts, enabledAccountIds],
  );

  const initialRepoQueries = useQueries({
    queries: accountIds.map((accountId) => ({
      ...initialReposQueryOptions(accountId),
      enabled,
    })),
  });

  const repos = useMemo(() => {
    const byId = new Map<string, RepoSummary>();
    for (const query of initialRepoQueries) {
      for (const repo of query.data ?? []) {
        byId.set(repoIdentityKey(repo), repo);
      }
    }
    return [...byId.values()];
  }, [initialRepoQueries]);

  return { repos };
}

function useAccountOverviewPullRequests(
  accounts: ProviderAccount[],
  enabledAccountIds: string[],
  enabled: boolean,
) {
  const accountIds = useMemo(
    () =>
      accounts
        .map((account) => account.id)
        .filter((accountId) => enabledAccountIds.includes(accountId)),
    [accounts, enabledAccountIds],
  );

  const overviewQueries = useQueries({
    queries: accountIds.map((accountId) => ({
      ...pullRequestOverviewQueryOptions(accountId),
      enabled,
    })),
  });

  const pullRequests = useMemo(() => {
    const entries: OverviewPullRequestSummary[] = [];
    for (const query of overviewQueries) {
      entries.push(...(query.data ?? []));
    }
    return entries;
  }, [overviewQueries]);

  const errors = useMemo(() => {
    const entries: string[] = [];
    for (let i = 0; i < accountIds.length; i += 1) {
      const error = overviewQueries[i]?.error;
      if (!error) continue;
      entries.push(getErrorMessage(error));
    }
    return entries;
  }, [accountIds, overviewQueries]);

  return {
    accountIds,
    errors,
    isLoading: enabled && overviewQueries.some((query) => query.isPending),
    pullRequests,
  };
}

function dedupeOverviewPullRequestEntries(entries: OverviewPullRequestSummary[]) {
  const byKey = new Map<string, OverviewPullRequestSummary>();

  for (const entry of entries) {
    const key = `${repoIdentityKey(entry.repo)}#${entry.pullRequest.number}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      continue;
    }

    if (
      Date.parse(entry.pullRequest.updatedAt || '') >
      Date.parse(existing.pullRequest.updatedAt || '')
    ) {
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()].sort(
    (left, right) =>
      Date.parse(right.pullRequest.updatedAt || '') - Date.parse(left.pullRequest.updatedAt || ''),
  );
}

function usePullRequestSearchForAccounts(args: {
  accounts: ProviderAccount[];
  enabledAccountIds: string[];
  query: string;
  states: PullRequestSearchState;
  enabled?: boolean;
  limit?: number;
}) {
  const { accounts, enabledAccountIds, query, states, enabled = true, limit = 10 } = args;
  const parsedPullRequestUrl = useMemo<ParsedPullRequestUrl | null>(() => {
    const parsedUrl = parseForgeResourceUrl(query.trim());
    if (!parsedUrl || parsedUrl.number === null) {
      return null;
    }

    return parsedUrl as ParsedPullRequestUrl;
  }, [query]);
  const accountIds = useMemo(
    () =>
      accounts.flatMap((account) => {
        if (!enabledAccountIds.includes(account.id)) {
          return [];
        }

        if (
          parsedPullRequestUrl &&
          (account.provider !== parsedPullRequestUrl.provider ||
            normalizeHostInput(account.host) !== parsedPullRequestUrl.host)
        ) {
          return [];
        }

        return [account.id];
      }),
    [accounts, enabledAccountIds, parsedPullRequestUrl],
  );

  const searchQueries = useQueries({
    queries: accountIds.map((accountId) => {
      if (parsedPullRequestUrl) {
        return {
          queryKey: forgeKeys.pullRequestSearch(accountId, query, states, limit),
          queryFn: async () => {
            const repo = await trpc.repos.tryValidate.query({
              accountId,
              repo: parsedPullRequestUrl.repoPath,
            });
            if (!repo) {
              return [];
            }

            const pullRequest = await trpc.pullRequests.get.query({
              ...repoIdentity(repo),
              number: parsedPullRequestUrl.number,
            });

            if (!matchesPullRequestSearchState(pullRequest, states)) {
              return [];
            }

            return [{ repo, pullRequest }] satisfies OverviewPullRequestSummary[];
          },
          enabled,
          placeholderData: (previousData: OverviewPullRequestSummary[] | undefined) => previousData,
          staleTime: 0,
          retry: false,
        };
      }

      return {
        ...pullRequestSearchQueryOptions(accountId, query, states, limit),
        enabled,
        placeholderData: (previousData: OverviewPullRequestSummary[] | undefined) => previousData,
      };
    }),
  });

  const pullRequests = useMemo(() => {
    const entries: OverviewPullRequestSummary[] = [];
    for (const queryResult of searchQueries) {
      entries.push(...(queryResult.data ?? []));
    }
    return dedupeOverviewPullRequestEntries(entries);
  }, [searchQueries]);

  const errors = useMemo(() => {
    const entries: string[] = [];
    for (const queryResult of searchQueries) {
      if (!queryResult.error) {
        continue;
      }
      entries.push(getErrorMessage(queryResult.error));
    }
    return entries;
  }, [searchQueries]);

  const pendingCount = useMemo(
    () =>
      searchQueries.filter((queryResult) => queryResult.isPending || queryResult.isFetching).length,
    [searchQueries],
  );
  const completedCount = useMemo(
    () => searchQueries.filter((queryResult) => queryResult.data !== undefined).length,
    [searchQueries],
  );
  return {
    accountIds,
    completedCount,
    errors,
    isLoading: enabled && pendingCount > 0,
    pendingCount,
    pullRequests,
  };
}

type UseRepoPullRequestsArgs = {
  repos: RepoSummary[];
};

type UseOverviewPullRequestsArgs = {
  repos: RepoSummary[];
  enabled: boolean;
};

function useOverviewPullRequests({ repos, enabled }: UseOverviewPullRequestsArgs) {
  const repoNames = useMemo(() => repos.map((repo) => repoIdentityKey(repo)), [repos]);
  const repoIdentities = useMemo(() => repos.map((repo) => repoIdentity(repo)), [repos]);

  const cachedPullRequestQueries = useQueries({
    queries: repoIdentities.map((repo) => ({
      ...pullRequestCachedListQueryOptions(repo),
      enabled,
    })),
  });
  const livePullRequestQueries = useQueries({
    queries: repoIdentities.map((repo) => ({
      ...pullRequestListQueryOptions(repo),
      enabled,
    })),
  });

  const prsByRepo = useMemo(() => {
    const entries: Array<[string, PullRequestSummary[]]> = [];
    for (let i = 0; i < repoNames.length; i += 1) {
      const repo = repoNames[i];
      const livePullRequests = livePullRequestQueries[i]?.data;
      const cachedPullRequests = cachedPullRequestQueries[i]?.data;
      const pullRequests = livePullRequests ?? cachedPullRequests;
      if (!pullRequests) continue;
      entries.push([repo, pullRequests]);
    }
    return Object.fromEntries(entries);
  }, [cachedPullRequestQueries, livePullRequestQueries, repoNames]);

  const repoErrors = useMemo(() => {
    const entries: Array<[string, string]> = [];
    for (let i = 0; i < repoNames.length; i += 1) {
      const repo = repoNames[i];
      const hasDisplayData = Boolean(
        livePullRequestQueries[i]?.data ?? cachedPullRequestQueries[i]?.data,
      );
      const error = livePullRequestQueries[i]?.error;
      if (!error || hasDisplayData) continue;
      entries.push([repo, getErrorMessage(error)]);
    }
    return Object.fromEntries(entries);
  }, [cachedPullRequestQueries, livePullRequestQueries, repoNames]);

  return {
    prsByRepo,
    repoErrors,
  };
}

function useTrackedPullRequests({ repos }: UseRepoPullRequestsArgs) {
  const queryClient = useQueryClient();
  const repoNames = useMemo(() => repos.map((repo) => repoIdentityKey(repo)), [repos]);
  const repoIdentities = useMemo(() => repos.map((repo) => repoIdentity(repo)), [repos]);

  const trackedPullRequestQueries = useQueries({
    queries: repoIdentities.map((repo) => ({
      ...trackedPullRequestListQueryOptions(repo),
      staleTime: Infinity,
    })),
  });

  const prsByRepo = useMemo(() => {
    const entries: Array<[string, PullRequestSummary[]]> = [];
    for (let i = 0; i < repoNames.length; i += 1) {
      const repo = repoNames[i];
      const pullRequests = trackedPullRequestQueries[i]?.data;
      if (!pullRequests) continue;
      entries.push([repo, pullRequests]);
    }
    return Object.fromEntries(entries);
  }, [repoNames, trackedPullRequestQueries]);

  const repoErrors = useMemo(() => {
    const entries: Array<[string, string]> = [];
    for (let i = 0; i < repoNames.length; i += 1) {
      const repo = repoNames[i];
      const error = trackedPullRequestQueries[i]?.error;
      if (!error) continue;
      entries.push([repo, getErrorMessage(error)]);
    }
    return Object.fromEntries(entries);
  }, [repoNames, trackedPullRequestQueries]);

  const refreshTrackedPullRequests = useCallback(
    async (repo: RepoIdentity) => {
      try {
        const pullRequests = await trpc.tracked.refresh.mutate(repo);

        queryClient.setQueryData<PullRequestSummary[]>(
          forgeKeys.trackedPullRequestList(repo),
          pullRequests,
        );

        return pullRequests;
      } catch {
        return (
          queryClient.getQueryData<PullRequestSummary[]>(forgeKeys.trackedPullRequestList(repo)) ??
          []
        );
      }
    },
    [queryClient],
  );

  return {
    prsByRepo,
    repoErrors,
    refreshTrackedPullRequests,
  };
}

function useSelectedPullRequestData(
  selectedPr: SelectedPullRequest | null,
  diffDataMode: DiffDataMode,
) {
  const selectedPatchQuery = useQuery({
    queryKey: selectedPr
      ? [...forgeKeys.pullRequestPatch(selectedPr), diffDataMode]
      : forgeKeys.pullRequestPatchIdle(),
    queryFn: () => {
      if (!selectedPr) {
        throw new Error('No pull request selected');
      }

      return trpc.pullRequests.getPatch.query({
        providerId: selectedPr.providerId,
        repoKey: selectedPr.repoKey,
        number: selectedPr.number,
        headSha: selectedPr.headSha,
      });
    },
    enabled: selectedPr !== null,
    retry: false,
  });

  const changedFilesQuery = useQuery({
    queryKey: selectedPr
      ? [...forgeKeys.pullRequestFiles(selectedPr), diffDataMode]
      : forgeKeys.pullRequestFilesIdle(),
    queryFn: () => {
      if (!selectedPr) {
        throw new Error('No pull request selected');
      }

      return trpc.pullRequests.listChangedFiles.query({
        providerId: selectedPr.providerId,
        repoKey: selectedPr.repoKey,
        number: selectedPr.number,
        headSha: selectedPr.headSha,
      });
    },
    enabled: selectedPr !== null && diffDataMode !== 'git',
    retry: false,
  });

  const reviewThreadsQuery = useQuery({
    queryKey: selectedPr
      ? forgeKeys.pullRequestReviewThreads(selectedPr)
      : forgeKeys.pullRequestReviewThreadsIdle(),
    queryFn: () => {
      if (!selectedPr) {
        throw new Error('No pull request selected');
      }

      return trpc.reviewComments.listThreads.query({
        providerId: selectedPr.providerId,
        repoKey: selectedPr.repoKey,
        number: selectedPr.number,
        headSha: selectedPr.headSha,
      });
    },
    enabled: selectedPr !== null,
  });

  const pendingReviewQuery = useQuery({
    queryKey: selectedPr
      ? forgeKeys.pullRequestPendingReview(selectedPr)
      : forgeKeys.pullRequestPendingReviewIdle(),
    queryFn: () => {
      if (!selectedPr) {
        throw new Error('No pull request selected');
      }

      return trpc.reviewComments.listPending.query({
        providerId: selectedPr.providerId,
        repoKey: selectedPr.repoKey,
        number: selectedPr.number,
        headSha: selectedPr.headSha,
      });
    },
    enabled: selectedPr !== null,
  });

  const qualityReportQuery = useQuery({
    queryKey: selectedPr
      ? forgeKeys.pullRequestQualityReport(selectedPr)
      : forgeKeys.pullRequestQualityReportIdle(),
    queryFn: () => {
      if (!selectedPr) {
        throw new Error('No pull request selected');
      }

      return trpc.pullRequests.getQualityReport.query({
        providerId: selectedPr.providerId,
        repoKey: selectedPr.repoKey,
        number: selectedPr.number,
        headSha: selectedPr.headSha,
      });
    },
    enabled: selectedPr !== null,
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const approvalStateQuery = useQuery({
    queryKey: selectedPr
      ? forgeKeys.pullRequestApprovalState(selectedPr)
      : forgeKeys.pullRequestApprovalStateIdle(),
    queryFn: async () => {
      if (!selectedPr) {
        throw new Error('No pull request selected');
      }

      return trpc.reviewComments.getApprovalState.query({
        providerId: selectedPr.providerId,
        repoKey: selectedPr.repoKey,
        number: selectedPr.number,
        headSha: selectedPr.headSha,
      });
    },
    enabled: selectedPr !== null,
  });

  const selectedPatch = (selectedPatchQuery.data as PrPatch | undefined) ?? null;
  const changedFiles =
    diffDataMode === 'git'
      ? (selectedPatch?.fileDiffs.map((fileDiff) => fileDiff.name) ?? [])
      : ((changedFilesQuery.data as string[] | undefined) ?? []);
  const reviewThreads = (reviewThreadsQuery.data as ReviewThread[] | undefined) ?? [];
  const pendingReview = (pendingReviewQuery.data as PendingReviewState | undefined) ?? {
    session: null,
    comments: [],
  };
  const qualityReport = (qualityReportQuery.data as PullRequestQualityReport | undefined) ?? null;
  const approvalState = (approvalStateQuery.data as PullRequestApprovalState | undefined) ?? null;

  const isPatchLoading =
    selectedPr !== null &&
    (selectedPatchQuery.isPending || (selectedPatchQuery.isFetching && !selectedPatchQuery.data));
  const isChangedFilesLoading =
    selectedPr !== null &&
    (diffDataMode === 'git'
      ? isPatchLoading
      : changedFilesQuery.isPending || (changedFilesQuery.isFetching && !changedFilesQuery.data));
  const isReviewThreadsLoading =
    selectedPr !== null &&
    (reviewThreadsQuery.isPending || (reviewThreadsQuery.isFetching && !reviewThreadsQuery.data));
  const isPendingReviewLoading =
    selectedPr !== null &&
    (pendingReviewQuery.isPending || (pendingReviewQuery.isFetching && !pendingReviewQuery.data));
  const isQualityReportLoading =
    selectedPr !== null &&
    (qualityReportQuery.isPending || (qualityReportQuery.isFetching && !qualityReportQuery.data));
  const isApprovalStateLoading =
    selectedPr !== null &&
    (approvalStateQuery.isPending || (approvalStateQuery.isFetching && !approvalStateQuery.data));

  return {
    approvalState,
    approvalStateError: getErrorMessage(approvalStateQuery.error),
    changedFiles,
    changedFilesError:
      diffDataMode === 'git'
        ? getErrorMessage(selectedPatchQuery.error)
        : getErrorMessage(changedFilesQuery.error),
    isApprovalStateLoading,
    isChangedFilesLoading,
    isPatchLoading,
    isPendingReviewLoading,
    isQualityReportLoading,
    isReviewThreadsLoading,
    patchError: getErrorMessage(selectedPatchQuery.error),
    pendingReview,
    pendingReviewError: getErrorMessage(pendingReviewQuery.error),
    qualityReport,
    qualityReportError: getErrorMessage(qualityReportQuery.error),
    reviewThreads,
    reviewThreadsError: getErrorMessage(reviewThreadsQuery.error),
    selectedPatch,
  };
}

function usePullRequestApprovalMutations(selectedPr: SelectedPullRequest | null) {
  const queryClient = useQueryClient();
  const approvalStateQueryKey = selectedPr ? forgeKeys.pullRequestApprovalState(selectedPr) : null;
  const reviewThreadsQueryKey = selectedPr ? forgeKeys.pullRequestReviewThreads(selectedPr) : null;

  const invalidateApprovalState = useCallback(async () => {
    if (!approvalStateQueryKey) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: approvalStateQueryKey,
    });
  }, [approvalStateQueryKey, queryClient]);

  const invalidateReviewThreads = useCallback(async () => {
    if (!reviewThreadsQueryKey) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: reviewThreadsQueryKey,
    });
  }, [queryClient, reviewThreadsQueryKey]);

  const approveMutation = useMutation({
    mutationFn: (input: SelectedPullRequest) => approvePullRequest(input),
    onSuccess: invalidateApprovalState,
  });

  const removeApprovalMutation = useMutation({
    mutationFn: (input: SelectedPullRequest) => removePullRequestApproval(input),
    onSuccess: async () => {
      await invalidateApprovalState();
      await invalidateReviewThreads();
    },
  });

  return {
    approveMutation,
    removeApprovalMutation,
  };
}

function usePullRequestReviewCommentMutations(selectedPr: SelectedPullRequest | null) {
  const queryClient = useQueryClient();
  const viewerAccountId = selectedPr ? providerAccountIdFromProviderId(selectedPr.providerId) : '';
  const viewerLoginQuery = useQuery({
    ...viewerLoginQueryOptions(viewerAccountId),
    enabled: selectedPr !== null,
  });

  const reviewThreadsQueryKey = selectedPr ? forgeKeys.pullRequestReviewThreads(selectedPr) : null;
  const pendingReviewQueryKey = selectedPr ? forgeKeys.pullRequestPendingReview(selectedPr) : null;
  const approvalStateQueryKey = selectedPr ? forgeKeys.pullRequestApprovalState(selectedPr) : null;

  const invalidateReviewThreads = useCallback(async () => {
    if (!reviewThreadsQueryKey) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: reviewThreadsQueryKey,
    });
  }, [queryClient, reviewThreadsQueryKey]);

  const invalidatePendingReview = useCallback(async () => {
    if (!pendingReviewQueryKey) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: pendingReviewQueryKey,
    });
  }, [pendingReviewQueryKey, queryClient]);

  const invalidateReviewData = useCallback(async () => {
    await invalidateReviewThreads();
    await invalidatePendingReview();
  }, [invalidatePendingReview, invalidateReviewThreads]);

  const invalidateApprovalState = useCallback(async () => {
    if (!approvalStateQueryKey) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: approvalStateQueryKey,
    });
  }, [approvalStateQueryKey, queryClient]);

  const createCommentMutation = useMutation({
    mutationFn: (input: CreatePullRequestReviewCommentInput) =>
      createPullRequestReviewComment(input),
    onSettled: invalidateReviewThreads,
  });
  const createPendingThreadMutation = useMutation({
    mutationFn: (input: CreatePendingReviewThreadInput) => createPendingReviewThread(input),
    onSettled: invalidateReviewData,
  });
  const createPendingReplyMutation = useMutation({
    mutationFn: (input: CreatePendingReviewReplyInput) => createPendingReviewReply(input),
    onSettled: invalidateReviewData,
  });
  const createPendingGlobalMutation = useMutation({
    mutationFn: (input: CreatePendingReviewGlobalInput) => createPendingReviewGlobal(input),
    onSettled: invalidateReviewData,
  });
  const replyCommentMutation = useMutation({
    mutationFn: (input: ReplyToPullRequestReviewCommentInput) =>
      replyToPullRequestReviewComment(input),
    onSettled: invalidateReviewThreads,
  });
  const updateCommentMutation = useMutation({
    mutationFn: (input: UpdatePullRequestReviewCommentInput) =>
      updatePullRequestReviewComment(input),
    onSettled: invalidateReviewThreads,
  });
  const setResolvedMutation = useMutation({
    mutationFn: (input: SetPullRequestReviewThreadResolvedInput) =>
      setPullRequestReviewThreadResolved(input),
    onSettled: invalidateReviewThreads,
  });
  const deleteCommentMutation = useMutation({
    mutationFn: (input: DeletePullRequestReviewCommentInput) =>
      deletePullRequestReviewComment(input),
    onSettled: invalidateReviewThreads,
  });
  const updatePendingCommentMutation = useMutation({
    mutationFn: (input: UpdatePendingReviewCommentInput) => updatePendingReviewComment(input),
    onSettled: invalidateReviewData,
  });
  const deletePendingCommentMutation = useMutation({
    mutationFn: (input: DeletePendingReviewCommentInput) => deletePendingReviewComment(input),
    onSettled: invalidateReviewData,
  });
  const publishPendingReviewMutation = useMutation({
    mutationFn: (input: PublishPendingReviewInput) => publishPendingReview(input),
    onSettled: async (_data, _error, input) => {
      await invalidateReviewData();
      if (input.action === 'approve' || input.action === 'request_changes') {
        await invalidateApprovalState();
      }
    },
  });
  const discardPendingReviewMutation = useMutation({
    mutationFn: (input: DiscardPendingReviewInput) => discardPendingReview(input),
    onSettled: invalidateReviewData,
  });

  return {
    createCommentMutation,
    createPendingGlobalMutation,
    createPendingReplyMutation,
    createPendingThreadMutation,
    deleteCommentMutation,
    deletePendingCommentMutation,
    discardPendingReviewMutation,
    publishPendingReviewMutation,
    replyCommentMutation,
    setResolvedMutation,
    updatePendingCommentMutation,
    updateCommentMutation,
    viewerLogin: viewerLoginQuery.data?.login ?? null,
  };
}

export {
  getErrorMessage,
  dedupeOverviewPullRequestEntries,
  useAccountOverviewPullRequests,
  useBrowseSearch,
  useInitialReposForAccounts,
  usePullRequestApprovalMutations,
  usePullRequestSearchForAccounts,
  useOverviewPullRequests,
  usePullRequestReviewCommentMutations,
  useRepoPickerReposForAccounts,
  useRepoPickerRepos,
  useSavedRepos,
  useSelectedPullRequestData,
  useTrackedPullRequests,
};
