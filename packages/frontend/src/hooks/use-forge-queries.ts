import { useCallback, useMemo } from 'react';
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
  pullRequestOverviewQueryOptions,
  removePullRequestApproval,
  replyToPullRequestReviewComment,
  publishPendingReview,
  savedReposQueryOptions,
  setPullRequestReviewThreadResolved,
  trackedPullRequestListQueryOptions,
  updatePendingReviewComment,
  updatePullRequestReviewComment,
  viewerLoginQueryOptions,
} from '../queries/forge';
import type {
  CreatePendingReviewGlobalInput,
  CreatePendingReviewReplyInput,
  CreatePendingReviewThreadInput,
  CreatePullRequestReviewCommentInput,
  DeletePullRequestReviewCommentInput,
  DeletePendingReviewCommentInput,
  DiffDataMode,
  DiscardPendingReviewInput,
  OverviewPullRequestSummary,
  PendingReviewState,
  PublishPendingReviewInput,
  PullRequestApprovalState,
  PrPatch,
  ProviderAccount,
  PullRequestQualityReport,
  PullRequestDataSource,
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

function useSavedRepos() {
  const query = useQuery(savedReposQueryOptions());
  return {
    ...query,
    repos: query.data ?? [],
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
      entries.push(error.message);
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

function useDataSourcePullRequests(dataSource: PullRequestDataSource | null, enabled: boolean) {
  const query = useQuery({
    queryKey: dataSource
      ? forgeKeys.pullRequestDataSourceList(dataSource)
      : ([...forgeKeys.pullRequests(), 'data-source', 'idle'] as const),
    queryFn: async (): Promise<OverviewPullRequestSummary[]> => {
      if (!dataSource) return [];
      return trpc.pullRequests.listDataSource.query({ dataSource, limit: 100 });
    },
    enabled: enabled && dataSource !== null,
  });

  return {
    error: query.error ? query.error.message : null,
    isLoading: enabled && dataSource !== null && query.isPending,
    pullRequests: query.data ?? [],
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
      entries.push([repo, error.message]);
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
      entries.push([repo, error.message]);
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
    approvalStateError: approvalStateQuery.error?.message ?? '',
    changedFiles,
    changedFilesError:
      diffDataMode === 'git'
        ? (selectedPatchQuery.error?.message ?? '')
        : (changedFilesQuery.error?.message ?? ''),
    isApprovalStateLoading,
    isChangedFilesLoading,
    isPatchLoading,
    isPendingReviewLoading,
    isQualityReportLoading,
    isReviewThreadsLoading,
    patchError: selectedPatchQuery.error?.message ?? '',
    pendingReview,
    pendingReviewError: pendingReviewQuery.error?.message ?? '',
    qualityReport,
    qualityReportError: qualityReportQuery.error?.message ?? '',
    reviewThreads,
    reviewThreadsError: reviewThreadsQuery.error?.message ?? '',
    selectedPatch,
  };
}

function usePullRequestApprovalMutations(
  selectedPr: SelectedPullRequest | null,
  options?: { onApproveError?: (error: Error) => void },
) {
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
    onError: options?.onApproveError,
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
  dedupeOverviewPullRequestEntries,
  useAccountOverviewPullRequests,
  useDataSourcePullRequests,
  useInitialReposForAccounts,
  usePullRequestApprovalMutations,
  useOverviewPullRequests,
  usePullRequestReviewCommentMutations,
  useSavedRepos,
  useSelectedPullRequestData,
  useTrackedPullRequests,
};
