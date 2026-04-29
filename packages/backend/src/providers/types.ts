import type { HttpClient } from '@effect/platform';
import type { Effect } from 'effect';
import type { ProviderError } from '../errors.ts';
import type { RepoIdentity } from '../repo-id.ts';
import type { AuthTokenStore } from '../auth/token-store.ts';
import type {
  PullRequestSummary,
  OverviewPullRequestSummary,
  PullRequestApprovalState,
  PullRequestQualityReport,
  ProviderAuthStatus,
  PrChangedFile,
  RepoSummary,
  ReviewThread,
} from '@code-review-app/shared';

type ReviewThreadInput = {
  body: string;
  path: string;
  oldPath: string;
  newPath: string;
  line: number | null;
  side: string | null;
  startLine: number | null;
  startSide: string | null;
  subjectType: 'file' | 'line' | 'global';
};

type PullRequestRefs = {
  baseSha: string | null;
  headSha: string | null;
};

type PullRequestQualityReportInput = {
  repo: RepoIdentity;
  number: number;
  headSha: string;
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
  authStatus(
    accountId: string,
  ): Effect.Effect<ProviderAuthStatus, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  viewerLogin(
    accountId: string,
  ): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
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
  ): Effect.Effect<
    OverviewPullRequestSummary[],
    ProviderError,
    AuthTokenStore | HttpClient.HttpClient
  >;
  listPullRequests(
    repo: RepoIdentity,
  ): Effect.Effect<PullRequestSummary[], ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  getPullRequest(
    repo: RepoIdentity,
    number: number,
  ): Effect.Effect<PullRequestSummary, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  getPullRequestApprovalState(
    repo: RepoIdentity,
    number: number,
  ): Effect.Effect<PullRequestApprovalState, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  approvePullRequest(
    repo: RepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<void, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  removePullRequestApproval(
    repo: RepoIdentity,
    number: number,
  ): Effect.Effect<void, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  fetchPatch(
    repo: RepoIdentity,
    number: number,
  ): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  fetchChangedFiles(
    repo: RepoIdentity,
    number: number,
  ): Effect.Effect<PrChangedFile[], ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  fetchPullRequestRefs(
    repo: RepoIdentity,
    number: number,
  ): Effect.Effect<PullRequestRefs, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  fetchFileContent(
    repo: RepoIdentity,
    path: string,
    ref: string,
  ): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  getPullRequestQualityReport(
    input: PullRequestQualityReportInput,
  ): Effect.Effect<PullRequestQualityReport, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  gitRemote(
    repo: RepoIdentity,
  ): Effect.Effect<GitRemoteSpec, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  listReviewThreads(
    repo: RepoIdentity,
    number: number,
  ): Effect.Effect<ReviewThread[], ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  createReviewThread(
    repo: RepoIdentity,
    number: number,
    input: ReviewThreadInput,
  ): Effect.Effect<void, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  replyToReviewThread(
    repo: RepoIdentity,
    number: number,
    threadId: string,
    body: string,
  ): Effect.Effect<void, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
  updateReviewComment(
    repo: RepoIdentity,
    number: number,
    threadId: string,
    commentId: string,
    body: string,
    subjectType: ReviewThreadInput['subjectType'],
  ): Effect.Effect<void, ProviderError, AuthTokenStore | HttpClient.HttpClient>;
};

export type {
  ForgeProvider,
  GitRemoteAuth,
  GitRemoteSpec,
  PullRequestQualityReportInput,
  PullRequestRefs,
  ReviewThreadInput,
};
