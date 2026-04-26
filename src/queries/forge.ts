import { queryOptions } from "@tanstack/react-query";
import { trpc } from "../lib/trpc";
import type {
  CreatePullRequestReviewCommentInput,
  ForgeProviderKind,
  ReplyToPullRequestReviewCommentInput,
  SelectedPullRequest,
  UpdatePullRequestReviewCommentInput,
} from "../types/forge";

const INITIAL_REPO_LIMIT = 5;
const SEARCH_REPO_LIMIT = 20;

const forgeKeys = {
  all: ["forge"] as const,
  repos: () => [...forgeKeys.all, "repos"] as const,
  cliStatuses: (gitlabHost: string) =>
    [...forgeKeys.all, "cli-statuses", gitlabHost] as const,
  savedRepos: () => [...forgeKeys.repos(), "saved"] as const,
  initialRepos: (provider: string, host: string) =>
    [...forgeKeys.repos(), "initial", provider, host] as const,
  searchRepos: (provider: string, host: string, query: string) =>
    [...forgeKeys.repos(), "search", provider, host, query] as const,
  viewerLogin: (provider: string, host: string) =>
    [...forgeKeys.repos(), "viewer-login", provider, host] as const,
  pullRequests: () => [...forgeKeys.all, "pull-requests"] as const,
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

function cliStatusesQueryOptions(gitlabHost: string) {
  return queryOptions({
    queryKey: forgeKeys.cliStatuses(gitlabHost),
    queryFn: () => trpc.preflight.getCliStatuses.query({ gitlabHost }),
    staleTime: 0,
  });
}

function viewerLoginQueryOptions(
  provider: ForgeProviderKind = "github",
  host = "github.com",
) {
  return queryOptions({
    queryKey: forgeKeys.viewerLogin(provider, host),
    queryFn: async () => {
      return trpc.reviewComments.getViewerLogin.query({ provider, host });
    },
    staleTime: 60 * 60 * 1000,
  });
}

function initialReposQueryOptions(
  provider: ForgeProviderKind = "github",
  host = "github.com",
) {
  return queryOptions({
    queryKey: forgeKeys.initialRepos(provider, host),
    queryFn: () =>
      trpc.repos.listInitial.query({
        provider,
        host,
        limit: INITIAL_REPO_LIMIT,
      }),
    staleTime: 5 * 60 * 1000,
  });
}

function searchReposQueryOptions(
  query: string,
  provider: ForgeProviderKind = "github",
  host = "github.com",
) {
  return queryOptions({
    queryKey: forgeKeys.searchRepos(provider, host, query),
    queryFn: async () => {
      const trimmedQuery = query.trim();
      if (provider === "gitlab" && trimmedQuery.includes("/")) {
        const repo = await trpc.repos.validate.query({
          provider,
          host,
          repo: trimmedQuery,
        });
        return [repo];
      }

      return trpc.repos.search.query({
        provider,
        host,
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
  cliStatusesQueryOptions,
  createPullRequestReviewComment,
  forgeKeys,
  initialReposQueryOptions,
  pullRequestCachedListQueryOptions,
  pullRequestFilesQueryOptions,
  pullRequestListQueryOptions,
  pullRequestPatchQueryOptions,
  pullRequestReviewThreadsQueryOptions,
  trackedPullRequestListQueryOptions,
  replyToPullRequestReviewComment,
  savedReposQueryOptions,
  searchReposQueryOptions,
  updatePullRequestReviewComment,
  viewerLoginQueryOptions,
};
