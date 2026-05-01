import { queryOptions } from '@tanstack/react-query';
import { trpc } from '../lib/trpc';
import { normalizeHostInput, parseForgeResourceUrl } from '../lib/forge-links';
import type {
  AccountVisibilitySettings,
  AppearanceBackgroundInput,
  AppearanceBackgroundSettings,
  CreatePendingReviewGlobalInput,
  CreatePendingReviewReplyInput,
  CreatePendingReviewThreadInput,
  CreatePullRequestReviewCommentInput,
  DeletePullRequestReviewCommentInput,
  DeletePendingReviewCommentInput,
  DiffDataMode,
  DiffDataSettings,
  DiscardPendingReviewInput,
  NamespaceSummary,
  PendingReviewState,
  PullRequestSearchState,
  PrFileChangeType,
  ProviderProfile,
  PublishPendingReviewInput,
  PullRequestApprovalState,
  PullRequestQualityReport,
  ReplyToPullRequestReviewCommentInput,
  ReviewEditorMode,
  ReviewEditorSettings,
  RepoIdentity,
  SelectedPullRequest,
  SetPullRequestReviewThreadResolvedInput,
  ThemePreferenceSettings,
  TrackedPullRequestOrderEntry,
  UpdatePendingReviewCommentInput,
  UpdatePullRequestReviewCommentInput,
} from '../types/forge';

const INITIAL_REPO_LIMIT = 5;
const SEARCH_REPO_LIMIT = 20;
const SEARCH_NAMESPACE_LIMIT = 20;

const forgeKeys = {
  all: ['forge'] as const,
  auth: () => [...forgeKeys.all, 'auth'] as const,
  settings: () => [...forgeKeys.all, 'settings'] as const,
  repos: () => [...forgeKeys.all, 'repos'] as const,
  providerAccounts: () => [...forgeKeys.auth(), 'provider-accounts'] as const,
  providerStatuses: () => [...forgeKeys.auth(), 'provider-statuses'] as const,
  providerProfile: (accountId: string) =>
    [...forgeKeys.auth(), 'provider-profile', accountId] as const,
  accountVisibility: () => [...forgeKeys.auth(), 'account-visibility'] as const,
  appearanceBackground: () => [...forgeKeys.settings(), 'appearance-background'] as const,
  diffDataSettings: () => [...forgeKeys.settings(), 'diff-data'] as const,
  themePreference: () => [...forgeKeys.settings(), 'theme-preference'] as const,
  reviewEditorSettings: () => [...forgeKeys.settings(), 'review-editor'] as const,
  savedRepos: () => [...forgeKeys.repos(), 'saved'] as const,
  initialRepos: (accountId: string) => [...forgeKeys.repos(), 'initial', accountId] as const,
  searchRepos: (accountId: string, query: string) =>
    [...forgeKeys.repos(), 'search', accountId, query] as const,
  searchNamespaces: (accountId: string, query: string) =>
    [...forgeKeys.repos(), 'search-namespaces', accountId, query] as const,
  viewerLogin: (accountId: string) => [...forgeKeys.repos(), 'viewer-login', accountId] as const,
  pullRequests: () => [...forgeKeys.all, 'pull-requests'] as const,
  pullRequestOverview: (accountId: string) =>
    [...forgeKeys.pullRequests(), 'overview', accountId] as const,
  pullRequestSearch: (
    accountId: string,
    query: string,
    states: PullRequestSearchState,
    limit: number,
  ) => [...forgeKeys.pullRequests(), 'search', accountId, query, states, limit] as const,
  pullRequestList: (repo: RepoIdentity) =>
    [...forgeKeys.pullRequests(), 'list', repo.providerId, repo.repoKey] as const,
  pullRequestCachedList: (repo: RepoIdentity) =>
    [...forgeKeys.pullRequests(), 'list', repo.providerId, repo.repoKey, 'cached'] as const,
  trackedPullRequests: () => [...forgeKeys.pullRequests(), 'tracked'] as const,
  trackedRepos: () => [...forgeKeys.trackedPullRequests(), 'repos'] as const,
  trackedPullRequestOrder: () => [...forgeKeys.trackedPullRequests(), 'order'] as const,
  trackedPullRequestList: (repo: RepoIdentity) =>
    [...forgeKeys.trackedPullRequests(), 'list', repo.providerId, repo.repoKey] as const,
  pullRequestPatch: (pr: SelectedPullRequest) =>
    [
      ...forgeKeys.pullRequests(),
      'patch',
      pr.providerId,
      pr.repoKey,
      pr.number,
      pr.headSha,
    ] as const,
  pullRequestFiles: (pr: SelectedPullRequest) =>
    [
      ...forgeKeys.pullRequests(),
      'files',
      pr.providerId,
      pr.repoKey,
      pr.number,
      pr.headSha,
    ] as const,
  pullRequestQualityReport: (pr: SelectedPullRequest) =>
    [
      ...forgeKeys.pullRequests(),
      'quality-report',
      pr.providerId,
      pr.repoKey,
      pr.number,
      pr.headSha,
    ] as const,
  pullRequestFileContents: (input: {
    providerId: string;
    repoKey: string;
    number: number;
    oldPath: string;
    newPath: string;
    baseSha: string | null;
    headSha: string;
    changeType: PrFileChangeType;
  }) =>
    [
      ...forgeKeys.pullRequests(),
      'file-contents',
      input.providerId,
      input.repoKey,
      input.number,
      input.oldPath,
      input.newPath,
      input.baseSha,
      input.headSha,
      input.changeType,
    ] as const,
  pullRequestReviewThreads: (pr: SelectedPullRequest) =>
    [
      ...forgeKeys.pullRequests(),
      'review-threads',
      pr.providerId,
      pr.repoKey,
      pr.number,
      pr.headSha,
    ] as const,
  pullRequestPendingReview: (pr: SelectedPullRequest) =>
    [
      ...forgeKeys.pullRequests(),
      'pending-review',
      pr.providerId,
      pr.repoKey,
      pr.number,
      pr.headSha,
    ] as const,
  pullRequestApprovalState: (pr: SelectedPullRequest) =>
    [
      ...forgeKeys.pullRequests(),
      'approval-state',
      pr.providerId,
      pr.repoKey,
      pr.number,
      pr.headSha,
    ] as const,
  pullRequestPatchIdle: () => [...forgeKeys.pullRequests(), 'patch', 'idle'] as const,
  pullRequestFilesIdle: () => [...forgeKeys.pullRequests(), 'files', 'idle'] as const,
  pullRequestReviewThreadsIdle: () =>
    [...forgeKeys.pullRequests(), 'review-threads', 'idle'] as const,
  pullRequestPendingReviewIdle: () =>
    [...forgeKeys.pullRequests(), 'pending-review', 'idle'] as const,
  pullRequestQualityReportIdle: () =>
    [...forgeKeys.pullRequests(), 'quality-report', 'idle'] as const,
  pullRequestApprovalStateIdle: () =>
    [...forgeKeys.pullRequests(), 'approval-state', 'idle'] as const,
};

