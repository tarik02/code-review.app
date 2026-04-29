import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useWorkerPool } from "@pierre/diffs/react";
import type { GitStatusEntry } from "@pierre/trees";
import { RepoSidebar, type SidebarPullRequestView } from "../components/ui/repo-sidebar";
import { TrackPullRequestModal } from "../components/ui/track-pull-request-modal";
import { PatchViewerMain } from "../components/ui/patch-viewer-main";
import {
  getErrorMessage,
  useAccountOverviewPullRequests,
  useRepoPickerReposForAccounts,
  useSavedRepos,
  useSelectedPullRequestData,
  useTrackedPullRequests,
} from "../hooks/use-forge-queries";
import { useTheme } from "../hooks/use-theme";
import { useAuthSession } from "./auth-session";
import { sortByFileTreePathOrder } from "../lib/file-tree-order";
import { normalizeHostInput, parseAppOpenUrl, parseForgeResourceUrl } from "../lib/forge-links";
import { buildReviewThreadsByFile, getGlobalReviewThreads } from "../lib/review-threads";
import { buildPullRequestQualityView } from "../lib/pull-request-quality";
import {
  mergeTrackedVisibleSubsetIntoOrder,
  prependTrackedPullRequestOrderEntry,
  removeTrackedPullRequestOrderEntry,
  sortTrackedPullRequestEntries,
  toTrackedPullRequestOrderEntry,
} from "../lib/tracked-pull-request-order";
import { repoIdentity, repoIdentityKey, sameRepoIdentity } from "../lib/repo-identity";
import { trpc } from "../lib/trpc";
import {
  accountVisibilityQueryOptions,
  diffDataSettingsQueryOptions,
  forgeKeys,
  pullRequestListQueryOptions,
  savedReposQueryOptions,
  setTrackedPullRequestOrder,
  trackedReposQueryOptions,
  trackedPullRequestOrderQueryOptions,
} from "../queries/forge";
import type {
  DiffDataMode,
  FileStatsEntry,
  OverviewPullRequestSummary,
  PullRequestSummary,
  RepoIdentity,
  RepoSummary,
  SelectedPullRequest,
  TrackedPullRequestOrderEntry,
} from "../types/forge";

type PullRequestPickerMode = "repo-then-pr" | "pr-only" | "track-repo-then-pr";
type PullRequestPickerStep = "repo" | "pull-request";

