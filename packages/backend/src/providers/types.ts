import type { Effect } from 'effect';
import type { ProviderError } from '../errors.ts';
import type { ProviderRepoIdentity } from '../repo-id.ts';
import type {
  PullRequestSummary,
  OverviewPullRequestSummary,
  PullRequestApprovalState,
  PullRequestSearchState,
  PullRequestQualityReport,
  ProviderAuthStatus,
  PrChangedFile,
  RepoSummary,
  PendingReviewComment,
  PendingReviewSession,
  ReviewThread,
  PublishPendingReviewInput,
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
  repo: ProviderRepoIdentity;
  number: number;
  headSha: string;
};

type PendingReviewSessionResult = {
  providerReviewId: string | null;
};

type PendingReviewCommentResult = {
  providerCommentId: string;
  providerThreadId: string | null;
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

type ForgeProviderEffectContract<Dependencies = never, Error = ProviderError> = {
  authStatus(): Effect.Effect<ProviderAuthStatus, Error, Dependencies>;
  viewerLogin(): Effect.Effect<string, Error, Dependencies>;
  listInitialRepos(limit: number): Effect.Effect<RepoSummary[], Error, Dependencies>;
  searchRepos(query: string, limit: number): Effect.Effect<RepoSummary[], Error, Dependencies>;
  validateRepo(input: string): Effect.Effect<RepoSummary, Error, Dependencies>;
  listOverviewPullRequests(): Effect.Effect<OverviewPullRequestSummary[], Error, Dependencies>;
  searchPullRequests(
    query: string,
    limit: number,
    states: PullRequestSearchState,
  ): Effect.Effect<OverviewPullRequestSummary[], Error, Dependencies>;
  listPullRequests(
    repo: ProviderRepoIdentity,
  ): Effect.Effect<PullRequestSummary[], Error, Dependencies>;
  getPullRequest(
    repo: ProviderRepoIdentity,
    number: number,
  ): Effect.Effect<PullRequestSummary, Error, Dependencies>;
  getPullRequestApprovalState(
    repo: ProviderRepoIdentity,
    number: number,
  ): Effect.Effect<PullRequestApprovalState, Error, Dependencies>;
  approvePullRequest(
    repo: ProviderRepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<void, Error, Dependencies>;
  removePullRequestApproval(
    repo: ProviderRepoIdentity,
    number: number,
  ): Effect.Effect<void, Error, Dependencies>;
  fetchPatch(
    repo: ProviderRepoIdentity,
    number: number,
  ): Effect.Effect<string, Error, Dependencies>;
  fetchChangedFiles(
    repo: ProviderRepoIdentity,
    number: number,
  ): Effect.Effect<PrChangedFile[], Error, Dependencies>;
  fetchPullRequestRefs(
    repo: ProviderRepoIdentity,
    number: number,
  ): Effect.Effect<PullRequestRefs, Error, Dependencies>;
  fetchFileContent(
    repo: ProviderRepoIdentity,
    path: string,
    ref: string,
  ): Effect.Effect<string, Error, Dependencies>;
  getPullRequestQualityReport(
    input: PullRequestQualityReportInput,
  ): Effect.Effect<PullRequestQualityReport, Error, Dependencies>;
  gitRemote(repo: ProviderRepoIdentity): Effect.Effect<GitRemoteSpec, Error, Dependencies>;
  listReviewThreads(
    repo: ProviderRepoIdentity,
    number: number,
  ): Effect.Effect<ReviewThread[], Error, Dependencies>;
  listPendingReview(
    repo: ProviderRepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<
    { session: PendingReviewSession | null; comments: PendingReviewComment[] },
    Error,
    Dependencies
  >;
  createReviewThread(
    repo: ProviderRepoIdentity,
    number: number,
    input: ReviewThreadInput,
  ): Effect.Effect<void, Error, Dependencies>;
  ensurePendingReview(
    repo: ProviderRepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<PendingReviewSessionResult, Error, Dependencies>;
  createPendingReviewThread(
    repo: ProviderRepoIdentity,
    number: number,
    session: PendingReviewSession,
    input: ReviewThreadInput,
  ): Effect.Effect<PendingReviewCommentResult, Error, Dependencies>;
  createPendingReviewReply(
    repo: ProviderRepoIdentity,
    number: number,
    session: PendingReviewSession,
    threadId: string,
    body: string,
  ): Effect.Effect<PendingReviewCommentResult, Error, Dependencies>;
  createPendingGlobalComment(
    repo: ProviderRepoIdentity,
    number: number,
    session: PendingReviewSession,
    body: string,
  ): Effect.Effect<PendingReviewCommentResult, Error, Dependencies>;
  updatePendingReviewComment(
    repo: ProviderRepoIdentity,
    number: number,
    providerCommentId: string,
    body: string,
  ): Effect.Effect<PendingReviewCommentResult, Error, Dependencies>;
  deletePendingReviewComment(
    repo: ProviderRepoIdentity,
    number: number,
    providerCommentId: string,
  ): Effect.Effect<void, Error, Dependencies>;
  publishPendingReview(
    repo: ProviderRepoIdentity,
    number: number,
    session: PendingReviewSession,
    input: PublishPendingReviewInput,
  ): Effect.Effect<void, Error, Dependencies>;
  discardPendingReview(
    repo: ProviderRepoIdentity,
    number: number,
    session: PendingReviewSession,
    comments: PendingReviewComment[],
  ): Effect.Effect<void, Error, Dependencies>;
  replyToReviewThread(
    repo: ProviderRepoIdentity,
    number: number,
    threadId: string,
    body: string,
  ): Effect.Effect<void, Error, Dependencies>;
  setReviewThreadResolved(
    repo: ProviderRepoIdentity,
    number: number,
    threadId: string,
    isResolved: boolean,
  ): Effect.Effect<void, Error, Dependencies>;
  updateReviewComment(
    repo: ProviderRepoIdentity,
    number: number,
    threadId: string,
    commentId: string,
    body: string,
    subjectType: ReviewThreadInput['subjectType'],
  ): Effect.Effect<void, Error, Dependencies>;
  deleteReviewComment(
    repo: ProviderRepoIdentity,
    number: number,
    threadId: string,
    commentId: string,
    subjectType: ReviewThreadInput['subjectType'],
  ): Effect.Effect<void, Error, Dependencies>;
};

type RemoveProviderDependencies<T> = {
  [K in keyof T]: T[K] extends (
    ...args: infer A
  ) => Effect.Effect<infer Success, infer Error, infer _Dependencies>
    ? (...args: A) => Effect.Effect<Success, Error>
    : T[K];
};

type ForgeProviderContract = RemoveProviderDependencies<ForgeProviderEffectContract>;

export type {
  ForgeProviderContract,
  ForgeProviderEffectContract,
  GitRemoteAuth,
  GitRemoteSpec,
  RemoveProviderDependencies,
  PullRequestQualityReportInput,
  PendingReviewCommentResult,
  PendingReviewSessionResult,
  PullRequestRefs,
  ReviewThreadInput,
};