function savedReposQueryOptions() {
  return queryOptions({
    queryKey: forgeKeys.savedRepos(),
    queryFn: () => trpc.repos.listSaved.query(),
    staleTime: Infinity,
  });
}

function providerAccountsQueryOptions() {
  return queryOptions({
    queryKey: forgeKeys.providerAccounts(),
    queryFn: () => trpc.auth.listProviderAccounts.query(),
    staleTime: 0,
  });
}

function providerStatusesQueryOptions() {
  return queryOptions({
    queryKey: forgeKeys.providerStatuses(),
    queryFn: () => trpc.auth.getProviderStatuses.query(),
    staleTime: 0,
  });
}

function providerProfileQueryOptions(accountId: string) {
  return queryOptions({
    queryKey: forgeKeys.providerProfile(accountId),
    queryFn: async (): Promise<ProviderProfile> => {
      return trpc.auth.getProviderProfile.query({ accountId });
    },
    staleTime: 60 * 60 * 1000,
  });
}

function accountVisibilityQueryOptions() {
  return queryOptions({
    queryKey: forgeKeys.accountVisibility(),
    queryFn: async (): Promise<AccountVisibilitySettings> => {
      return trpc.settings.getAccountVisibility.query();
    },
    staleTime: 0,
  });
}

function appearanceBackgroundQueryOptions() {
  return queryOptions({
    queryKey: forgeKeys.appearanceBackground(),
    queryFn: async (): Promise<AppearanceBackgroundSettings> => {
      return trpc.settings.getAppearanceBackground.query();
    },
    staleTime: 0,
  });
}

function diffDataSettingsQueryOptions() {
  return queryOptions({
    queryKey: forgeKeys.diffDataSettings(),
    queryFn: async (): Promise<DiffDataSettings> => {
      return trpc.settings.getDiffDataSettings.query();
    },
    staleTime: 0,
  });
}

