import type { Effect } from "effect";
import type { ProviderError } from "../errors";
import type { RepoId } from "../repo-id";
import type {
  PullRequestSummary,
  ProviderAuthStatus,
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

type ForgeProvider = {
  authStatus(accountId: string): Effect.Effect<ProviderAuthStatus, ProviderError>;
  viewerLogin(accountId: string): Effect.Effect<string, ProviderError>;
  listInitialRepos(
    accountId: string,
    limit: number,
  ): Effect.Effect<RepoSummary[], ProviderError>;
  searchRepos(
    accountId: string,
    query: string,
    limit: number,
  ): Effect.Effect<RepoSummary[], ProviderError>;
  validateRepo(accountId: string, input: string): Effect.Effect<RepoSummary, ProviderError>;
  listPullRequests(repo: RepoId): Effect.Effect<PullRequestSummary[], ProviderError>;
  getPullRequest(
    repo: RepoId,
    number: number,
  ): Effect.Effect<PullRequestSummary, ProviderError>;
  fetchPatch(repo: RepoId, number: number): Effect.Effect<string, ProviderError>;
  fetchChangedFiles(repo: RepoId, number: number): Effect.Effect<string[], ProviderError>;
  listReviewThreads(
    repo: RepoId,
    number: number,
  ): Effect.Effect<ReviewThread[], ProviderError>;
  createReviewThread(
    repo: RepoId,
    number: number,
    input: ReviewThreadInput,
  ): Effect.Effect<void, ProviderError>;
  replyToReviewThread(
    repo: RepoId,
    number: number,
    threadId: string,
    body: string,
  ): Effect.Effect<void, ProviderError>;
  updateReviewComment(
    repo: RepoId,
    number: number,
    threadId: string,
    commentId: string,
    body: string,
  ): Effect.Effect<void, ProviderError>;
};

export type { ForgeProvider, ReviewThreadInput };
