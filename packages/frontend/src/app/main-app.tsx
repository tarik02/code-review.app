import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useWorkerPool } from '@pierre/diffs/react';
import type { GitStatusEntry } from '@pierre/trees';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { RepoSidebar, type SidebarPullRequestView } from '../components/ui/repo-sidebar';
import { HomeCommandPalettes } from '../command-palette/CommandPalette';
import { PatchViewerMain } from '../components/ui/patch-viewer-main';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/ui/resizable';
import {
  getErrorMessage,
  useDataSourcePullRequests,
  useSavedRepos,
  useSelectedPullRequestData,
  useTrackedPullRequests,
} from '../hooks/use-forge-queries';
import { useCodeAppearance } from '../hooks/use-code-appearance';
import { useTheme } from '../hooks/use-theme';
import { useAuthSession } from './auth-session';
import { sortByFileTreePathOrder } from '../lib/file-tree-order';
import { normalizeHostInput, parseAppOpenUrl, parseForgeResourceUrl } from '../lib/forge-links';
import { buildReviewThreadsByFile, getGlobalReviewThreads } from '../lib/review-threads';
import { buildPullRequestQualityView } from '../lib/pull-request-quality';
import {
  mergeTrackedVisibleSubsetIntoOrder,
  prependTrackedPullRequestOrderEntry,
  removeTrackedPullRequestOrderEntry,
  sortTrackedPullRequestEntries,
  toTrackedPullRequestOrderEntry,
} from '../lib/tracked-pull-request-order';
import { repoIdentity, repoIdentityKey, sameRepoIdentity } from '../lib/repo-identity';
import { trpc } from '../lib/trpc';
import { useMainAppViewStore } from '../stores/main-app-view-store';
import {
  accountVisibilityQueryOptions,
  dataSourcesSettingsQueryOptions,
  diffDataSettingsQueryOptions,
  forgeKeys,
  pullRequestRecentListQueryOptions,
  savedReposQueryOptions,
  setDataSourcesSettings,
  setTrackedPullRequestOrder,
  trackedReposQueryOptions,
  trackedPullRequestOrderQueryOptions,
} from '../queries/forge';
import type {
  DiffDataMode,
  FileStatsEntry,
  OverviewPullRequestSummary,
  PullRequestDataSourcesSettings,
  PullRequestSummary,
  RepoIdentity,
  RepoSummary,
  SelectedPullRequest,
  TrackedPullRequestOrderEntry,
} from '../types/forge';

const REPO_SIDEBAR_DEFAULT_SIZE = '360px';
const REPO_SIDEBAR_MIN_SIZE = '300px';
const REPO_SIDEBAR_MAX_SIZE = '620px';

function isSamePullRequestEntry(
  left: OverviewPullRequestSummary,
  right: OverviewPullRequestSummary,
) {
  return (
    sameRepoIdentity(left.repo, right.repo) && left.pullRequest.number === right.pullRequest.number
  );
}