function themePreferenceQueryOptions() {
  return queryOptions({
    queryKey: forgeKeys.themePreference(),
    queryFn: async (): Promise<ThemePreferenceSettings> => {
      return trpc.settings.getThemePreference.query();
    },
    staleTime: 0,
  });
}

function reviewEditorSettingsQueryOptions() {
  return queryOptions({
    queryKey: forgeKeys.reviewEditorSettings(),
    queryFn: async (): Promise<ReviewEditorSettings> => {
      return trpc.settings.getReviewEditorSettings.query();
    },
    staleTime: 0,
  });
}

async function setAccountVisibility(enabledAccountIds: string[]) {
  return trpc.settings.setAccountVisibility.mutate({ enabledAccountIds });
}

async function setAppearanceBackground(input: AppearanceBackgroundInput) {
  return trpc.settings.setAppearanceBackground.mutate(input);
}

async function setDiffDataMode(mode: DiffDataMode) {
  return trpc.settings.setDiffDataSettings.mutate({ mode });
}

async function setThemePreference(preference: ThemePreferenceSettings['preference']) {
  return trpc.settings.setThemePreference.mutate({ preference });
}

async function setReviewEditorDefaultMode(mode: ReviewEditorMode) {
  return trpc.settings.setReviewEditorSettings.mutate({ defaultMode: mode });
}

async function selectCustomBackgroundFile() {
  return trpc.settings.selectCustomBackgroundFile.mutate();
}

function viewerLoginQueryOptions(accountId: string) {
  return queryOptions({
    queryKey: forgeKeys.viewerLogin(accountId),
    queryFn: async () => {
      return trpc.reviewComments.getViewerLogin.query({ accountId });
    },
    staleTime: 60 * 60 * 1000,
  });
}

function initialReposQueryOptions(accountId: string) {
  return queryOptions({
    queryKey: forgeKeys.initialRepos(accountId),
    queryFn: () =>
      trpc.repos.listInitial.query({
        accountId,
        limit: INITIAL_REPO_LIMIT,
      }),
    staleTime: 5 * 60 * 1000,
  });
}

function searchReposQueryOptions(query: string, accountId: string, provider: string, host: string) {
  return queryOptions({
    queryKey: forgeKeys.searchRepos(accountId, query),
    queryFn: async () => {
      const trimmedQuery = query.trim();
      const parsedUrl = parseForgeResourceUrl(
        trimmedQuery,
        provider === 'gitlab' ? 'gitlab' : 'github',
      );
      const normalizedHost = normalizeHostInput(host);

      if (parsedUrl && parsedUrl.provider === provider && parsedUrl.host === normalizedHost) {
        const repo = await trpc.repos.tryValidate.query({
          accountId,
          repo: parsedUrl.repoPath,
        });
        return repo ? [repo] : [];
      }

      if (parsedUrl) {
        return [];
      }

      const pathQuery = trimmedQuery.replace(/\.git$/, '');
      const pathSegmentCount = pathQuery.split('/').filter(Boolean).length;
      if (
        ((provider === 'github' && pathSegmentCount === 2) ||
          (provider === 'gitlab' && pathSegmentCount >= 2)) &&
        !pathQuery.startsWith('/') &&
        !pathQuery.endsWith('/')
      ) {
        const repo = await trpc.repos.tryValidate.query({
          accountId,
          repo: pathQuery,
        });
        if (repo) {
          return [repo];
        }
      }

      return trpc.repos.search.query({
        accountId,
        query,
        limit: SEARCH_REPO_LIMIT,
      });
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

function searchNamespacesQueryOptions(query: string, accountId: string) {
  return queryOptions({
    queryKey: forgeKeys.searchNamespaces(accountId, query),
    queryFn: (): Promise<NamespaceSummary[]> =>
      trpc.repos.searchNamespaces.query({
        accountId,
        query,
        limit: SEARCH_NAMESPACE_LIMIT,
      }),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

function pullRequestCachedListQueryOptions(repo: RepoIdentity) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestCachedList(repo),
    queryFn: () => trpc.pullRequests.listCached.query(repo),
    staleTime: 0,
  });
}

function pullRequestOverviewQueryOptions(accountId: string) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestOverview(accountId),
    queryFn: () => trpc.pullRequests.listOverview.query({ accountId }),
    staleTime: 0,
  });
}

function pullRequestSearchQueryOptions(
  accountId: string,
  query: string,
  states: PullRequestSearchState,
  limit = 20,
) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestSearch(accountId, query, states, limit),
    queryFn: () =>
      trpc.pullRequests.search.query({
        accountId,
        query,
        limit,
        states,
      }),
    staleTime: 0,
    retry: false,
  });
}

