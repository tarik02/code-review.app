import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useWorkerPool } from "@pierre/diffs/react";
import type { GitStatusEntry } from "@pierre/trees";
import {
  RepoSidebar,
  type SidebarPullRequestView,
} from "../components/ui/repo-sidebar";
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
import { buildReviewThreadsByFile } from "../lib/review-threads";
import { trpc } from "../lib/trpc";
import {
  accountVisibilityQueryOptions,
  diffDataSettingsQueryOptions,
  forgeKeys,
  pullRequestListQueryOptions,
  savedReposQueryOptions,
} from "../queries/forge";
import type {
  DiffDataMode,
  FileStatsEntry,
  ForgeProviderKind,
  PullRequestSummary,
  RepoSummary,
  SelectedPullRequest,
} from "../types/forge";

type PullRequestPickerMode = "repo-then-pr" | "pr-only";
type PullRequestPickerStep = "repo" | "pull-request";

function normalizeHostInput(host: string) {
  return host
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

type ParsedForgePullRequestUrl = {
  provider: ForgeProviderKind;
  host: string;
  repoPath: string;
  number: number;
};

function parseForgePullRequestUrl(value: string): ParsedForgePullRequestUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  const host = normalizeHostInput(parsed.host);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const githubPullIndex = segments.indexOf("pull");
  if (githubPullIndex === 2) {
    const number = Number.parseInt(segments[3] ?? "", 10);
    if (Number.isInteger(number) && number > 0) {
      return {
        provider: "github",
        host,
        repoPath: `${segments[0]}/${segments[1]}`,
        number,
      };
    }
  }

  const gitlabDashIndex = segments.indexOf("-");
  if (
    gitlabDashIndex > 0 &&
    segments[gitlabDashIndex + 1] === "merge_requests"
  ) {
    const number = Number.parseInt(segments[gitlabDashIndex + 2] ?? "", 10);
    const repoPath = segments.slice(0, gitlabDashIndex).join("/");
    if (Number.isInteger(number) && number > 0 && repoPath) {
      return {
        provider: "gitlab",
        host,
        repoPath,
        number,
      };
    }
  }

  return null;
}

function parseRuduOpenUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "code-review.app:" || parsed.hostname !== "open") {
      return null;
    }
    return parsed.searchParams.get("url");
  } catch {
    return null;
  }
}

