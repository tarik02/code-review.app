import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkerPool } from "@pierre/diffs/react";
import {
  parsePatchFiles,
  trimPatchContext,
  type FileDiffMetadata,
} from "@pierre/diffs";
import type { GitStatusEntry } from "@pierre/trees";
import { RepoSidebar } from "./components/ui/repo-sidebar";
import { TrackPullRequestModal } from "./components/ui/track-pull-request-modal";
import { PatchViewerMain } from "./components/ui/patch-viewer-main";
import { AuthGateScreen } from "./components/ui/auth-gate-screen";
import PatchParserWorker from "./pierre-patch-parser-worker.ts?worker";
import {
  getErrorMessage,
  useRepoPickerRepos,
  useSavedRepos,
  useSelectedPullRequestData,
  useTrackedPullRequests,
} from "./hooks/use-forge-queries";
import { useTheme } from "./hooks/use-theme";
import { buildReviewThreadsByFile } from "./lib/review-threads";
import { trpc } from "./lib/trpc";
import {
  forgeKeys,
  providerAccountsQueryOptions,
  providerStatusesQueryOptions,
  pullRequestListQueryOptions,
  savedReposQueryOptions,
} from "./queries/forge";
import type {
  FileStatsEntry,
  ForgeProviderKind,
  ProviderAccount,
  ProviderAuthStatus,
  ProviderAuthStatusKind,
  PullRequestSummary,
  RepoSummary,
  SelectedPullRequest,
} from "./types/forge";

type ParsedPatchState = {
  fileDiffs: FileDiffMetadata[];
  parseError: string;
  isParsing: boolean;
};

type ParsePatchWorkerRequest = {
  type: "parse-patch";
  requestId: number;
  patch: string;
  cacheKeyPrefix: string;
  contextSize: number;
};

type ParsePatchWorkerResponse =
  | {
      type: "parse-patch-success";
      requestId: number;
      fileDiffs: FileDiffMetadata[];
    }
  | {
      type: "parse-patch-error";
      requestId: number;
      error: string;
    };

function parsePatchLocally(
  patch: string,
  cacheKeyPrefix: string,
  contextSize: number,
): FileDiffMetadata[] {
  const trimmedPatch = trimPatchContext(patch, contextSize);
  return parsePatchFiles(trimmedPatch, cacheKeyPrefix).flatMap(
    (parsedPatch) => parsedPatch.files,
  );
}

const AGGRESSIVE_PATCH_CONTEXT_SIZE = 3;
// Manual simulation override for provider auth status.
// Set to one of: "ready", "not_authenticated", "unknown_error".
const PROVIDER_AUTH_STATUS_OVERRIDE: ProviderAuthStatusKind | null = null;
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
    if (parsed.protocol !== "rudu:" || parsed.hostname !== "open") {
      return null;
    }
    return parsed.searchParams.get("url");
  } catch {
    return null;
  }
}

type MainAppProps = {
  providerAccounts: ProviderAccount[];
  providerStatuses: Record<string, ProviderAuthStatus>;
  isSigningIn: boolean;
  onSignIn: (provider: ForgeProviderKind, host: string, clientId: string) => void;
};

