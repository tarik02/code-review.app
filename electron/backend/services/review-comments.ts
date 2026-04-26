import { Effect, Layer } from "effect";
import { parseRepoId } from "../repo-id";
import { providerFor } from "../providers/registry";
import { getStoredAuthToken } from "../auth/token-store";
import type {
  CreatePullRequestReviewCommentInput,
  ReplyToPullRequestReviewCommentInput,
  ReviewThread,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
} from "../../shared/types";

type ReviewCommentServiceShape = {
  getViewerLogin(accountId: string): Effect.Effect<ViewerLogin, Error>;
  listThreads(repoId: string, number: number): Effect.Effect<ReviewThread[], Error>;
  create(input: CreatePullRequestReviewCommentInput): Effect.Effect<void, Error>;
  reply(input: ReplyToPullRequestReviewCommentInput): Effect.Effect<void, Error>;
  update(input: UpdatePullRequestReviewCommentInput): Effect.Effect<void, Error>;
};

class ReviewCommentService extends Effect.Tag("ReviewCommentService")<
  ReviewCommentService,
  ReviewCommentServiceShape
>() {
  static Live = Layer.succeed(this, createReviewCommentService());
}

function createReviewCommentService(): ReviewCommentServiceShape {
  return {
    getViewerLogin: (accountId) =>
      Effect.gen(function* () {
        const account = yield* Effect.promise(() => getStoredAuthToken(accountId));
        if (!account) throw new Error("Provider account is not signed in.");
        const login = yield* providerFor(account.provider).viewerLogin(accountId);
        return { login };
      }),

    listThreads: (repoId, number) =>
      Effect.gen(function* () {
        const repo = parseRepoId(repoId);
        return yield* providerFor(repo.provider).listReviewThreads(repo, number);
      }),

    create: (input) =>
      Effect.gen(function* () {
        const repo = parseRepoId(input.repoId);
        yield* providerFor(repo.provider).createReviewThread(repo, input.number, {
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
      }),

    reply: (input) =>
      Effect.gen(function* () {
        const repo = parseRepoId(input.repoId);
        yield* providerFor(repo.provider).replyToReviewThread(
          repo,
          input.number,
          input.threadId,
          input.body,
        );
      }),

    update: (input) =>
      Effect.gen(function* () {
        const repo = parseRepoId(input.repoId);
        yield* providerFor(repo.provider).updateReviewComment(
          repo,
          input.number,
          input.threadId,
          input.commentId,
          input.body,
        );
      }),
  };
}

export { ReviewCommentService };