function pullRequestListQueryOptions(repo: RepoIdentity) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestList(repo),
    queryFn: () => trpc.pullRequests.list.query(repo),
    staleTime: 0,
  });
}

function trackedPullRequestListQueryOptions(repo: RepoIdentity) {
  return queryOptions({
    queryKey: forgeKeys.trackedPullRequestList(repo),
    queryFn: () => trpc.tracked.list.query(repo),
    staleTime: Infinity,
  });
}

function trackedReposQueryOptions() {
  return queryOptions({
    queryKey: forgeKeys.trackedRepos(),
    queryFn: () => trpc.tracked.listRepos.query(),
    staleTime: Infinity,
  });
}

function trackedPullRequestOrderQueryOptions() {
  return queryOptions({
    queryKey: forgeKeys.trackedPullRequestOrder(),
    queryFn: (): Promise<TrackedPullRequestOrderEntry[]> => trpc.tracked.getOrder.query(),
    staleTime: Infinity,
  });
}

async function setTrackedPullRequestOrder(order: TrackedPullRequestOrderEntry[]) {
  return trpc.tracked.setOrder.mutate(order);
}

function pullRequestPatchQueryOptions(pr: SelectedPullRequest) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestPatch(pr),
    queryFn: () =>
      trpc.pullRequests.getPatch.query({
        providerId: pr.providerId,
        repoKey: pr.repoKey,
        number: pr.number,
        headSha: pr.headSha,
      }),
  });
}

function pullRequestFilesQueryOptions(pr: SelectedPullRequest) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestFiles(pr),
    queryFn: () =>
      trpc.pullRequests.listChangedFiles.query({
        providerId: pr.providerId,
        repoKey: pr.repoKey,
        number: pr.number,
        headSha: pr.headSha,
      }),
  });
}

function pullRequestQualityReportQueryOptions(pr: SelectedPullRequest) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestQualityReport(pr),
    queryFn: (): Promise<PullRequestQualityReport> =>
      trpc.pullRequests.getQualityReport.query({
        providerId: pr.providerId,
        repoKey: pr.repoKey,
        number: pr.number,
        headSha: pr.headSha,
      }),
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

function pullRequestFileContentsQueryOptions(input: {
  providerId: string;
  repoKey: string;
  number: number;
  oldPath: string;
  newPath: string;
  baseSha: string | null;
  headSha: string;
  changeType: PrFileChangeType;
}) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestFileContents(input),
    queryFn: () => trpc.pullRequests.getFileContents.query(input),
    staleTime: Infinity,
  });
}

function pullRequestReviewThreadsQueryOptions(pr: SelectedPullRequest) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestReviewThreads(pr),
    queryFn: () =>
      trpc.reviewComments.listThreads.query({
        providerId: pr.providerId,
        repoKey: pr.repoKey,
        number: pr.number,
        headSha: pr.headSha,
      }),
  });
}

function pullRequestPendingReviewQueryOptions(pr: SelectedPullRequest) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestPendingReview(pr),
    queryFn: (): Promise<PendingReviewState> =>
      trpc.reviewComments.listPending.query({
        providerId: pr.providerId,
        repoKey: pr.repoKey,
        number: pr.number,
        headSha: pr.headSha,
      }),
  });
}

function pullRequestApprovalStateQueryOptions(pr: SelectedPullRequest) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestApprovalState(pr),
    queryFn: (): Promise<PullRequestApprovalState> =>
      trpc.reviewComments.getApprovalState.query({
        providerId: pr.providerId,
        repoKey: pr.repoKey,
        number: pr.number,
        headSha: pr.headSha,
      }),
  });
}

async function createPendingReviewThread(input: CreatePendingReviewThreadInput) {
  await trpc.reviewComments.createPendingThread.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    headSha: input.headSha,
    body: input.body,
    path: input.path,
    oldPath: input.oldPath,
    newPath: input.newPath,
    line: input.line,
    side: input.side,
    startLine: input.startLine,
    startSide: input.startSide,
    subjectType: input.subjectType,
  });
}

async function createPendingReviewReply(input: CreatePendingReviewReplyInput) {
  await trpc.reviewComments.createPendingReply.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    headSha: input.headSha,
    threadId: input.threadId,
    body: input.body,
    path: input.path,
    line: input.line,
    side: input.side,
    startLine: input.startLine,
    startSide: input.startSide,
    subjectType: input.subjectType,
  });
}

