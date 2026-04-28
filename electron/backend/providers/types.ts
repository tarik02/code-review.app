import type { HttpClient } from "@effect/platform";
import type { Effect } from "effect";
import type { ProviderError } from "../errors";
import type { RepoId } from "../repo-id";
import type { AuthTokenStore } from "../auth/token-store";
import type {
  PullRequestSummary,
  OverviewPullRequestSummary,
  ProviderAuthStatus,
  PrChangedFile,
  RepoSummary,
  ReviewThread,
} from "../../shared/types";

type ReviewThreadInput = {
  body: string;
  path: string;
  oldPath: string;
  newPath: string;
  line: number | null;
  side: string | null;
  startLine: number | null;
  startSide: string | null;
  subjectType: "file" | "line";
};

type PullRequestRefs = {
  baseSha: string | null;
  headSha: string | null;
};

type GitRemoteAuth = {
  envConfig: Array<{ key: string; value: string }>;
  askPass?: {
    username: string;
    password: string;
  };
};

type GitRemoteSpec = {
  url: string;
  auth: GitRemoteAuth;
};

type ForgeProvider = {
  authStatus(accountId: string): Effect.Effect<ProviderAuthStatus, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  viewerLogin(accountId: string): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  listInitialRepos(
    accountId: string,
    limit: number,
  ): Effect.Effect<RepoSummary[], ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  searchRepos(
    accountId: string,
    query: string,
    limit: number,
  ): Effect.Effect<RepoSummary[], ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  validateRepo(
    accountId: string,
    input: string,
  ): Effect.Effect<RepoSummary, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  listOverviewPullRequests(
    accountId: string,
  ): Effect.Effect<OverviewPullRequestSummary[], ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  listPullRequests(
    repo: RepoId,
  ): Effect.Effect<PullRequestSummary[], ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  getPullRequest(
    repo: RepoId,
    number: number,
  ): Effect.Effect<PullRequestSummary, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  fetchPatch(
    repo: RepoId,
    number: number,
  ): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  fetchChangedFiles(
    repo: RepoId,
    number: number,
  ): Effect.Effect<PrChangedFile[], ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  fetchPullRequestRefs(
    repo: RepoId,
    number: number,
  ): Effect.Effect<PullRequestRefs, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  fetchFileContent(
    repo: RepoId,
    path: string,
    ref: string,
  ): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  gitRemote(
    repo: RepoId,
  ): Effect.Effect<GitRemoteSpec, ProviderError, AuthTokenStore>;
  listReviewThreads(
    repo: RepoId,
    number: number,
  ): Effect.Effect<ReviewThread[], ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  createReviewThread(
    repo: RepoId,
    number: number,
    input: ReviewThreadInput,
  ): Effect.Effect<void, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  replyToReviewThread(
    repo: RepoId,
    number: number,
    threadId: string,
    body: string,
  ): Effect.Effect<void, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  updateReviewComment(
    repo: RepoId,
    number: number,
    threadId: string,
    commentId: string,
    body: string,
  ): Effect.Effect<void, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
};

export type {
  ForgeProvider,
  GitRemoteAuth,
  GitRemoteSpec,
  PullRequestRefs,
  ReviewThreadInput,
};
