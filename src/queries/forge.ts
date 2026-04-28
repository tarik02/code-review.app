import { queryOptions } from "@tanstack/react-query";
import { trpc } from "../lib/trpc";
import type {
  AccountVisibilitySettings,
  AppearanceBackgroundInput,
  AppearanceBackgroundSettings,
  CreatePullRequestReviewCommentInput,
  DiffDataMode,
  DiffDataSettings,
  PrFileChangeType,
  ProviderProfile,
  ReplyToPullRequestReviewCommentInput,
  SelectedPullRequest,
  UpdatePullRequestReviewCommentInput,
} from "../types/forge";

const INITIAL_REPO_LIMIT = 5;
const SEARCH_REPO_LIMIT = 20;

const forgeKeys = {
  all: ["forge"] as const,
  auth: () => [...forgeKeys.all, "auth"] as const,
  settings: () => [...forgeKeys.all, "settings"] as const,
  repos: () => [...forgeKeys.all, "repos"] as const,
  providerAccounts: () => [...forgeKeys.auth(), "provider-accounts"] as const,
  providerStatuses: () => [...forgeKeys.auth(), "provider-statuses"] as const,
  providerProfile: (accountId: string) =>
    [...forgeKeys.auth(), "provider-profile", accountId] as const,
  accountVisibility: () => [...forgeKeys.auth(), "account-visibility"] as const,
  appearanceBackground: () =>
    [...forgeKeys.settings(), "appearance-background"] as const,
  diffDataSettings: () => [...forgeKeys.settings(), "diff-data"] as const,
  savedRepos: () => [...forgeKeys.repos(), "saved"] as const,
  initialRepos: (accountId: string) =>
    [...forgeKeys.repos(), "initial", accountId] as const,
  searchRepos: (accountId: string, query: string) =>
    [...forgeKeys.repos(), "search", accountId, query] as const,
  viewerLogin: (accountId: string) =>
    [...forgeKeys.repos(), "viewer-login", accountId] as const,
  pullRequests: () => [...forgeKeys.all, "pull-requests"] as const,
  pullRequestOverview: (accountId: string) =>
    [...forgeKeys.pullRequests(), "overview", accountId] as const,
  pullRequestList: (repoId: string) => [...forgeKeys.pullRequests(), "list", repoId] as const,
  pullRequestCachedList: (repoId: string) =>
    [...forgeKeys.pullRequests(), "list", repoId, "cached"] as const,
  trackedPullRequests: () => [...forgeKeys.pullRequests(), "tracked"] as const,
  trackedPullRequestList: (repoId: string) =>
    [...forgeKeys.trackedPullRequests(), "list", repoId] as const,
  pullRequestPatch: (pr: SelectedPullRequest) =>
    [...forgeKeys.pullRequests(), "patch", pr.repoId, pr.number, pr.headSha] as const,
  pullRequestFiles: (pr: SelectedPullRequest) =>
    [...forgeKeys.pullRequests(), "files", pr.repoId, pr.number, pr.headSha] as const,
  pullRequestFileContents: (input: {
    repoId: string;
    number: number;
    oldPath: string;
    newPath: string;
    baseSha: string | null;
    headSha: string;
    changeType: PrFileChangeType;
  }) =>
    [
      ...forgeKeys.pullRequests(),
      "file-contents",
      input.repoId,
      input.number,
      input.oldPath,
      input.newPath,
      input.baseSha,
      input.headSha,
      input.changeType,
    ] as const,
  pullRequestReviewThreads: (pr: SelectedPullRequest) =>
    [...forgeKeys.pullRequests(), "review-threads", pr.repoId, pr.number, pr.headSha] as const,
  pullRequestPatchIdle: () => [...forgeKeys.pullRequests(), "patch", "idle"] as const,
  pullRequestFilesIdle: () => [...forgeKeys.pullRequests(), "files", "idle"] as const,
  pullRequestReviewThreadsIdle: () =>
    [...forgeKeys.pullRequests(), "review-threads", "idle"] as const,
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

async function setAccountVisibility(enabledAccountIds: string[]) {
  return trpc.settings.setAccountVisibility.mutate({ enabledAccountIds });
}

async function setAppearanceBackground(input: AppearanceBackgroundInput) {
  return trpc.settings.setAppearanceBackground.mutate(input);
}

async function setDiffDataMode(mode: DiffDataMode) {
  return trpc.settings.setDiffDataSettings.mutate({ mode });
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

function searchReposQueryOptions(
  query: string,
  accountId: string,
  provider: string,
) {
  return queryOptions({
    queryKey: forgeKeys.searchRepos(accountId, query),
    queryFn: async () => {
      const trimmedQuery = query.trim();
      if (provider === "gitlab" && trimmedQuery.includes("/")) {
        const repo = await trpc.repos.validate.query({
          accountId,
          repo: trimmedQuery,
        });
        return [repo];
      }

      return trpc.repos.search.query({
        accountId,
        query,
        limit: SEARCH_REPO_LIMIT,
      });
    },
    staleTime: 5 * 60 * 1000,
  });
}

function pullRequestCachedListQueryOptions(repoId: string) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestCachedList(repoId),
    queryFn: () => trpc.pullRequests.listCached.query({ repoId }),
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

function pullRequestListQueryOptions(repoId: string) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestList(repoId),
    queryFn: () => trpc.pullRequests.list.query({ repoId }),
    staleTime: 0,
  });
}