function MainApp() {
  const { providerAccounts, providerStatuses } = useAuthSession();
  const activeRouteSearch = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const workerPool = useWorkerPool();
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

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PullRequestPickerMode>("repo-then-pr");
  const [pickerStep, setPickerStep] = useState<PullRequestPickerStep>("repo");
  const [pickerRepo, setPickerRepo] = useState<RepoSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [isTrackingPullRequest, setIsTrackingPullRequest] = useState(false);
  const [deepLinkMessage, setDeepLinkMessage] = useState<string | null>(null);
  const [sidebarView, setSidebarView] = useState<SidebarPullRequestView>("overview");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshedReposRef = useRef<Set<string>>(new Set());

  const updateSearch = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { repos: savedRepos = [] } = useSavedRepos();
  const trackedRepos = useQuery(trackedReposQueryOptions()).data ?? [];
  const accountVisibilityQuery = useQuery(accountVisibilityQueryOptions());
  const readyProviderAccounts = useMemo(
    () => providerAccounts.filter((account) => providerStatuses[account.id]?.status === "ready"),
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
  const pickerAccounts = useMemo(
    () => readyProviderAccounts.filter((account) => enabledAccountIdSet.has(account.id)),
    [enabledAccountIdSet, readyProviderAccounts],
  );
  const refreshableTrackedRepos = useMemo(
    () => trackedRepos.filter((repo) => readyAccountIds.has(repo.providerAccountId)),
    [readyAccountIds, trackedRepos],
  );
  const canLoadPickerRepos = isPickerOpen && pickerStep === "repo";
  const { availableRepos, availableReposError, isLoadingRepos } = useRepoPickerReposForAccounts(
    pickerAccounts,
    enabledAccountIds,
    debouncedQuery,
    canLoadPickerRepos,
  );
  const {
    accountIds: overviewAccountIds,
    errors: overviewErrors,
    isLoading: isOverviewLoading,
    pullRequests: overviewPullRequests,
  } = useAccountOverviewPullRequests(
    readyProviderAccounts,
    enabledAccountIds,
    sidebarView === "overview",
  );
  const readyOverviewAccountCount = readyProviderAccounts.length;
  const overviewStatusMessage = useMemo(() => {
    if (sidebarView !== "overview") return null;
    if (readyOverviewAccountCount === 0) return "No ready provider accounts.";
    if (overviewAccountIds.length === 0) {
      return "Provider accounts are hidden in settings.";
    }
    return null;
  }, [overviewAccountIds.length, readyOverviewAccountCount, sidebarView]);
  const {
    prsByRepo: trackedPrsByRepo,
    repoErrors: trackedRepoErrors,
    refreshTrackedPullRequests,
  } = useTrackedPullRequests({ repos: refreshableTrackedRepos });
  const trackedPullRequestOrderQuery = useQuery(trackedPullRequestOrderQueryOptions());
  const activeOverviewEntry = useMemo(() => {
    if (!activeRepoIdentity || activePullRequestNumber === null) {
      return null;
    }

    return (
      overviewPullRequests.find(
        (entry) =>
          sameRepoIdentity(entry.repo, activeRepoIdentity) &&
          entry.pullRequest.number === activePullRequestNumber,
      ) ?? null
    );
  }, [activePullRequestNumber, activeRepoIdentity, overviewPullRequests]);
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
  const selectedPr = useMemo<SelectedPullRequest | null>(() => {
    if (!activeRepoIdentity || activePullRequestNumber === null) {
      return null;
    }

    const overviewPullRequest = activeOverviewEntry?.pullRequest ?? null;
    const pullRequest = activeTrackedPullRequest ?? overviewPullRequest;
    if (!pullRequest) {
      return null;
    }

    return {
      ...activeRepoIdentity,
      number: activePullRequestNumber,
      headSha: pullRequest.headSha,
      baseSha: pullRequest.baseSha ?? overviewPullRequest?.baseSha ?? null,
    };
  }, [activeOverviewEntry, activePullRequestNumber, activeRepoIdentity, activeTrackedPullRequest]);
  const selectedRepo = activeRepoIdentity
    ? (savedRepos.find((repo) => sameRepoIdentity(repo, activeRepoIdentity)) ??
      trackedRepos.find((repo) => sameRepoIdentity(repo, activeRepoIdentity)) ??
      activeOverviewEntry?.repo ??
      null)
    : null;
  const isSelectedRepoHidden =
    Boolean(selectedPr && selectedRepo) &&
    !enabledAccountIdSet.has(selectedRepo?.providerAccountId ?? "");
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

  const selectedPrKey = selectedPr
    ? `${repoIdentityKey(selectedPr)}#${selectedPr.number}@${selectedPr.headSha}`
    : null;
  const diffDataSettingsQuery = useQuery(diffDataSettingsQueryOptions());
  const diffDataMode: DiffDataMode = diffDataSettingsQuery.data?.mode ?? "provider-api";
  const {
    changedFiles,
    changedFilesError,
    isChangedFilesLoading,
    isPatchLoading,
    isQualityReportLoading,
    isReviewThreadsLoading,
    patchError,
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
      parseError: "",
    }),
    [selectedPatch],
  );

  const pickerRepos = availableRepos;
  const parsedPickerDirectLink = useMemo(
    () => parseForgeResourceUrl(searchQuery.trim()),
    [searchQuery],
  );
  const pickerDirectLinkAccount = useMemo(() => {
    if (!parsedPickerDirectLink || parsedPickerDirectLink.number === null) {
      return null;
    }

    return (
      pickerAccounts.find(
        (account) =>
          account.provider === parsedPickerDirectLink.provider &&
          normalizeHostInput(account.host) === parsedPickerDirectLink.host,
      ) ?? null
    );
  }, [parsedPickerDirectLink, pickerAccounts]);
  const pickerDirectLinkPullRequestQuery = useQuery({
    queryKey: [
      ...forgeKeys.trackedPullRequests(),
      "direct-link",
      pickerDirectLinkAccount?.id ?? "__idle__",
      parsedPickerDirectLink?.host ?? "__idle__",
      parsedPickerDirectLink?.repoPath ?? "__idle__",
      parsedPickerDirectLink?.number ?? "__idle__",
    ],
    queryFn: async () => {
      if (
        !pickerDirectLinkAccount ||
        !parsedPickerDirectLink ||
        parsedPickerDirectLink.number === null
      ) {
        throw new Error("No direct link to resolve.");
      }

      const repo = await trpc.repos.validate.query({
        accountId: pickerDirectLinkAccount.id,
        repo: parsedPickerDirectLink.repoPath,
      });
      const pullRequest = await trpc.pullRequests.get.query({
        ...repoIdentity(repo),
        number: parsedPickerDirectLink.number,
      });

      return { repo, pullRequest };
    },
    enabled:
      isPickerOpen &&
      pickerStep === "repo" &&
      parsedPickerDirectLink !== null &&
      parsedPickerDirectLink.number !== null &&
      pickerDirectLinkAccount !== null,
  });
  const pickerDirectLinkPullRequestOption = pickerDirectLinkPullRequestQuery.data ?? null;
  const pickerDirectLinkPullRequestError =
    parsedPickerDirectLink && parsedPickerDirectLink.number !== null && pickerDirectLinkAccount === null
      ? `No signed-in ${parsedPickerDirectLink.provider === "github" ? "GitHub" : "GitLab"} account for ${parsedPickerDirectLink.host}.`
      : getErrorMessage(pickerDirectLinkPullRequestQuery.error);
  const pickerRepoIdentity = pickerRepo ? repoIdentity(pickerRepo) : null;
  const pickerRepoLookupKey = pickerRepo ? repoIdentityKey(pickerRepo) : null;
  const pickerOpenPullRequestsQuery = useQuery({
    ...pullRequestListQueryOptions(
      pickerRepoIdentity ?? { providerId: "__idle__", repoKey: "__idle__" },
    ),
    enabled: isPickerOpen && pickerStep === "pull-request" && pickerRepoIdentity !== null,
  });
  const pickerOpenPullRequests = useMemo(
    () => pickerOpenPullRequestsQuery.data ?? [],
    [pickerOpenPullRequestsQuery.data],
  );
  const trackedPrNumbersForPicker = useMemo(() => {
    if (!pickerRepoLookupKey) return new Set<number>();
    const trackedPullRequests = trackedPrsByRepo[pickerRepoLookupKey] ?? [];
    return new Set(trackedPullRequests.map((pullRequest) => pullRequest.number));
  }, [pickerRepoLookupKey, trackedPrsByRepo]);
  const addablePullRequests = useMemo(
    () =>
      pickerOpenPullRequests.filter(
        (pullRequest) => !trackedPrNumbersForPicker.has(pullRequest.number),
      ),
    [pickerOpenPullRequests, trackedPrNumbersForPicker],
  );
  const pickerPullRequestsError = getErrorMessage(pickerOpenPullRequestsQuery.error);

  useEffect(() => {
    if (!workerPool) return;

    void workerPool.setRenderOptions({
      theme: isDark ? "pierre-dark" : "pierre-light",
    });
  }, [isDark, workerPool]);

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
      const status: GitStatusEntry["status"] =
        fd.type === "new" ? "added" : fd.type === "deleted" ? "deleted" : "modified";
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
        to: "/",
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
      to: "/",
      search: {},
    });
  }, [navigate]);

  function handleSelectPr(repo: RepoIdentity, pullRequest: PullRequestSummary) {
    setActivePullRequest(repo, pullRequest);

    if (sidebarView !== "tracked") {
      return;
    }

    const lookupKey = repoIdentityKey(repo);
    if (!refreshedReposRef.current.has(lookupKey)) {
      refreshedReposRef.current.add(lookupKey);
    }
    void refreshTrackedPullRequests(repo);
  }

  function resetPickerState() {
    setSearchQuery("");
    setDebouncedQuery("");
    setPickerStep(pickerMode === "pr-only" ? "pull-request" : "repo");
    if (pickerMode !== "pr-only") {
      setPickerRepo(null);
    }
  }

  function openOverviewRepoPicker() {
    setPickerMode("repo-then-pr");
    setPickerStep("repo");
    setPickerRepo(null);
    setIsPickerOpen(true);
  }

  function openTrackedPullRequestPicker() {
    setPickerMode("track-repo-then-pr");
    setPickerStep("repo");
    setPickerRepo(null);
    setIsPickerOpen(true);
  }

  const cacheSavedRepo = useCallback((savedRepo: RepoSummary) => {
    queryClient.setQueryData<RepoSummary[]>(savedReposQueryOptions().queryKey, (current) => {
      if (!current) return [savedRepo];
      if (current.some((item) => sameRepoIdentity(item, savedRepo))) {
        return current;
      }
      return [...current, savedRepo];
    });
  }, [queryClient]);

  const cacheTrackedRepo = useCallback((trackedRepo: RepoSummary) => {
    queryClient.setQueryData<RepoSummary[]>(forgeKeys.trackedRepos(), (current) => {
      if (!current) return [trackedRepo];
      if (current.some((item) => sameRepoIdentity(item, trackedRepo))) {
        return current;
      }
      return [...current, trackedRepo];
    });
  }, [queryClient]);

  const removeTrackedRepo = useCallback((repo: RepoIdentity) => {
    queryClient.setQueryData<RepoSummary[]>(
      forgeKeys.trackedRepos(),
      (current) => (current ?? []).filter((item) => !sameRepoIdentity(item, repo)),
    );
  }, [queryClient]);

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
        queryClient.getQueryData<TrackedPullRequestOrderEntry[]>(forgeKeys.trackedPullRequestOrder()) ??
        [];

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

  async function handlePickRepo(repo: RepoSummary) {
    const parsedUrl = parseForgeResourceUrl(searchQuery.trim(), repo.provider);
    const shouldKeepSearchQuery =
      parsedUrl &&
      parsedUrl.host === normalizeHostInput(repo.host) &&
      parsedUrl.repoPath === repo.repoKey;

    if (pickerMode === "track-repo-then-pr") {
      if (!shouldKeepSearchQuery) {
        setSearchQuery("");
        setDebouncedQuery("");
      }
      setPickerRepo(repo);
      setPickerStep("pull-request");
      return;
    }

    setIsSavingRepo(true);
    try {
      const savedRepo = await trpc.repos.save.mutate({ repo });
      cacheSavedRepo(savedRepo);

      setPickerRepo(savedRepo);
      setPickerStep("pull-request");
      if (!shouldKeepSearchQuery) {
        setSearchQuery("");
        setDebouncedQuery("");
      }
    } finally {
      setIsSavingRepo(false);
    }
  }

  async function trackPullRequestForRepo(repo: RepoSummary, pullRequest: PullRequestSummary) {
    const repoInput = repoIdentity(repo);
    setIsTrackingPullRequest(true);
    try {
      const trackedPullRequest = await trpc.tracked.track.mutate({
        ...repoInput,
        pullRequest,
      });
      cacheTrackedRepo(repo);
      cacheTrackedPullRequest(repoInput, trackedPullRequest);
      await moveTrackedPullRequestToTop(repoInput, trackedPullRequest);

      setActivePullRequest(repoInput, trackedPullRequest);
      setIsPickerOpen(false);
      resetPickerState();
    } finally {
      setIsTrackingPullRequest(false);
    }
  }

  async function handleTrackPullRequest(pullRequest: PullRequestSummary) {
    if (!pickerRepo) return;

    await trackPullRequestForRepo(pickerRepo, pullRequest);
  }

  async function handlePickDirectLinkPullRequest(repo: RepoSummary, pullRequest: PullRequestSummary) {
    if (pickerMode === "track-repo-then-pr") {
      await trackPullRequestForRepo(repo, pullRequest);
      return;
    }

    const savedRepo =
      savedRepos.find((candidate) => sameRepoIdentity(candidate, repo)) ??
      (await trpc.repos.save.mutate({ repo }));
    if (!savedRepos.some((candidate) => sameRepoIdentity(candidate, savedRepo))) {
      cacheSavedRepo(savedRepo);
    }

    setPickerRepo(savedRepo);
    setPickerStep("pull-request");
  }

  useEffect(() => {
    async function openForgePullRequestLink(deepLinkUrl: string) {
      const targetUrl = parseAppOpenUrl(deepLinkUrl);
      if (!targetUrl) {
        throw new Error("Deep link is missing a target URL.");
      }

      const parsed = parseForgeResourceUrl(targetUrl);
      if (!parsed || parsed.number === null) {
        throw new Error("Only GitHub pull request and GitLab merge request URLs are supported.");
      }

      const matchingAccounts = readyProviderAccounts.filter(
        (account) =>
          account.provider === parsed.provider &&
          normalizeHostInput(account.host) === parsed.host,
      );
      const account =
        matchingAccounts.find((candidate) => enabledAccountIdSet.has(candidate.id)) ??
        matchingAccounts[0];

      if (!account) {
        throw new Error(
          `No signed-in ${parsed.provider === "github" ? "GitHub" : "GitLab"} account for ${parsed.host}.`,
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
      const trackedPullRequest = await trpc.tracked.track.mutate({
        ...repoIdentity(savedRepo),
        pullRequest,
      });
      cacheTrackedRepo(savedRepo);
      cacheTrackedPullRequest(savedRepo, trackedPullRequest);
      await moveTrackedPullRequestToTop(savedRepo, trackedPullRequest);

      setActivePullRequest(savedRepo, trackedPullRequest);
      setIsPickerOpen(false);
      setPickerRepo(null);
      setPickerStep("repo");
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
  }, [
    cacheSavedRepo,
    cacheTrackedRepo,
    cacheTrackedPullRequest,
    enabledAccountIdSet,
    moveTrackedPullRequestToTop,
    readyProviderAccounts,
    setActivePullRequest,
  ]);

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

  async function handleTrackFromOverview(
    repoIdentityInput: RepoIdentity,
    pullRequest: PullRequestSummary,
  ) {
    const repo =
      sidebarRepos.find((candidate) => sameRepoIdentity(candidate, repoIdentityInput)) ??
      overviewPullRequests.find((entry) => sameRepoIdentity(entry.repo, repoIdentityInput))?.repo;
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
    }
    cacheTrackedPullRequest(repoIdentityInput, trackedPullRequest);
    await moveTrackedPullRequestToTop(repoIdentityInput, trackedPullRequest);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink-900">
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 w-1/4 min-w-[300px] shrink-0">
          <RepoSidebar
            repos={sidebarRepos}
            repoErrors={sidebarView === "tracked" ? trackedRepoErrors : {}}
            overviewPullRequests={overviewPullRequests}
            trackedPullRequests={trackedPullRequestEntries}
            overviewErrors={overviewErrors}
            isOverviewLoading={isOverviewLoading}
            overviewStatusMessage={overviewStatusMessage}
            view={sidebarView}
            selectedPrKey={selectedPrKey}
            trackedRepoCount={trackedSidebarRepos.length}
            trackedPullRequestNumbersByRepo={trackedPullRequestNumbersByRepo}
            emptyState={
              <div className="px-3 py-8 text-center text-sm text-ink-500">
                No repos visible for the selected accounts.
              </div>
            }
            onAddAction={sidebarView === "tracked" ? openTrackedPullRequestPicker : openOverviewRepoPicker}
            onViewChange={setSidebarView}
            onSelectPr={(name, pr) => void handleSelectPr(name, pr)}
            onTrackPr={(repo, pullRequest) => void handleTrackFromOverview(repo, pullRequest)}
            onRemovePr={(repo, pullRequest) =>
              void handleRemoveTrackedPullRequest(repo, pullRequest)
            }
            onReorderTrackedPullRequests={(entries) => void handleReorderTrackedPullRequests(entries)}
          />
        </div>
        <div className="min-h-0 min-w-[30%] flex-1">
          <PatchViewerMain
            selectedPrKey={selectedPrKey}
            selectedPatch={selectedPatch}
            selectedBaseSha={selectedPr?.baseSha ?? null}
            isGitDiffMode={diffDataMode === "git"}
            isPatchLoading={isPatchPreparing}
            isDark={isDark}
            patchError={patchError}
            changedFiles={changedFiles}
            isChangedFilesLoading={isChangedFilesLoading}
            changedFilesError={changedFilesError}
            globalReviewThreads={globalReviewThreads}
            reviewThreadsByFile={reviewThreadsByFile}
            reviewThreads={reviewThreads}
            isReviewThreadsLoading={isReviewThreadsLoading}
            reviewThreadsError={reviewThreadsError}
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
          />
        </div>
      </div>

      {deepLinkMessage ? (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-neutral-200 bg-surface px-3 py-2 text-sm text-ink-700 shadow-lg dark:border-neutral-700">
          {deepLinkMessage}
        </div>
      ) : null}

      <TrackPullRequestModal
        open={isPickerOpen}
        onOpenChange={(open) => {
          setIsPickerOpen(open);
          if (!open) {
            resetPickerState();
          }
        }}
        mode={pickerMode}
        step={pickerStep}
        selectedRepo={pickerRepo}
        searchQuery={searchQuery}
        onSearchChange={updateSearch}
        isLoadingRepos={isLoadingRepos}
        availableReposError={availableReposError}
        hasRepoSources={pickerAccounts.length > 0}
        repos={pickerRepos}
        directLinkPullRequestOption={pickerDirectLinkPullRequestOption}
        directLinkPullRequestError={pickerDirectLinkPullRequestError}
        isLoadingDirectLinkPullRequest={pickerDirectLinkPullRequestQuery.isLoading}
        isSavingRepo={isSavingRepo}
        onPickRepo={(repo) => void handlePickRepo(repo)}
        onPickDirectLinkPullRequest={(repo, pullRequest) =>
          void handlePickDirectLinkPullRequest(repo, pullRequest)
        }
        pullRequests={addablePullRequests}
        isLoadingPullRequests={
          isPickerOpen &&
          pickerStep === "pull-request" &&
          pickerRepoIdentity !== null &&
          pickerOpenPullRequestsQuery.isPending
        }
        pullRequestsError={pickerPullRequestsError}
        isTrackingPullRequest={isTrackingPullRequest}
        onPickPullRequest={(pullRequest) => void handleTrackPullRequest(pullRequest)}
        onBack={() => {
          setPickerStep("repo");
          setPickerRepo(null);
        }}
      />
    </div>
  );
}

export { MainApp };