async function createPendingReviewGlobal(input: CreatePendingReviewGlobalInput) {
  await trpc.reviewComments.createPendingGlobal.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    headSha: input.headSha,
    body: input.body,
  });
}

async function updatePendingReviewComment(input: UpdatePendingReviewCommentInput) {
  await trpc.reviewComments.updatePending.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    headSha: input.headSha,
    pendingCommentId: input.pendingCommentId,
    body: input.body,
  });
}

async function deletePendingReviewComment(input: DeletePendingReviewCommentInput) {
  await trpc.reviewComments.deletePending.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    headSha: input.headSha,
    pendingCommentId: input.pendingCommentId,
  });
}

async function publishPendingReview(input: PublishPendingReviewInput) {
  await trpc.reviewComments.publishPendingReview.mutate({
    action: input.action,
    headSha: input.headSha,
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    summary: input.summary,
  });
}

async function discardPendingReview(input: DiscardPendingReviewInput) {
  await trpc.reviewComments.discardPendingReview.mutate({
    headSha: input.headSha,
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
  });
}

async function createPullRequestReviewComment(input: CreatePullRequestReviewCommentInput) {
  await trpc.reviewComments.create.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    body: input.body,
    path: input.path,
    oldPath: input.oldPath,
    newPath: input.newPath,
    line: input.line,
    side: input.side,
    startLine: input.startLine,
    startSide: input.startSide,
    subjectType: input.subjectType,
  });
}

async function replyToPullRequestReviewComment(input: ReplyToPullRequestReviewCommentInput) {
  await trpc.reviewComments.reply.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    threadId: input.threadId,
    body: input.body,
  });
}

async function updatePullRequestReviewComment(input: UpdatePullRequestReviewCommentInput) {
  await trpc.reviewComments.update.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    threadId: input.threadId,
    commentId: input.commentId,
    body: input.body,
    subjectType: input.subjectType,
  });
}

async function setPullRequestReviewThreadResolved(input: SetPullRequestReviewThreadResolvedInput) {
  await trpc.reviewComments.setResolved.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    threadId: input.threadId,
    isResolved: input.isResolved,
  });
}

async function deletePullRequestReviewComment(input: DeletePullRequestReviewCommentInput) {
  await trpc.reviewComments.deleteComment.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    threadId: input.threadId,
    commentId: input.commentId,
    subjectType: input.subjectType,
  });
}

async function approvePullRequest(input: SelectedPullRequest) {
  await trpc.reviewComments.approve.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    headSha: input.headSha,
  });
}

async function removePullRequestApproval(input: SelectedPullRequest) {
  await trpc.reviewComments.removeApproval.mutate({
    providerId: input.providerId,
    repoKey: input.repoKey,
    number: input.number,
    headSha: input.headSha,
  });
}

export {
  accountVisibilityQueryOptions,
  appearanceBackgroundQueryOptions,
  createPendingReviewGlobal,
  createPendingReviewReply,
  createPendingReviewThread,
  createPullRequestReviewComment,
  deletePullRequestReviewComment,
  deletePendingReviewComment,
  diffDataSettingsQueryOptions,
  discardPendingReview,
  forgeKeys,
  initialReposQueryOptions,
  providerProfileQueryOptions,
  providerAccountsQueryOptions,
  providerStatusesQueryOptions,
  pullRequestFileContentsQueryOptions,
  pullRequestCachedListQueryOptions,
  pullRequestFilesQueryOptions,
  pullRequestListQueryOptions,
  pullRequestSearchQueryOptions,
  pullRequestOverviewQueryOptions,
  pullRequestPatchQueryOptions,
  pullRequestApprovalStateQueryOptions,
  pullRequestPendingReviewQueryOptions,
  pullRequestQualityReportQueryOptions,
  pullRequestReviewThreadsQueryOptions,
  publishPendingReview,
  approvePullRequest,
  removePullRequestApproval,
  trackedPullRequestListQueryOptions,
  trackedReposQueryOptions,
  replyToPullRequestReviewComment,
  reviewEditorSettingsQueryOptions,
  savedReposQueryOptions,
  searchNamespacesQueryOptions,
  searchReposQueryOptions,
  setPullRequestReviewThreadResolved,
  setAccountVisibility,
  setAppearanceBackground,
  setDiffDataMode,
  setTrackedPullRequestOrder,
  setThemePreference,
  setReviewEditorDefaultMode,
  selectCustomBackgroundFile,
  themePreferenceQueryOptions,
  trackedPullRequestOrderQueryOptions,
  updatePendingReviewComment,
  updatePullRequestReviewComment,
  viewerLoginQueryOptions,
};