function MainApp() {
  const { providerAccounts, providerStatuses } = useAuthSession();
  const activeRouteSearch = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const workerPool = useWorkerPool();
  const activeRepoId = activeRouteSearch.repo ?? null;
  const activePullRequestNumber = activeRouteSearch.pr ?? null;

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PullRequestPickerMode>(
    "repo-then-pr",
  );
  const [pickerStep, setPickerStep] = useState<PullRequestPickerStep>("repo");
  const [pickerRepo, setPickerRepo] = useState<RepoSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [isTrackingPullRequest, setIsTrackingPullRequest] = useState(false);
  const [deepLinkMessage, setDeepLinkMessage] = useState<string | null>(null);
  const [openRepoValues, setOpenRepoValues] = useState<string[]>([]);
  const [sidebarView, setSidebarView] =
    useState<SidebarPullRequestView>("overview");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const refreshedReposRef = useRef<Set<string>>(new Set());
  const previousRepoNamesRef = useRef<string[]>([]);

  const updateSearch = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { repos = [] } = useSavedRepos();
  const accountVisibilityQuery = useQuery(accountVisibilityQueryOptions());
  const readyProviderAccounts = useMemo(
    () =>
      providerAccounts.filter(
        (account) => providerStatuses[account.id]?.status === "ready",
      ),
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
    () =>
      persistedEnabledAccountIds.filter((accountId) =>
        readyAccountIds.has(accountId),
      ),
    [persistedEnabledAccountIds, readyAccountIds],
  );
  const enabledAccountIdSet = useMemo(
    () => new Set(enabledAccountIds),
    [enabledAccountIds],
  );
  const pickerAccounts = useMemo(
    () =>
      readyProviderAccounts.filter((account) =>
        enabledAccountIdSet.has(account.id),
      ),
    [enabledAccountIdSet, readyProviderAccounts],
  );
  const canLoadPickerRepos = isPickerOpen && pickerStep === "repo";
  const { availableRepos, availableReposError, isLoadingRepos } =
    useRepoPickerReposForAccounts(
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
  } = useTrackedPullRequests({ repos });
  const activeOverviewEntry = useMemo(() => {
    if (!activeRepoId || activePullRequestNumber === null) {
      return null;
    }

    return (
      overviewPullRequests.find(
        (entry) =>
          entry.repo.id === activeRepoId &&
          entry.pullRequest.number === activePullRequestNumber,
      ) ?? null
    );
  }, [activePullRequestNumber, activeRepoId, overviewPullRequests]);
  const activeTrackedPullRequest = useMemo(() => {
    if (!activeRepoId || activePullRequestNumber === null) {
      return null;
    }

    return (
      (trackedPrsByRepo[activeRepoId] ?? []).find(
        (pullRequest) => pullRequest.number === activePullRequestNumber,
      ) ?? null
    );
  }, [activePullRequestNumber, activeRepoId, trackedPrsByRepo]);
  const selectedPr = useMemo<SelectedPullRequest | null>(() => {
    if (!activeRepoId || activePullRequestNumber === null) {
      return null;
    }

    const overviewPullRequest = activeOverviewEntry?.pullRequest ?? null;
    const pullRequest = activeTrackedPullRequest ?? overviewPullRequest;
    if (!pullRequest) {
      return null;
    }

    return {
      repoId: activeRepoId,
      number: activePullRequestNumber,
      headSha: pullRequest.headSha,
      baseSha: pullRequest.baseSha ?? overviewPullRequest?.baseSha ?? null,
    };
  }, [
    activeOverviewEntry,
    activePullRequestNumber,
    activeRepoId,
    activeTrackedPullRequest,
  ]);
  const selectedRepo = activeRepoId
    ? repos.find((repo) => repo.id === activeRepoId) ??
      activeOverviewEntry?.repo ??
      null
    : null;
  const isSelectedRepoHidden =
    Boolean(selectedPr && selectedRepo) &&
    !enabledAccountIdSet.has(selectedRepo?.providerAccountId ?? "");
  const sidebarRepos = useMemo(() => {
    const visibleSavedRepos = repos.filter((repo) =>
      enabledAccountIdSet.has(repo.providerAccountId),
    );
    const visibleRepos = visibleSavedRepos;

    if (!selectedRepo || !isSelectedRepoHidden) {
      return visibleRepos;
    }
    if (visibleRepos.some((repo) => repo.id === selectedRepo.id)) {
      return visibleRepos;
    }
    return [...visibleRepos, selectedRepo];
  }, [
    enabledAccountIdSet,
    isSelectedRepoHidden,
    repos,
    selectedRepo,
  ]);
  const trackedPullRequestNumbersByRepo = useMemo(() => {
    const entries: Array<[string, Set<number>]> = [];
    for (const [repoId, pullRequests] of Object.entries(trackedPrsByRepo)) {
      entries.push([
        repoId,
        new Set(pullRequests.map((pullRequest) => pullRequest.number)),
      ]);
    }
    return Object.fromEntries(entries);
  }, [trackedPrsByRepo]);
  const trackedSidebarPrsByRepo = useMemo(() => {
    if (!selectedPr || !selectedRepo || !isSelectedRepoHidden) {
      return trackedPrsByRepo;
    }

    const selectedPullRequest = (trackedPrsByRepo[selectedRepo.id] ?? []).find(
      (pullRequest) =>
        pullRequest.number === selectedPr.number &&
        pullRequest.headSha === selectedPr.headSha,
    );
    return {
      ...trackedPrsByRepo,
      [selectedRepo.id]: selectedPullRequest ? [selectedPullRequest] : [],
    };
  }, [isSelectedRepoHidden, selectedPr, selectedRepo, trackedPrsByRepo]);
  const sidebarPrsByRepo =
    sidebarView === "overview" ? {} : trackedSidebarPrsByRepo;
  const sidebarErrors =
    sidebarView === "overview" ? {} : trackedRepoErrors;

  const selectedPrKey = selectedPr
    ? `${selectedPr.repoId}#${selectedPr.number}@${selectedPr.headSha}`
    : null;
  const diffDataSettingsQuery = useQuery(diffDataSettingsQueryOptions());
  const diffDataMode: DiffDataMode =
    diffDataSettingsQuery.data?.mode ?? "provider-api";
  const {
    changedFiles,
    changedFilesError,
    isChangedFilesLoading,
    isPatchLoading,
    isReviewThreadsLoading,
    patchError,
    reviewThreads,
    reviewThreadsError,
    selectedPatch,
  } = useSelectedPullRequestData(selectedPr, diffDataMode);
  const reviewThreadsByFile = useMemo(
    () => buildReviewThreadsByFile(reviewThreads),
    [reviewThreads],
  );
  const parsedPatch = useMemo(
    () => ({
      fileDiffs: selectedPatch?.fileDiffs ?? [],
      parseError: "",
    }),
    [selectedPatch],
  );

  const addedRepoKeys = useMemo(
    () => new Set(repos.map((r) => r.id)),
    [repos],
  );

  const filteredRepos = useMemo(
    () => availableRepos.filter((r) => !addedRepoKeys.has(r.id)),
    [availableRepos, addedRepoKeys],
  );
  const repoNames = useMemo(
    () => sidebarRepos.map((repo) => repo.id),
    [sidebarRepos],
  );
  const pickerRepoId = pickerRepo?.id ?? null;
  const pickerOpenPullRequestsQuery = useQuery({
    ...pullRequestListQueryOptions(pickerRepoId ?? "__idle__"),
    enabled:
      isPickerOpen &&
      pickerStep === "pull-request" &&
      pickerRepoId !== null,
  });
  const pickerOpenPullRequests = pickerOpenPullRequestsQuery.data ?? [];
  const trackedPrNumbersForPicker = useMemo(() => {
    if (!pickerRepoId) return new Set<number>();
    const trackedPullRequests = trackedPrsByRepo[pickerRepoId] ?? [];
    return new Set(trackedPullRequests.map((pullRequest) => pullRequest.number));
  }, [pickerRepoId, trackedPrsByRepo]);
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
    const previousRepoNames = previousRepoNamesRef.current;
    const addedRepoNames = repoNames.filter(
      (repoName) => !previousRepoNames.includes(repoName),
    );

    setOpenRepoValues((current) => {
      const nextOpenRepos = current.filter((repoName) =>
        repoNames.includes(repoName),
      );

      for (const repoName of addedRepoNames) {
        if (!nextOpenRepos.includes(repoName)) {
          nextOpenRepos.push(repoName);
        }
      }

      if (
        nextOpenRepos.length === current.length &&
        nextOpenRepos.every((repoName, index) => repoName === current[index])
      ) {
        return current;
      }

      return nextOpenRepos;
    });

    previousRepoNamesRef.current = repoNames;
  }, [repoNames]);

  useEffect(() => {
    for (const repo of repos) {
      const repoId = repo.id;
      if (refreshedReposRef.current.has(repoId)) {
        continue;
      }

      refreshedReposRef.current.add(repoId);
      void refreshTrackedPullRequests(repoId);
    }
  }, [refreshTrackedPullRequests, repos]);

  const isPatchPreparing = isPatchLoading;

  const fileStats = useMemo(() => {
    if (parsedPatch.fileDiffs.length === 0) return null;
    const map = new Map<string, FileStatsEntry>();
    for (const fd of parsedPatch.fileDiffs) {
      const status: GitStatusEntry["status"] =
        fd.type === "new"
          ? "added"
          : fd.type === "deleted"
            ? "deleted"
            : "modified";
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
    (repoId: string, pullRequest: PullRequestSummary) => {
      void navigate({
        to: "/",
        search: { repo: repoId, pr: pullRequest.number },
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

  async function handleRepoOpenChange(repo: string, open: boolean) {
    setOpenRepoValues((current) => {
      if (open) {
        return current.includes(repo) ? current : [...current, repo];
      }

      return current.filter((value) => value !== repo);
    });
  }

  function handleSelectPr(repoId: string, pullRequest: PullRequestSummary) {
    setActivePullRequest(repoId, pullRequest);

    if (sidebarView !== "tracked") {
      return;
    }

    if (!refreshedReposRef.current.has(repoId)) {
      refreshedReposRef.current.add(repoId);
    }
    void refreshTrackedPullRequests(repoId);
  }

  function resetPickerState() {
    setSearchQuery("");
    setDebouncedQuery("");
    setPickerStep(pickerMode === "pr-only" ? "pull-request" : "repo");
    if (pickerMode === "repo-then-pr") {
      setPickerRepo(null);
    }
  }

  function openRepoPicker() {
    setPickerMode("repo-then-pr");
    setPickerStep("repo");
    setPickerRepo(null);
    setIsPickerOpen(true);
  }

  async function openRepoPullRequestPicker(repoId: string) {
    const repo = sidebarRepos.find((candidate) => candidate.id === repoId);
    if (!repo) return;
    const savedRepo = repos.some((candidate) => candidate.id === repo.id)
      ? repo
      : await trpc.repos.save.mutate({ repo });

    cacheSavedRepo(savedRepo);
    setPickerMode("pr-only");
    setPickerStep("pull-request");
    setPickerRepo(savedRepo);
    setIsPickerOpen(true);
  }

  function cacheSavedRepo(savedRepo: RepoSummary) {
    queryClient.setQueryData<RepoSummary[]>(
      savedReposQueryOptions().queryKey,
      (current) => {
        if (!current) return [savedRepo];
        if (current.some((item) => item.id === savedRepo.id)) {
          return current;
        }
        return [...current, savedRepo];
      },
    );
  }

  function cacheTrackedPullRequest(
    repoId: string,
    trackedPullRequest: PullRequestSummary,
  ) {
    queryClient.setQueryData<PullRequestSummary[]>(
      forgeKeys.trackedPullRequestList(repoId),
      (current) => {
        const list = current ?? [];
        const withoutCurrent = list.filter(
          (item) => item.number !== trackedPullRequest.number,
        );
        return [trackedPullRequest, ...withoutCurrent];
      },
    );
  }

  async function handlePickRepo(repo: RepoSummary) {
    setIsSavingRepo(true);
    try {
      const savedRepo = await trpc.repos.save.mutate({ repo });
      cacheSavedRepo(savedRepo);

      setPickerRepo(savedRepo);
      setPickerStep("pull-request");
      setOpenRepoValues((current) =>
        current.includes(savedRepo.id)
          ? current
          : [...current, savedRepo.id],
      );
    } finally {
      setIsSavingRepo(false);
    }
  }

  async function handleTrackPullRequest(pullRequest: PullRequestSummary) {
    if (!pickerRepoId) return;

    setIsTrackingPullRequest(true);
    try {
      const trackedPullRequest = await trpc.tracked.track.mutate({
        repoId: pickerRepoId,
        pullRequest,
      });
      cacheTrackedPullRequest(pickerRepoId, trackedPullRequest);

      setActivePullRequest(pickerRepoId, trackedPullRequest);
      setIsPickerOpen(false);
      resetPickerState();
    } finally {
      setIsTrackingPullRequest(false);
    }
  }

  useEffect(() => {
    async function openForgePullRequestLink(deepLinkUrl: string) {
      const targetUrl = parseRuduOpenUrl(deepLinkUrl);
      if (!targetUrl) {
        throw new Error("Deep link is missing a target URL.");
      }

      const parsed = parseForgePullRequestUrl(targetUrl);
      if (!parsed) {
        throw new Error("Only GitHub pull request and GitLab merge request URLs are supported.");
      }

      const matchingAccounts = readyProviderAccounts.filter(
        (account) =>
          account.provider === parsed.provider && account.host === parsed.host,
      );
      const account =
        matchingAccounts.find((candidate) =>
          enabledAccountIdSet.has(candidate.id),
        ) ?? matchingAccounts[0];

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
        repoId: savedRepo.id,
        number: parsed.number,
      });
      const trackedPullRequest = await trpc.tracked.track.mutate({
        repoId: savedRepo.id,
        pullRequest,
      });
      cacheTrackedPullRequest(savedRepo.id, trackedPullRequest);

      setActivePullRequest(savedRepo.id, trackedPullRequest);
      setOpenRepoValues((current) =>
        current.includes(savedRepo.id) ? current : [...current, savedRepo.id],
      );
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
  }, [enabledAccountIdSet, readyProviderAccounts, setActivePullRequest]);

  async function handleRemoveTrackedPullRequest(
    repoId: string,
    pullRequest: PullRequestSummary,
  ) {
    await trpc.tracked.remove.mutate({
      repoId,
      number: pullRequest.number,
    });
    queryClient.setQueryData<PullRequestSummary[]>(
      forgeKeys.trackedPullRequestList(repoId),
      (current) =>
        (current ?? []).filter((item) => item.number !== pullRequest.number),
    );

    if (
      activeRepoId === repoId &&
      activePullRequestNumber === pullRequest.number
    ) {
      clearActivePullRequest();
    }
  }

  async function handleTrackFromOverview(
    repoId: string,
    pullRequest: PullRequestSummary,
  ) {
    const repo =
      sidebarRepos.find((candidate) => candidate.id === repoId) ??
      overviewPullRequests.find((entry) => entry.repo.id === repoId)?.repo;
    if (repo && !repos.some((candidate) => candidate.id === repo.id)) {
      const savedRepo = await trpc.repos.save.mutate({ repo });
      cacheSavedRepo(savedRepo);
    }

    const trackedPullRequest = await trpc.tracked.track.mutate({
      repoId,
      pullRequest,
    });
    cacheTrackedPullRequest(repoId, trackedPullRequest);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink-900">
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 w-1/4 min-w-[300px] shrink-0">
          <RepoSidebar
            repos={sidebarRepos}
            prsByRepo={sidebarPrsByRepo}
            repoErrors={sidebarErrors}
            overviewPullRequests={overviewPullRequests}
            overviewErrors={overviewErrors}
            isOverviewLoading={isOverviewLoading}
            overviewStatusMessage={overviewStatusMessage}
            openValues={openRepoValues}
            view={sidebarView}
            selectedPrKey={selectedPrKey}
            trackedPullRequestNumbersByRepo={trackedPullRequestNumbersByRepo}
            emptyState={
              <div className="px-3 py-8 text-center text-sm text-ink-500">
                No repos visible for the selected accounts.
              </div>
            }
            onAddRepo={openRepoPicker}
            onAddPr={(repo) => void openRepoPullRequestPicker(repo)}
            onViewChange={setSidebarView}
            onSelectPr={(name, pr) => void handleSelectPr(name, pr)}
            onTrackPr={(repo, pullRequest) =>
              void handleTrackFromOverview(repo, pullRequest)
            }
            onRemovePr={(repo, pullRequest) =>
              void handleRemoveTrackedPullRequest(repo, pullRequest)
            }
            onRepoOpenChange={(repo, open) =>
              void handleRepoOpenChange(repo, open)
            }
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
            reviewThreadsByFile={reviewThreadsByFile}
            reviewThreads={reviewThreads}
            isReviewThreadsLoading={isReviewThreadsLoading}
            reviewThreadsError={reviewThreadsError}
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
        filteredRepos={filteredRepos}
        isSavingRepo={isSavingRepo}
        onPickRepo={(repo) => void handlePickRepo(repo)}
        pullRequests={addablePullRequests}
        isLoadingPullRequests={
          isPickerOpen &&
          pickerStep === "pull-request" &&
          pickerRepoId !== null &&
          pickerOpenPullRequestsQuery.isPending
        }
        pullRequestsError={pickerPullRequestsError}
        isTrackingPullRequest={isTrackingPullRequest}
        onPickPullRequest={(pullRequest) =>
          void handleTrackPullRequest(pullRequest)
        }
        onBack={() => {
          setPickerStep("repo");
          setPickerRepo(null);
        }}
      />
    </div>
  );
}

export { MainApp };