function MainApp({
  providerAccounts,
  providerStatuses,
  isSigningIn,
  onSignIn,
}: MainAppProps) {
  const queryClient = useQueryClient();
  const { isDark, toggleTheme } = useTheme();
  const workerPool = useWorkerPool();
  const [selectedPr, setSelectedPr] = useState<SelectedPullRequest | null>(
    null,
  );

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PullRequestPickerMode>(
    "repo-then-pr",
  );
  const [pickerStep, setPickerStep] = useState<PullRequestPickerStep>("repo");
  const [pickerRepo, setPickerRepo] = useState<RepoSummary | null>(null);
  const [selectedProviderAccountId, setSelectedProviderAccountId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [isTrackingPullRequest, setIsTrackingPullRequest] = useState(false);
  const [deepLinkMessage, setDeepLinkMessage] = useState<string | null>(null);
  const [openRepoValues, setOpenRepoValues] = useState<string[]>([]);
  const [parsedPatch, setParsedPatch] = useState<ParsedPatchState>({
    fileDiffs: [],
    parseError: "",
    isParsing: false,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const patchParserWorkerRef = useRef<Worker | null>(null);
  const parseRequestIdRef = useRef(0);
  const pendingParseRequestRef = useRef<ParsePatchWorkerRequest | null>(null);
  const refreshedReposRef = useRef<Set<string>>(new Set());
  const previousRepoNamesRef = useRef<string[]>([]);

  const updateSearch = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { repos = [] } = useSavedRepos();
  const readyProviderAccounts = useMemo(
    () =>
      providerAccounts.filter(
        (account) => providerStatuses[account.id]?.status === "ready",
      ),
    [providerAccounts, providerStatuses],
  );
  const selectedProviderAccount =
    providerAccounts.find((account) => account.id === selectedProviderAccountId) ??
    readyProviderAccounts[0] ??
    providerAccounts[0] ??
    null;
  const pickerProviderStatus = selectedProviderAccount
    ? providerStatuses[selectedProviderAccount.id] ?? null
    : null;
  const canLoadPickerRepos =
    isPickerOpen && Boolean(selectedProviderAccount) && pickerProviderStatus?.status === "ready";
  const { availableRepos, availableReposError, isLoadingRepos } =
    useRepoPickerRepos(
      debouncedQuery,
      selectedProviderAccount?.id ?? "",
      selectedProviderAccount?.provider ?? "github",
      canLoadPickerRepos,
    );
  const { prsByRepo, repoErrors, refreshTrackedPullRequests } =
    useTrackedPullRequests({
      repos,
      setSelectedPr,
    });

  useEffect(() => {
    let worker: Worker | null = null;

    try {
      worker = new PatchParserWorker();
    } catch (error) {
      console.error("Failed to initialize patch parser worker.", error);
      patchParserWorkerRef.current = null;
      return undefined;
    }

    patchParserWorkerRef.current = worker;

    const handleWorkerMessage = (
      event: MessageEvent<ParsePatchWorkerResponse>,
    ) => {
      const message = event.data;
      if (message.requestId !== parseRequestIdRef.current) {
        return;
      }

      startTransition(() => {
        if (message.type === "parse-patch-success") {
          setParsedPatch({
            fileDiffs: message.fileDiffs,
            parseError: "",
            isParsing: false,
          });
          return;
        }

        setParsedPatch({
          fileDiffs: [],
          parseError: message.error,
          isParsing: false,
        });
      });
    };

    const handleWorkerError = (event: ErrorEvent) => {
      console.error("Patch parser worker failed.", event.error ?? event.message);

      const pendingRequest = pendingParseRequestRef.current;
      if (!pendingRequest || pendingRequest.requestId !== parseRequestIdRef.current) {
        return;
      }

      try {
        const fileDiffs = parsePatchLocally(
          pendingRequest.patch,
          pendingRequest.cacheKeyPrefix,
          pendingRequest.contextSize,
        );

        startTransition(() => {
          setParsedPatch({
            fileDiffs,
            parseError: "",
            isParsing: false,
          });
        });
      } catch (error) {
        startTransition(() => {
          setParsedPatch({
            fileDiffs: [],
            parseError:
              error instanceof Error
                ? error.message
                : "Failed to parse the PR patch.",
            isParsing: false,
          });
        });
      }
    };

    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", handleWorkerError);

    return () => {
      worker.removeEventListener("message", handleWorkerMessage);
      worker.removeEventListener("error", handleWorkerError);
      worker.terminate();
      patchParserWorkerRef.current = null;
    };
  }, []);

  const selectedPrKey = selectedPr
    ? `${selectedPr.repoId}#${selectedPr.number}@${selectedPr.headSha}`
    : null;
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
  } = useSelectedPullRequestData(selectedPr);
  const reviewThreadsByFile = useMemo(
    () => buildReviewThreadsByFile(reviewThreads),
    [reviewThreads],
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
    () => repos.map((repo) => repo.id),
    [repos],
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
    const trackedPullRequests = prsByRepo[pickerRepoId] ?? [];
    return new Set(trackedPullRequests.map((pullRequest) => pullRequest.number));
  }, [pickerRepoId, prsByRepo]);
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
    if (
      selectedProviderAccountId &&
      providerAccounts.some((account) => account.id === selectedProviderAccountId)
    ) {
      return;
    }

    setSelectedProviderAccountId(
      readyProviderAccounts[0]?.id ?? providerAccounts[0]?.id ?? "",
    );
  }, [providerAccounts, readyProviderAccounts, selectedProviderAccountId]);

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
    parseRequestIdRef.current += 1;

    if (!selectedPatch?.patch) {
      setParsedPatch({ fileDiffs: [], parseError: "", isParsing: false });
      return;
    }

    setParsedPatch({ fileDiffs: [], parseError: "", isParsing: true });

    const request = {
      type: "parse-patch",
      requestId: parseRequestIdRef.current,
      patch: selectedPatch.patch,
      cacheKeyPrefix: `${selectedPatch.repoId}-${selectedPatch.number}-${selectedPatch.headSha}`,
      // Be aggressive here: the review UI only needs enough surrounding lines
      // to orient the reader before Pierre's expand/collapse affordances take over.
      contextSize: AGGRESSIVE_PATCH_CONTEXT_SIZE,
    } satisfies ParsePatchWorkerRequest;

    pendingParseRequestRef.current = request;

    if (!patchParserWorkerRef.current) {
      try {
        const fileDiffs = parsePatchLocally(
          request.patch,
          request.cacheKeyPrefix,
          request.contextSize,
        );
        setParsedPatch({ fileDiffs, parseError: "", isParsing: false });
      } catch (error) {
        setParsedPatch({
          fileDiffs: [],
          parseError:
            error instanceof Error
              ? error.message
              : "Failed to parse the PR patch.",
          isParsing: false,
        });
      }
      return;
    }

    patchParserWorkerRef.current.postMessage(request);
  }, [selectedPatch]);

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

  const isPatchPreparing = isPatchLoading || parsedPatch.isParsing;

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

  async function handleRepoOpenChange(repo: string, open: boolean) {
    setOpenRepoValues((current) => {
      if (open) {
        return current.includes(repo) ? current : [...current, repo];
      }

      return current.filter((value) => value !== repo);
    });
  }

  function handleSelectPr(repoId: string, pullRequest: PullRequestSummary) {
    setSelectedPr({
      repoId,
      number: pullRequest.number,
      headSha: pullRequest.headSha,
    });

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

  function openRepoPullRequestPicker(repoId: string) {
    const repo = repos.find((candidate) => candidate.id === repoId);
    if (!repo) return;
    setSelectedProviderAccountId(repo.providerAccountId);
    setPickerMode("pr-only");
    setPickerStep("pull-request");
    setPickerRepo(repo);
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

      setSelectedPr({
        repoId: pickerRepoId,
        number: trackedPullRequest.number,
        headSha: trackedPullRequest.headSha,
      });
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
        selectedProviderAccount &&
        selectedProviderAccount.provider === parsed.provider &&
        selectedProviderAccount.host === parsed.host &&
        providerStatuses[selectedProviderAccount.id]?.status === "ready"
          ? selectedProviderAccount
          : matchingAccounts[0];

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

      setSelectedProviderAccountId(account.id);
      setSelectedPr({
        repoId: savedRepo.id,
        number: trackedPullRequest.number,
        headSha: trackedPullRequest.headSha,
      });
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
  }, [providerStatuses, readyProviderAccounts, selectedProviderAccount]);

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

    setSelectedPr((current) => {
      if (!current) return current;
      if (current.repoId !== repoId || current.number !== pullRequest.number) {
        return current;
      }
      return null;
    });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink-900">
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 w-1/4 min-w-[15%] shrink-0">
          <RepoSidebar
            repos={repos}
            prsByRepo={prsByRepo}
            repoErrors={repoErrors}
            openValues={openRepoValues}
            selectedPrKey={selectedPrKey}
            isDark={isDark}
            onAddRepo={openRepoPicker}
            onAddPr={(repo) => openRepoPullRequestPicker(repo)}
            onToggleTheme={toggleTheme}
            onSelectPr={(name, pr) => void handleSelectPr(name, pr)}
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
        providerAccounts={providerAccounts}
        selectedProviderAccountId={selectedProviderAccount?.id ?? ""}
        providerStatus={pickerProviderStatus}
        isSigningIn={isSigningIn}
        onProviderAccountChange={(accountId) => {
          setSelectedProviderAccountId(accountId);
          setSearchQuery("");
          setDebouncedQuery("");
        }}
        onSignIn={onSignIn}
        searchQuery={searchQuery}
        onSearchChange={updateSearch}
        isLoadingRepos={isLoadingRepos}
        availableReposError={availableReposError}
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