function MainApp() {
  const { providerAccounts, providerStatuses } = useAuthSession();
  const activeRouteSearch = useSearch({ from: '/' });
  const navigate = useNavigate({ from: '/' });
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const { diffTheme } = useCodeAppearance();
  const workerPool = useWorkerPool();
  const repoSidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const [isRepoSidebarCollapsed, setIsRepoSidebarCollapsed] = useState(false);
  const activeRepoIdentity = useMemo<RepoIdentity | null>(
    () =>
      activeRouteSearch.providerId && activeRouteSearch.repoKey
        ? {
            providerId: activeRouteSearch.providerId,
            repoKey: activeRouteSearch.repoKey,
          }
        : null,
    [activeRouteSearch.providerId, activeRouteSearch.repoKey],
  );
  const activeRepoLookupKey = activeRepoIdentity ? repoIdentityKey(activeRepoIdentity) : null;
  const activePullRequestNumber = activeRouteSearch.pr ?? null;
  const profileFilterAccountId = useMainAppViewStore((state) => state.profileFilterAccountId);
  const repoFilterKey = useMainAppViewStore((state) => state.repoFilterKey);
  const clearProfileFilter = useMainAppViewStore((state) => state.clearProfileFilter);
  const clearRepoFilter = useMainAppViewStore((state) => state.clearRepoFilter);

  const [deepLinkMessage, setDeepLinkMessage] = useState<string | null>(null);
  const [sidebarView, setSidebarView] = useState<SidebarPullRequestView>('data-source');
  const refreshedReposRef = useRef<Set<string>>(new Set());
  const lastRememberedPrKeyRef = useRef<string | null>(null);

  const { repos: savedRepos = [] } = useSavedRepos();
  const trackedReposQuery = useQuery(trackedReposQueryOptions());
  const trackedRepos = useMemo(() => trackedReposQuery.data ?? [], [trackedReposQuery.data]);
  const accountVisibilityQuery = useQuery(accountVisibilityQueryOptions());
  const readyProviderAccounts = useMemo(
    () => providerAccounts.filter((account) => providerStatuses[account.id]?.status === 'ready'),
    [providerAccounts, providerStatuses],
  );
  const readyAccountIds = useMemo(
    () => new Set(readyProviderAccounts.map((account) => account.id)),
    [readyProviderAccounts],
  );
  const knownAccountIds = useMemo(
    () => new Set(providerAccounts.map((account) => account.id)),
    [providerAccounts],
  );
  const persistedEnabledAccountIds = useMemo(() => {
    if (!accountVisibilityQuery.data) {
      return providerAccounts.map((account) => account.id);
    }

    return accountVisibilityQuery.data.enabledAccountIds.filter((accountId) =>
      knownAccountIds.has(accountId),
    );
  }, [accountVisibilityQuery.data, knownAccountIds, providerAccounts]);
  const enabledAccountIds = useMemo(
    () => persistedEnabledAccountIds.filter((accountId) => readyAccountIds.has(accountId)),
    [persistedEnabledAccountIds, readyAccountIds],
  );
  const enabledAccountIdSet = useMemo(() => new Set(enabledAccountIds), [enabledAccountIds]);
  const refreshableTrackedRepos = useMemo(
    () => trackedRepos.filter((repo) => readyAccountIds.has(repo.providerAccountId)),
    [readyAccountIds, trackedRepos],
  );
  const dataSourcesQuery = useQuery(dataSourcesSettingsQueryOptions());
  const dataSourcesSettings: PullRequestDataSourcesSettings = dataSourcesQuery.data ?? {
    activeDataSourceId: null,
    sources: [],
  };
  const activeDataSource =
    dataSourcesSettings.sources.find(
      (source) => source.id === dataSourcesSettings.activeDataSourceId,
    ) ?? null;
  const {
    error: dataSourceError,
    isLoading: isDataSourceLoading,
    pullRequests: dataSourcePullRequests,
  } = useDataSourcePullRequests(activeDataSource, sidebarView === 'data-source');
  const recentPullRequestsQuery = useQuery(pullRequestRecentListQueryOptions());
  const dataSourceStatusMessage = useMemo(() => {
    if (sidebarView !== 'data-source') return null;
    if (readyProviderAccounts.length === 0) return 'No ready provider accounts.';
    if (!activeDataSource) return 'Create a data source to load PRs or MRs.';
    return null;
  }, [activeDataSource, readyProviderAccounts.length, sidebarView]);
  const {
    prsByRepo: trackedPrsByRepo,
    repoErrors: trackedRepoErrors,
    refreshTrackedPullRequests,
  } = useTrackedPullRequests({ repos: refreshableTrackedRepos });
  const trackedPullRequestOrderQuery = useQuery(trackedPullRequestOrderQueryOptions());
  const activeDataSourceEntry = useMemo(() => {
    if (!activeRepoIdentity || activePullRequestNumber === null) {
      return null;
    }

    return (
      dataSourcePullRequests.find(
        (entry) =>
          sameRepoIdentity(entry.repo, activeRepoIdentity) &&
          entry.pullRequest.number === activePullRequestNumber,
      ) ?? null
    );
  }, [activePullRequestNumber, activeRepoIdentity, dataSourcePullRequests]);
  const activeTrackedPullRequest = useMemo(() => {
    if (!activeRepoLookupKey || activePullRequestNumber === null) {
      return null;
    }

    return (
      (trackedPrsByRepo[activeRepoLookupKey] ?? []).find(
        (pullRequest) => pullRequest.number === activePullRequestNumber,
      ) ?? null
    );
  }, [activePullRequestNumber, activeRepoLookupKey, trackedPrsByRepo]);
  const activeRecentEntry = useMemo(() => {
    if (!activeRepoIdentity || activePullRequestNumber === null) {
      return null;
    }

    return (
      (recentPullRequestsQuery.data ?? []).find(
        (entry) =>
          sameRepoIdentity(entry.repo, activeRepoIdentity) &&
          entry.pullRequest.number === activePullRequestNumber,
      ) ?? null
    );
  }, [activePullRequestNumber, activeRepoIdentity, recentPullRequestsQuery.data]);
  const activeFallbackPullRequestQuery = useQuery({
    queryKey:
      activeRepoIdentity && activePullRequestNumber !== null
        ? [
            ...forgeKeys.pullRequests(),
            'selected-fallback',
            activeRepoIdentity.providerId,
            activeRepoIdentity.repoKey,
            activePullRequestNumber,
          ]
        : [...forgeKeys.pullRequests(), 'selected-fallback', 'idle'],
    queryFn: () => {
      if (!activeRepoIdentity || activePullRequestNumber === null) {
        throw new Error('No pull request selected');
      }

      return trpc.pullRequests.tryGet.query({
        ...activeRepoIdentity,
        number: activePullRequestNumber,
      });
    },
    enabled: activeRepoIdentity !== null && activePullRequestNumber !== null,
    staleTime: 0,
  });
  const activeFallbackPullRequest = activeFallbackPullRequestQuery.data ?? null;
  const selectedPr = useMemo<SelectedPullRequest | null>(() => {
    if (!activeRepoIdentity || activePullRequestNumber === null) {
      return null;
    }

    const dataSourcePullRequest = activeDataSourceEntry?.pullRequest ?? null;
    const recentPullRequest = activeRecentEntry?.pullRequest ?? null;
    const pullRequest =
      activeTrackedPullRequest ??
      dataSourcePullRequest ??
      recentPullRequest ??
      activeFallbackPullRequest;
    if (!pullRequest) {
      return null;
    }

    return {
      ...activeRepoIdentity,
      number: activePullRequestNumber,
      headSha: pullRequest.headSha,
      baseSha: pullRequest.baseSha ?? dataSourcePullRequest?.baseSha ?? null,
    };
  }, [
    activeFallbackPullRequest,
    activeDataSourceEntry,
    activePullRequestNumber,
    activeRecentEntry,
    activeRepoIdentity,
    activeTrackedPullRequest,
  ]);
  const selectedRepo = activeRepoIdentity
    ? (savedRepos.find((repo) => sameRepoIdentity(repo, activeRepoIdentity)) ??
      trackedRepos.find((repo) => sameRepoIdentity(repo, activeRepoIdentity)) ??
      activeRecentEntry?.repo ??
      activeDataSourceEntry?.repo ??
      null)
    : null;
  const isSelectedRepoHidden =
    Boolean(selectedPr && selectedRepo) &&
    !enabledAccountIdSet.has(selectedRepo?.providerAccountId ?? '');
  const sidebarRepos = useMemo(() => {
    const visibleSavedRepos = savedRepos.filter((repo) =>
      enabledAccountIdSet.has(repo.providerAccountId),
    );
    const visibleRepos = visibleSavedRepos;

    if (!selectedRepo || !isSelectedRepoHidden) {
      return visibleRepos;
    }
    if (visibleRepos.some((repo) => sameRepoIdentity(repo, selectedRepo))) {
      return visibleRepos;
    }
    return [...visibleRepos, selectedRepo];
  }, [enabledAccountIdSet, isSelectedRepoHidden, savedRepos, selectedRepo]);
  const trackedSidebarRepos = useMemo(() => {
    const visibleTrackedRepos = trackedRepos.filter((repo) =>
      enabledAccountIdSet.has(repo.providerAccountId),
    );

    if (!selectedRepo || !isSelectedRepoHidden || !activeTrackedPullRequest) {
      return visibleTrackedRepos;
    }
    if (visibleTrackedRepos.some((repo) => sameRepoIdentity(repo, selectedRepo))) {
      return visibleTrackedRepos;
    }
    return [...visibleTrackedRepos, selectedRepo];
  }, [
    activeTrackedPullRequest,
    enabledAccountIdSet,
    isSelectedRepoHidden,
    selectedRepo,
    trackedRepos,
  ]);
  const trackedPullRequestNumbersByRepo = useMemo(() => {
    const entries: Array<[string, Set<number>]> = [];
    for (const [lookupKey, pullRequests] of Object.entries(trackedPrsByRepo)) {
      entries.push([lookupKey, new Set(pullRequests.map((pullRequest) => pullRequest.number))]);
    }
    return Object.fromEntries(entries);
  }, [trackedPrsByRepo]);
  const trackedPullRequestEntries = useMemo(() => {
    const entries: OverviewPullRequestSummary[] = [];
    for (const repo of trackedSidebarRepos) {
      const lookupKey = repoIdentityKey(repo);
      const pullRequests = trackedPrsByRepo[lookupKey] ?? [];
      for (const pullRequest of pullRequests) {
        entries.push({ repo, pullRequest });
      }
    }

    return sortTrackedPullRequestEntries(entries, trackedPullRequestOrderQuery.data ?? []);
  }, [trackedSidebarRepos, trackedPrsByRepo, trackedPullRequestOrderQuery.data]);
  const matchesSidebarFilters = useCallback(
    (repo: RepoSummary | RepoIdentity) =>
      (!profileFilterAccountId ||
        ('providerAccountId' in repo && repo.providerAccountId === profileFilterAccountId)) &&
      (!repoFilterKey || repo.repoKey === repoFilterKey),
    [profileFilterAccountId, repoFilterKey],
  );
  const filteredDataSourcePullRequests = useMemo(() => {
    return dataSourcePullRequests;
  }, [dataSourcePullRequests]);
  const filteredTrackedPullRequestEntries = useMemo(() => {
    return trackedPullRequestEntries.filter((entry) => matchesSidebarFilters(entry.repo));
  }, [matchesSidebarFilters, trackedPullRequestEntries]);
  const filteredRecentPullRequests = useMemo(() => {
    return (recentPullRequestsQuery.data ?? []).filter((entry) =>
      matchesSidebarFilters(entry.repo),
    );
  }, [matchesSidebarFilters, recentPullRequestsQuery.data]);
  const commandPaletteLocalPullRequests = useMemo(
    () => [
      ...trackedPullRequestEntries,
      ...(recentPullRequestsQuery.data ?? []),
      ...dataSourcePullRequests,
    ],
    [dataSourcePullRequests, recentPullRequestsQuery.data, trackedPullRequestEntries],
  );
  const selectedPullRequestSummary = useMemo(() => {
    if (!selectedPr) {
      return null;
    }

    const localPullRequest =
      commandPaletteLocalPullRequests.find(
        (entry) =>
          sameRepoIdentity(entry.repo, selectedPr) &&
          entry.pullRequest.number === selectedPr.number,
      )?.pullRequest ?? null;

    return localPullRequest && activeFallbackPullRequest
      ? { ...localPullRequest, ...activeFallbackPullRequest }
      : (localPullRequest ?? activeFallbackPullRequest ?? null);
  }, [activeFallbackPullRequest, commandPaletteLocalPullRequests, selectedPr]);
  const activePinnedSidebarEntry = useMemo(() => {
    if (
      !selectedRepo ||
      !selectedPullRequestSummary ||
      selectedPullRequestSummary.state !== 'OPEN'
    ) {
      return null;
    }

    const entry = { repo: selectedRepo, pullRequest: selectedPullRequestSummary };
    const currentEntries =
      sidebarView === 'data-source'
        ? filteredDataSourcePullRequests
        : sidebarView === 'recent'
          ? filteredRecentPullRequests
          : filteredTrackedPullRequestEntries;

    return currentEntries.some((candidate) => isSamePullRequestEntry(candidate, entry))
      ? null
      : entry;
  }, [
    filteredDataSourcePullRequests,
    filteredRecentPullRequests,
    filteredTrackedPullRequestEntries,
    selectedPullRequestSummary,
    selectedRepo,
    sidebarView,
  ]);

  const selectedPrKey = selectedPr
    ? `${repoIdentityKey(selectedPr)}#${selectedPr.number}@${selectedPr.headSha}`
    : null;
  const diffDataSettingsQuery = useQuery(diffDataSettingsQueryOptions());
  const diffDataMode: DiffDataMode = diffDataSettingsQuery.data?.mode ?? 'provider-api';
  const patchViewerSessionKey = selectedPrKey
    ? `${selectedPrKey}:${diffDataMode === 'git' ? 'git' : 'provider'}`
    : null;
  const {
    approvalState,
    approvalStateError,
    changedFiles,
    changedFilesError,
    isApprovalStateLoading,
    isChangedFilesLoading,
    isPatchLoading,
    isPendingReviewLoading,
    isQualityReportLoading,
    isReviewThreadsLoading,
    patchError,
    pendingReview,
    pendingReviewError,
    qualityReport,
    qualityReportError,
    reviewThreads,
    reviewThreadsError,
    selectedPatch,
  } = useSelectedPullRequestData(selectedPr, diffDataMode);
  const reviewThreadsByFile = useMemo(
    () => buildReviewThreadsByFile(reviewThreads),
    [reviewThreads],
  );
  const globalReviewThreads = useMemo(() => getGlobalReviewThreads(reviewThreads), [reviewThreads]);
  const qualityView = useMemo(
    () => buildPullRequestQualityView(qualityReport, selectedPatch?.fileDiffs ?? []),
    [qualityReport, selectedPatch?.fileDiffs],
  );
  const parsedPatch = useMemo(
    () => ({
      fileDiffs: selectedPatch
        ? sortByFileTreePathOrder(selectedPatch.fileDiffs, (fd) => fd.name)
        : [],
      parseError: '',
    }),
    [selectedPatch],
  );

  useEffect(() => {
    if (!workerPool) return;

    void workerPool.setRenderOptions({
      theme: isDark ? diffTheme.dark : diffTheme.light,
    });
  }, [diffTheme.dark, diffTheme.light, isDark, workerPool]);

  useEffect(() => {
    for (const repo of refreshableTrackedRepos) {
      const lookupKey = repoIdentityKey(repo);
      if (refreshedReposRef.current.has(lookupKey)) {
        continue;
      }

      refreshedReposRef.current.add(lookupKey);
      void refreshTrackedPullRequests(repo);
    }
  }, [refreshTrackedPullRequests, refreshableTrackedRepos]);

  const isPatchPreparing = isPatchLoading;

  const fileStats = useMemo(() => {
    if (parsedPatch.fileDiffs.length === 0) return null;
    const map = new Map<string, FileStatsEntry>();
    for (const fd of parsedPatch.fileDiffs) {
      const status: GitStatusEntry['status'] =
        fd.type === 'new' ? 'added' : fd.type === 'deleted' ? 'deleted' : 'modified';
      map.set(fd.name, {
        additions: fd.additionLines.length,
        deletions: fd.deletionLines.length,
        status,
      });
    }
    return map;
  }, [parsedPatch.fileDiffs]);

  const gitStatus = useMemo(() => {
    if (!fileStats) return undefined;
    const entries: GitStatusEntry[] = [];
    for (const [path, entry] of fileStats) {
      entries.push({ path, status: entry.status });
    }
    return entries;
  }, [fileStats]);

  const setActivePullRequest = useCallback(
    (repo: RepoIdentity, pullRequest: PullRequestSummary) => {
      void navigate({
        to: '/',
        search: {
          providerId: repo.providerId,
          repoKey: repo.repoKey,
          pr: pullRequest.number,
        },
      });
    },
    [navigate],
  );

  const clearActivePullRequest = useCallback(() => {
    void navigate({
      to: '/',
      search: {},
    });
  }, [navigate]);

  function handleSelectPr(repo: RepoIdentity, pullRequest: PullRequestSummary) {
    setActivePullRequest(repo, pullRequest);

    if (sidebarView !== 'tracked') {
      return;
    }

    const lookupKey = repoIdentityKey(repo);
    if (!refreshedReposRef.current.has(lookupKey)) {
      refreshedReposRef.current.add(lookupKey);
    }
    void refreshTrackedPullRequests(repo);
  }

  const cacheSavedRepo = useCallback(
    (savedRepo: RepoSummary) => {
      queryClient.setQueryData<RepoSummary[]>(savedReposQueryOptions().queryKey, (current) => {
        if (!current) return [savedRepo];
        if (current.some((item) => sameRepoIdentity(item, savedRepo))) {
          return current;
        }
        return [...current, savedRepo];
      });
    },
    [queryClient],
  );

  const cacheTrackedRepo = useCallback(
    (trackedRepo: RepoSummary) => {
      queryClient.setQueryData<RepoSummary[]>(forgeKeys.trackedRepos(), (current) => {
        if (!current) return [trackedRepo];
        if (current.some((item) => sameRepoIdentity(item, trackedRepo))) {
          return current;
        }
        return [...current, trackedRepo];
      });
    },
    [queryClient],
  );

  const removeTrackedRepo = useCallback(
    (repo: RepoIdentity) => {
      queryClient.setQueryData<RepoSummary[]>(forgeKeys.trackedRepos(), (current) =>
        (current ?? []).filter((item) => !sameRepoIdentity(item, repo)),
      );
    },
    [queryClient],
  );

  const cacheTrackedPullRequest = useCallback(
    (repo: RepoIdentity, trackedPullRequest: PullRequestSummary) => {
      queryClient.setQueryData<PullRequestSummary[]>(
        forgeKeys.trackedPullRequestList(repo),
        (current) => {
          const list = current ?? [];
          const withoutCurrent = list.filter((item) => item.number !== trackedPullRequest.number);
          return [trackedPullRequest, ...withoutCurrent];
        },
      );
    },
    [queryClient],
  );

  const promoteRecentPullRequest = useCallback(
    (repo: RepoSummary, pullRequest: PullRequestSummary) => {
      queryClient.setQueryData<OverviewPullRequestSummary[]>(
        forgeKeys.pullRequestRecentList(),
        (current) => {
          const entry = { repo, pullRequest };
          const next = current ?? [];
          return [entry, ...next.filter((candidate) => !isSamePullRequestEntry(candidate, entry))];
        },
      );
    },
    [queryClient],
  );

  const rememberPullRequest = useCallback(
    async (repo: RepoSummary, pullRequest: PullRequestSummary) => {
      promoteRecentPullRequest(repo, pullRequest);
      await trpc.pullRequests.remember.mutate({
        ...repoIdentity(repo),
        pullRequest,
      });
    },
    [promoteRecentPullRequest],
  );

  useEffect(() => {
    if (!selectedPr || !selectedPullRequestSummary || selectedPullRequestSummary.state !== 'OPEN') {
      lastRememberedPrKeyRef.current = null;
      return;
    }

    const repo =
      selectedRepo ??
      recentPullRequestsQuery.data?.find((entry) => sameRepoIdentity(entry.repo, selectedPr))
        ?.repo ??
      dataSourcePullRequests.find((entry) => sameRepoIdentity(entry.repo, selectedPr))?.repo ??
      trackedRepos.find((entry) => sameRepoIdentity(entry, selectedPr)) ??
      null;
    if (!repo) {
      return;
    }

    const rememberKey = `${repoIdentityKey(selectedPr)}#${selectedPullRequestSummary.number}@${selectedPullRequestSummary.headSha}`;
    if (lastRememberedPrKeyRef.current === rememberKey) {
      return;
    }

    lastRememberedPrKeyRef.current = rememberKey;
    void rememberPullRequest(repo, selectedPullRequestSummary);
  }, [
    dataSourcePullRequests,
    recentPullRequestsQuery.data,
    rememberPullRequest,
    selectedPr,
    selectedPullRequestSummary,
    selectedRepo,
    trackedRepos,
  ]);

  const getTrackedPullRequestOrder = useCallback(async () => {
    const cachedOrder = queryClient.getQueryData<TrackedPullRequestOrderEntry[]>(
      forgeKeys.trackedPullRequestOrder(),
    );
    if (cachedOrder !== undefined) {
      return cachedOrder;
    }

    const loadedOrder = await trpc.tracked.getOrder.query();
    queryClient.setQueryData(forgeKeys.trackedPullRequestOrder(), loadedOrder);
    return loadedOrder;
  }, [queryClient]);

  const persistTrackedPullRequestOrder = useCallback(
    async (nextOrder: TrackedPullRequestOrderEntry[]) => {
      const previousOrder =
        queryClient.getQueryData<TrackedPullRequestOrderEntry[]>(
          forgeKeys.trackedPullRequestOrder(),
        ) ?? [];

      queryClient.setQueryData(forgeKeys.trackedPullRequestOrder(), nextOrder);

      try {
        const persisted = await setTrackedPullRequestOrder(nextOrder);
        queryClient.setQueryData(forgeKeys.trackedPullRequestOrder(), persisted);
        return persisted;
      } catch (error) {
        queryClient.setQueryData(forgeKeys.trackedPullRequestOrder(), previousOrder);
        throw error;
      }
    },
    [queryClient],
  );

  const moveTrackedPullRequestToTop = useCallback(
    async (repo: RepoIdentity, pullRequest: PullRequestSummary) => {
      const currentOrder = await getTrackedPullRequestOrder();
      const nextOrder = prependTrackedPullRequestOrderEntry(
        currentOrder,
        toTrackedPullRequestOrderEntry({ repo, pullRequest }),
      );

      await persistTrackedPullRequestOrder(nextOrder);
    },
    [getTrackedPullRequestOrder, persistTrackedPullRequestOrder],
  );

  const removeTrackedPullRequestFromOrder = useCallback(
    async (repo: RepoIdentity, pullRequest: PullRequestSummary) => {
      const currentOrder = await getTrackedPullRequestOrder();
      const nextOrder = removeTrackedPullRequestOrderEntry(
        currentOrder,
        toTrackedPullRequestOrderEntry({ repo, pullRequest }),
      );

      await persistTrackedPullRequestOrder(nextOrder);
    },
    [getTrackedPullRequestOrder, persistTrackedPullRequestOrder],
  );

  const handleReorderTrackedPullRequests = useCallback(
    async (reorderedVisibleEntries: OverviewPullRequestSummary[]) => {
      const currentOrder = await getTrackedPullRequestOrder();
      const nextOrder = mergeTrackedVisibleSubsetIntoOrder({
        currentOrder,
        visibleEntries: trackedPullRequestEntries,
        reorderedVisibleEntries,
      });

      await persistTrackedPullRequestOrder(nextOrder);
    },
    [getTrackedPullRequestOrder, persistTrackedPullRequestOrder, trackedPullRequestEntries],
  );

  useEffect(() => {
    async function openForgePullRequestLink(deepLinkUrl: string) {
      const targetUrl = parseAppOpenUrl(deepLinkUrl);
      if (!targetUrl) {
        throw new Error('Deep link is missing a target URL.');
      }

      const parsed = parseForgeResourceUrl(targetUrl);
      if (!parsed || parsed.number === null) {
        throw new Error('Only GitHub pull request and GitLab merge request URLs are supported.');
      }

      const matchingAccounts = readyProviderAccounts.filter(
        (account) =>
          account.provider === parsed.provider && normalizeHostInput(account.host) === parsed.host,
      );
      const account =
        matchingAccounts.find((candidate) => enabledAccountIdSet.has(candidate.id)) ??
        matchingAccounts[0];

      if (!account) {
        throw new Error(
          `No signed-in ${parsed.provider === 'github' ? 'GitHub' : 'GitLab'} account for ${parsed.host}.`,
        );
      }

      setDeepLinkMessage(`Opening ${parsed.repoPath} #${parsed.number}...`);
      const repo = await trpc.repos.validate.query({
        accountId: account.id,
        repo: parsed.repoPath,
      });
      const savedRepo = await trpc.repos.save.mutate({ repo });
      cacheSavedRepo(savedRepo);

      const pullRequest = await trpc.pullRequests.get.query({
        ...repoIdentity(savedRepo),
        number: parsed.number,
      });
      setActivePullRequest(savedRepo, pullRequest);
      setDeepLinkMessage(null);
    }

    const subscription = trpc.deepLinks.urls.subscribe(undefined, {
      onData(url) {
        void openForgePullRequestLink(url).catch((error) => {
          setDeepLinkMessage(getErrorMessage(error));
        });
      },
      onError(error) {
        setDeepLinkMessage(getErrorMessage(error));
      },
    });

    return () => subscription.unsubscribe();
  }, [cacheSavedRepo, enabledAccountIdSet, readyProviderAccounts, setActivePullRequest]);

  async function handleRemoveTrackedPullRequest(
    repo: RepoIdentity,
    pullRequest: PullRequestSummary,
  ) {
    await trpc.tracked.remove.mutate({
      ...repo,
      number: pullRequest.number,
    });
    const nextTrackedPullRequests = (
      queryClient.getQueryData<PullRequestSummary[]>(forgeKeys.trackedPullRequestList(repo)) ?? []
    ).filter((item) => item.number !== pullRequest.number);
    queryClient.setQueryData<PullRequestSummary[]>(
      forgeKeys.trackedPullRequestList(repo),
      nextTrackedPullRequests,
    );
    if (nextTrackedPullRequests.length === 0) {
      removeTrackedRepo(repo);
    }
    await removeTrackedPullRequestFromOrder(repo, pullRequest);

    if (
      activeRepoIdentity &&
      sameRepoIdentity(activeRepoIdentity, repo) &&
      activePullRequestNumber === pullRequest.number
    ) {
      clearActivePullRequest();
    }
  }

  async function handleTrackFromDataSource(
    repoIdentityInput: RepoIdentity,
    pullRequest: PullRequestSummary,
  ) {
    const repo =
      sidebarRepos.find((candidate) => sameRepoIdentity(candidate, repoIdentityInput)) ??
      dataSourcePullRequests.find((entry) => sameRepoIdentity(entry.repo, repoIdentityInput))
        ?.repo ??
      recentPullRequestsQuery.data?.find((entry) => sameRepoIdentity(entry.repo, repoIdentityInput))
        ?.repo;
    if (repo && !savedRepos.some((candidate) => sameRepoIdentity(candidate, repo))) {
      const savedRepo = await trpc.repos.save.mutate({ repo });
      cacheSavedRepo(savedRepo);
    }

    const trackedPullRequest = await trpc.tracked.track.mutate({
      ...repoIdentityInput,
      pullRequest,
    });
    if (repo) {
      cacheTrackedRepo(repo);
      promoteRecentPullRequest(repo, trackedPullRequest);
    }
    cacheTrackedPullRequest(repoIdentityInput, trackedPullRequest);
    await moveTrackedPullRequestToTop(repoIdentityInput, trackedPullRequest);
  }

  async function handleToggleTrackedPullRequest(
    entry: OverviewPullRequestSummary,
    tracked: boolean,
  ) {
    if (tracked) {
      await handleRemoveTrackedPullRequest(entry.repo, entry.pullRequest);
      return;
    }

    await handleTrackFromDataSource(entry.repo, entry.pullRequest);
  }

  async function handleDataSourcesChange(nextSettings: PullRequestDataSourcesSettings) {
    const previousSettings = queryClient.getQueryData<PullRequestDataSourcesSettings>(
      forgeKeys.dataSources(),
    );
    queryClient.setQueryData(forgeKeys.dataSources(), nextSettings);
    try {
      const persisted = await setDataSourcesSettings(nextSettings);
      queryClient.setQueryData(forgeKeys.dataSources(), persisted);
    } catch (error) {
      queryClient.setQueryData(forgeKeys.dataSources(), previousSettings);
      throw error;
    }
  }

  const toggleRepoSidebar = useCallback(() => {
    const panel = repoSidebarPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setIsRepoSidebarCollapsed(false);
      return;
    }
    panel.collapse();
    setIsRepoSidebarCollapsed(true);
  }, []);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; onClear: () => void }> = [];

    if (profileFilterAccountId) {
      const account = providerAccounts.find((entry) => entry.id === profileFilterAccountId);
      chips.push({
        id: 'profile-filter',
        label: `profile: ${account?.label ?? profileFilterAccountId}`,
        onClear: clearProfileFilter,
      });
    }

    if (repoFilterKey) {
      const repoLabel =
        savedRepos.find((repo) => repo.repoKey === repoFilterKey)?.nameWithOwner ??
        trackedRepos.find((repo) => repo.repoKey === repoFilterKey)?.nameWithOwner ??
        selectedRepo?.nameWithOwner;
      chips.push({
        id: 'repo-filter',
        label: `repo: ${repoLabel ?? repoFilterKey}`,
        onClear: clearRepoFilter,
      });
    }

    return chips;
  }, [
    clearProfileFilter,
    clearRepoFilter,
    profileFilterAccountId,
    providerAccounts,
    repoFilterKey,
    savedRepos,
    selectedRepo?.nameWithOwner,
    trackedRepos,
  ]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink-900">
      <ResizablePanelGroup
        className="min-h-0 flex-1"
        disableCursor
        id="main-app-panels"
        orientation="horizontal"
        resizeTargetMinimumSize={{ fine: 16, coarse: 32 }}
      >
        <ResizablePanel
          className="h-full min-h-0 min-w-0 bg-canvas"
          collapsedSize="0px"
          collapsible
          defaultSize={REPO_SIDEBAR_DEFAULT_SIZE}
          groupResizeBehavior="preserve-pixel-size"
          id="repo-sidebar"
          maxSize={REPO_SIDEBAR_MAX_SIZE}
          minSize={REPO_SIDEBAR_MIN_SIZE}
          onResize={() => {
            setIsRepoSidebarCollapsed(repoSidebarPanelRef.current?.isCollapsed() ?? false);
          }}
          panelRef={repoSidebarPanelRef}
        >
          {isRepoSidebarCollapsed ? null : (
            <RepoSidebar
              activeFilters={activeFilterChips}
              repos={sidebarRepos}
              repoErrors={sidebarView === 'tracked' ? trackedRepoErrors : {}}
              dataSourcePullRequests={filteredDataSourcePullRequests}
              recentPullRequests={filteredRecentPullRequests}
              trackedPullRequests={filteredTrackedPullRequestEntries}
              dataSourceErrors={dataSourceError ? [dataSourceError] : []}
              isDataSourceLoading={isDataSourceLoading}
              dataSourceStatusMessage={dataSourceStatusMessage}
              dataSourcesSettings={dataSourcesSettings}
              activeDataSource={activeDataSource}
              providerAccounts={readyProviderAccounts}
              pinnedEntry={activePinnedSidebarEntry}
              view={sidebarView}
              selectedPrKey={selectedPrKey}
              trackedRepoCount={
                new Set(
                  filteredTrackedPullRequestEntries.map((entry) => repoIdentityKey(entry.repo)),
                ).size
              }
              trackedPullRequestNumbersByRepo={trackedPullRequestNumbersByRepo}
              emptyState={
                <div className="px-3 py-8 text-center text-sm text-ink-500">
                  No repos visible for the selected accounts.
                </div>
              }
              onCollapse={toggleRepoSidebar}
              onViewChange={setSidebarView}
              onDataSourcesChange={(settings) => void handleDataSourcesChange(settings)}
              onSelectPr={(name, pr) => void handleSelectPr(name, pr)}
              onTrackPr={(repo, pullRequest) => void handleTrackFromDataSource(repo, pullRequest)}
              onRemovePr={(repo, pullRequest) =>
                void handleRemoveTrackedPullRequest(repo, pullRequest)
              }
              onReorderTrackedPullRequests={(entries) =>
                void handleReorderTrackedPullRequests(entries)
              }
            />
          )}
        </ResizablePanel>
        <ResizableHandle
          className={isRepoSidebarCollapsed ? 'hidden' : ''}
          disabled={isRepoSidebarCollapsed}
          withHandle
        />
        <ResizablePanel
          className="h-full min-h-0 min-w-0"
          groupResizeBehavior="preserve-relative-size"
          id="review-workspace"
          minSize="420px"
        >
          <PatchViewerMain
            selectedPrKey={selectedPrKey}
            selectedPr={selectedPr}
            selectedRepo={selectedRepo}
            selectedPullRequestSummary={selectedPullRequestSummary}
            selectedPatch={selectedPatch}
            selectedBaseSha={selectedPr?.baseSha ?? null}
            isGitDiffMode={diffDataMode === 'git'}
            isPatchLoading={isPatchPreparing}
            isDark={isDark}
            approvalState={approvalState}
            isApprovalStateLoading={isApprovalStateLoading}
            approvalStateError={approvalStateError}
            patchError={patchError}
            changedFiles={changedFiles}
            isChangedFilesLoading={isChangedFilesLoading}
            changedFilesError={changedFilesError}
            globalReviewThreads={globalReviewThreads}
            reviewThreadsByFile={reviewThreadsByFile}
            reviewThreads={reviewThreads}
            isReviewThreadsLoading={isReviewThreadsLoading}
            reviewThreadsError={reviewThreadsError}
            pendingReview={pendingReview}
            isPendingReviewLoading={isPendingReviewLoading}
            pendingReviewError={pendingReviewError}
            qualityReport={qualityReport}
            isQualityReportLoading={isQualityReportLoading}
            qualityReportError={qualityReportError}
            qualityFindingsByFile={qualityView.byFile}
            displayedQualityInlineCount={qualityView.displayedInlineCount}
            displayedQualityFileCount={qualityView.displayedFileCount}
            unmappedQualityFindings={qualityView.unmappedFindings}
            parsedPatch={parsedPatch}
            fileStats={fileStats}
            gitStatus={gitStatus}
            isRepoSidebarCollapsed={isRepoSidebarCollapsed}
            onToggleRepoSidebar={toggleRepoSidebar}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {deepLinkMessage ? (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-neutral-200 bg-surface px-3 py-2 text-sm text-ink-700 shadow-lg dark:border-neutral-700">
          {deepLinkMessage}
        </div>
      ) : null}
      <HomeCommandPalettes
        approvalState={approvalState}
        changedFiles={changedFiles}
        diffSessionKey={patchViewerSessionKey}
        patchViewerSessionKey={patchViewerSessionKey}
        localPullRequests={commandPaletteLocalPullRequests}
        trackedPullRequestNumbersByRepo={trackedPullRequestNumbersByRepo}
        onToggleTrackedPullRequest={(entry, tracked) =>
          void handleToggleTrackedPullRequest(entry, tracked)
        }
        pendingReview={pendingReview}
        reviewThreads={reviewThreads}
        selectedPr={selectedPr}
        selectedPullRequestSummary={selectedPullRequestSummary}
        selectedPrKey={selectedPrKey}
        sidebarView={sidebarView}
        setSidebarView={setSidebarView}
      />
    </div>
  );
}

export { MainApp };
