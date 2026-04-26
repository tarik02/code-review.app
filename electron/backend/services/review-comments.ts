import { Effect, Layer } from "effect";
import { normalizeHost, parseProviderKind, parseRepoId } from "../repo-id";
import { providerFor } from "../providers/registry";
import type {
  CreatePullRequestReviewCommentInput,
  ForgeProviderKind,
  ReplyToPullRequestReviewCommentInput,
  ReviewThread,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
} from "../../shared/types";

type ReviewCommentServiceShape = {
  getViewerLogin(
    provider?: ForgeProviderKind,
    host?: string,
  ): Effect.Effect<ViewerLogin, Error>;
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

function defaultHost(provider: ForgeProviderKind, host?: string) {
  return normalizeHost(host ?? (provider === "github" ? "github.com" : "gitlab.com"));
}

function createReviewCommentService(): ReviewCommentServiceShape {
  return {
    getViewerLogin: (providerInput, hostInput) =>
      Effect.gen(function* () {
        const provider = parseProviderKind(providerInput ?? "github");
        const login = yield* providerFor(provider).viewerLogin(defaultHost(provider, hostInput));
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