function App() {
  const queryClient = useQueryClient();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const pendingOAuthRef = useRef<{
    provider: ForgeProviderKind;
    host: string;
    accountId: string;
  } | null>(null);
  const providerAccountsQuery = useQuery({
    ...providerAccountsQueryOptions(),
    enabled: PROVIDER_AUTH_STATUS_OVERRIDE === null,
  });
  const providerStatusesQuery = useQuery({
    ...providerStatusesQueryOptions(),
    enabled: PROVIDER_AUTH_STATUS_OVERRIDE === null,
  });
  const providerAccounts = providerAccountsQuery.data ?? [];
  const providerStatusMap = providerStatusesQuery.data ?? {};
  const simulatedProviderStatus: ProviderAuthStatus | null = PROVIDER_AUTH_STATUS_OVERRIDE
    ? {
        status: PROVIDER_AUTH_STATUS_OVERRIDE,
        message: "Simulated via PROVIDER_AUTH_STATUS_OVERRIDE in App.tsx.",
      }
    : null;
  const providerStatuses = simulatedProviderStatus
    ? [simulatedProviderStatus]
    : Object.values(providerStatusMap);
  const hasReadyProvider = providerStatuses.some(
    (status) => status.status === "ready",
  );
  const gateStatus =
    providerStatuses.find((status) => status.status !== "not_authenticated") ??
    providerStatuses[0] ??
    ({ status: "not_authenticated", message: null } satisfies ProviderAuthStatus);
  const isCheckingAuth =
    PROVIDER_AUTH_STATUS_OVERRIDE === null &&
    (providerAccountsQuery.isPending ||
      providerStatusesQuery.isPending ||
      providerStatusesQuery.isFetching);
  const providerStatusMessage =
    authMessage ??
    gateStatus?.message ??
    (getErrorMessage(providerAccountsQuery.error) ||
      getErrorMessage(providerStatusesQuery.error) ||
      null);

  const checkAgain = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: forgeKeys.providerAccounts(),
    });
    void queryClient.invalidateQueries({
      queryKey: forgeKeys.providerStatuses(),
    });
  }, [queryClient]);

  useEffect(() => {
    if (!providerStatusesQuery.data) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: forgeKeys.providerAccounts(),
    });
  }, [providerStatusesQuery.data, queryClient]);

  const handleSignIn = useCallback(
    async (provider: ForgeProviderKind, host: string, clientId: string) => {
      const normalizedHost = normalizeHostInput(host) || (provider === "github" ? "github.com" : "gitlab.com");
      setIsSigningIn(true);
      setAuthMessage(null);
      try {
        const result = await trpc.auth.startOAuth.mutate({
          provider,
          host: normalizedHost,
          clientId,
        });
        pendingOAuthRef.current = {
          provider,
          host: normalizedHost,
          accountId: result.accountId,
        };
        window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
      } catch (error) {
        pendingOAuthRef.current = null;
        setAuthMessage(getErrorMessage(error));
      } finally {
        setIsSigningIn(false);
      }
    },
    [],
  );

  useEffect(() => {
    const subscription = trpc.auth.oauthCallbacks.subscribe(undefined, {
      async onData(url) {
        const pending = pendingOAuthRef.current;
        if (!pending) {
          setAuthMessage("OAuth callback received, but no sign in request is active.");
          return;
        }

        try {
          const parsed = new URL(url);
          const code = parsed.searchParams.get("code");
          const state = parsed.searchParams.get("state");
          const error = parsed.searchParams.get("error");
          if (error) {
            throw new Error(parsed.searchParams.get("error_description") ?? error);
          }
          if (!code || !state) {
            throw new Error("OAuth callback is missing a code or state.");
          }
          await trpc.auth.completeOAuth.mutate({
            code,
            state,
          });
          setAuthMessage(null);
          pendingOAuthRef.current = null;
          await queryClient.invalidateQueries({
            queryKey: forgeKeys.providerAccounts(),
          });
          await queryClient.invalidateQueries({
            queryKey: forgeKeys.providerStatuses(),
          });
        } catch (error) {
          setAuthMessage(getErrorMessage(error));
        }
      },
      onError(error) {
        setAuthMessage(getErrorMessage(error));
      },
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  if (isCheckingAuth && providerStatuses.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <p className="text-center text-base">checking provider auth status</p>
      </div>
    );
  }

  if (!hasReadyProvider) {
    return (
      <AuthGateScreen
        status={gateStatus?.status ?? "unknown_error"}
        message={providerStatusMessage}
        isChecking={isCheckingAuth}
        isSigningIn={isSigningIn}
        accounts={providerAccounts}
        statuses={providerStatusMap}
        onSignIn={handleSignIn}
        onCheckAgain={checkAgain}
      />
    );
  }

  return (
    <MainApp
      providerAccounts={providerAccounts}
      providerStatuses={providerStatusMap}
      isSigningIn={isSigningIn}
      onSignIn={handleSignIn}
    />
  );
}

export default App;
