import { HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";
import { createRepoIdentityFromParts } from "../repo-id.ts";
import { providerFor } from "../providers/registry.ts";
import { AuthTokenStore } from "../auth/token-store.ts";
import type {
  CreatePullRequestReviewCommentInput,
  ReplyToPullRequestReviewCommentInput,
  RepoIdentity,
  ReviewThread,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
} from "@code-review-app/shared";

type ReviewCommentServiceShape = {
  getViewerLogin(accountId: string): Effect.Effect<ViewerLogin, Error>;
  listThreads(repo: RepoIdentity, number: number): Effect.Effect<ReviewThread[], Error>;
  create(input: CreatePullRequestReviewCommentInput): Effect.Effect<void, Error>;
  reply(input: ReplyToPullRequestReviewCommentInput): Effect.Effect<void, Error>;
  update(input: UpdatePullRequestReviewCommentInput): Effect.Effect<void, Error>;
};

class ReviewCommentService extends Effect.Tag("ReviewCommentService")<
  ReviewCommentService,
  ReviewCommentServiceShape
>() {}

const makeReviewCommentService = Effect.gen(function* () {
  const tokenStore = yield* AuthTokenStore;
  const httpClient = yield* HttpClient.HttpClient;

  const provideProviderDeps = <A, E>(
    effect: Effect.Effect<A, E, AuthTokenStore | HttpClient.HttpClient>,
  ) =>
    effect.pipe(
      Effect.provideService(AuthTokenStore, tokenStore),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );

  const getViewerLogin: ReviewCommentServiceShape["getViewerLogin"] = Effect.fn(
    "ReviewCommentService.getViewerLogin",
  )(function* (accountId) {
    const account = yield* tokenStore.get(accountId);
    if (!account) throw new Error("Provider account is not signed in.");
    const login = yield* provideProviderDeps(
      providerFor(account.provider).viewerLogin(accountId),
    );
    return { login };
  });

  const listThreads: ReviewCommentServiceShape["listThreads"] = Effect.fn(
    "ReviewCommentService.listThreads",
  )(function* (repoInput, number) {
    const repo = createRepoIdentityFromParts(repoInput.providerId, repoInput.repoKey);
    return yield* provideProviderDeps(
      providerFor(repo.provider).listReviewThreads(repo, number),
    );
  });

  const create: ReviewCommentServiceShape["create"] = Effect.fn(
    "ReviewCommentService.create",
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    yield* provideProviderDeps(
      providerFor(repo.provider).createReviewThread(repo, input.number, {
        body: input.body,
        path: input.path,
        oldPath: input.oldPath,
        newPath: input.newPath,
        line: input.line,
        side: input.side,
        startLine: input.startLine,
        startSide: input.startSide,
        subjectType: input.subjectType,
      }),
    );
  });

  const reply: ReviewCommentServiceShape["reply"] = Effect.fn(
    "ReviewCommentService.reply",
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    yield* provideProviderDeps(
      providerFor(repo.provider).replyToReviewThread(
        repo,
        input.number,
        input.threadId,
        input.body,
      ),
    );
  });

  const update: ReviewCommentServiceShape["update"] = Effect.fn(
    "ReviewCommentService.update",
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    yield* provideProviderDeps(
      providerFor(repo.provider).updateReviewComment(
        repo,
        input.number,
        input.threadId,
        input.commentId,
        input.body,
      ),
    );
  });

  return {
    getViewerLogin,
    listThreads,
    create,
    reply,
    update,
  } satisfies ReviewCommentServiceShape;
});

const ReviewCommentServiceLive = Layer.effect(
  ReviewCommentService,
  makeReviewCommentService,
);

export { ReviewCommentService, ReviewCommentServiceLive };