function trackedPullRequestListQueryOptions(repoId: string) {
  return queryOptions({
    queryKey: forgeKeys.trackedPullRequestList(repoId),
    queryFn: () => trpc.tracked.list.query({ repoId }),
    staleTime: Infinity,
  });
}

function pullRequestPatchQueryOptions(pr: SelectedPullRequest) {
  return queryOptions({
    queryKey: forgeKeys.pullRequestPatch(pr),
    queryFn: () =>
      trpc.pullRequests.getPatch.query({
        repoId: pr.repoId,
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
        repoId: pr.repoId,
        number: pr.number,
        headSha: pr.headSha,
      }),
  });
}

function pullRequestFileContentsQueryOptions(input: {
  repoId: string;
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
        repoId: pr.repoId,
        number: pr.number,
      }),
  });
}

async function createPullRequestReviewComment(
  input: CreatePullRequestReviewCommentInput,
) {
  await trpc.reviewComments.create.mutate({
    repoId: input.repoId,
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

async function replyToPullRequestReviewComment(
  input: ReplyToPullRequestReviewCommentInput,
) {
  await trpc.reviewComments.reply.mutate({
    repoId: input.repoId,
    number: input.number,
    threadId: input.threadId,
    body: input.body,
  });
}

async function updatePullRequestReviewComment(
  input: UpdatePullRequestReviewCommentInput,
) {
  await trpc.reviewComments.update.mutate({
    repoId: input.repoId,
    number: input.number,
    threadId: input.threadId,
    commentId: input.commentId,
    body: input.body,
  });
}

export {
  accountVisibilityQueryOptions,
  appearanceBackgroundQueryOptions,
  createPullRequestReviewComment,
  diffDataSettingsQueryOptions,
  forgeKeys,
  initialReposQueryOptions,
  providerProfileQueryOptions,
  providerAccountsQueryOptions,
  providerStatusesQueryOptions,
  pullRequestFileContentsQueryOptions,
  pullRequestCachedListQueryOptions,
  pullRequestFilesQueryOptions,
  pullRequestListQueryOptions,
  pullRequestOverviewQueryOptions,
  pullRequestPatchQueryOptions,
  pullRequestReviewThreadsQueryOptions,
  trackedPullRequestListQueryOptions,
  replyToPullRequestReviewComment,
  savedReposQueryOptions,
  searchReposQueryOptions,
  setAccountVisibility,
  setAppearanceBackground,
  setDiffDataMode,
  selectCustomBackgroundFile,
  updatePullRequestReviewComment,
  viewerLoginQueryOptions,
};
