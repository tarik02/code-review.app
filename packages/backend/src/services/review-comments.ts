import { HttpClient } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { createRepoIdentityFromParts } from '../repo-id.ts';
import { providerFor } from '../providers/registry.ts';
import { AuthTokenStore } from '../auth/token-store.ts';
import { CacheService } from '../cache.ts';
import type {
  CreatePendingReviewGlobalInput,
  CreatePendingReviewReplyInput,
  CreatePendingReviewThreadInput,
  CreatePullRequestReviewCommentInput,
  DeletePendingReviewCommentInput,
  DeletePullRequestReviewCommentInput,
  DiscardPendingReviewInput,
  PendingReviewComment,
  PendingReviewSession,
  PendingReviewState,
  PullRequestApprovalState,
  PublishPendingReviewInput,
  ReplyToPullRequestReviewCommentInput,
  RepoIdentity,
  ReviewComment,
  ReviewThread,
  SetPullRequestReviewThreadResolvedInput,
  UpdatePendingReviewCommentInput,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
} from '@code-review-app/shared';

type ReviewCommentServiceShape = {
  getViewerLogin(accountId: string): Effect.Effect<ViewerLogin, Error>;
  getApprovalState(
    repo: RepoIdentity,
    number: number,
  ): Effect.Effect<PullRequestApprovalState, Error>;
  approve(repo: RepoIdentity, number: number, headSha: string): Effect.Effect<void, Error>;
  removeApproval(repo: RepoIdentity, number: number): Effect.Effect<void, Error>;
  listThreads(repo: RepoIdentity, number: number): Effect.Effect<ReviewThread[], Error>;
  listPending(repo: RepoIdentity, number: number): Effect.Effect<PendingReviewState, Error>;
  createPendingThread(input: CreatePendingReviewThreadInput): Effect.Effect<void, Error>;
  createPendingReply(input: CreatePendingReviewReplyInput): Effect.Effect<void, Error>;
  createPendingGlobal(input: CreatePendingReviewGlobalInput): Effect.Effect<void, Error>;
  updatePending(input: UpdatePendingReviewCommentInput): Effect.Effect<void, Error>;
  deletePending(input: DeletePendingReviewCommentInput): Effect.Effect<void, Error>;
  publishPendingReview(input: PublishPendingReviewInput): Effect.Effect<void, Error>;
  discardPendingReview(input: DiscardPendingReviewInput): Effect.Effect<void, Error>;
  create(input: CreatePullRequestReviewCommentInput): Effect.Effect<void, Error>;
  reply(input: ReplyToPullRequestReviewCommentInput): Effect.Effect<void, Error>;
  setResolved(input: SetPullRequestReviewThreadResolvedInput): Effect.Effect<void, Error>;
  update(input: UpdatePullRequestReviewCommentInput): Effect.Effect<void, Error>;
  deleteComment(input: DeletePullRequestReviewCommentInput): Effect.Effect<void, Error>;
};

class ReviewCommentService extends Effect.Tag('ReviewCommentService')<
  ReviewCommentService,
  ReviewCommentServiceShape
>() {}

const makeReviewCommentService = Effect.gen(function* () {
  const tokenStore = yield* AuthTokenStore;
  const httpClient = yield* HttpClient.HttpClient;
  const cache = yield* CacheService;

  const provideProviderDeps = <A, E>(
    effect: Effect.Effect<A, E, AuthTokenStore | HttpClient.HttpClient>,
  ) =>
    effect.pipe(
      Effect.provideService(AuthTokenStore, tokenStore),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );

  const getViewerLogin: ReviewCommentServiceShape['getViewerLogin'] = Effect.fn(
    'ReviewCommentService.getViewerLogin',
  )(function* (accountId) {
    const account = yield* tokenStore.get(accountId);
    if (!account) throw new Error('Provider account is not signed in.');
    const login = yield* provideProviderDeps(providerFor(account.provider).viewerLogin(accountId));
    return { login };
  });

  const getProviderViewerLogin = (repo: ReturnType<typeof createRepoIdentityFromParts>) =>
    provideProviderDeps(providerFor(repo.provider).viewerLogin(repo.accountId)).pipe(
      Effect.catchAll(() => Effect.succeed('You')),
    );

  function pendingCommentId(id: number) {
    return `pending-comment:${id}`;
  }

  function pendingThreadId(id: number) {
    return `pending-thread:${id}`;
  }

  function pendingTimestamp(value: number) {
    return new Date(value * 1000).toISOString();
  }

  function pendingToReviewComment(
    pending: PendingReviewComment,
    viewerLogin: string,
    replyToId: string | null,
  ): ReviewComment {
    return {
      id: pendingCommentId(pending.id),
      databaseId: pending.id,
      authorLogin: viewerLogin,
      authorAvatarUrl: null,
      authorAssociation: null,
      body: pending.body,
      createdAt: pendingTimestamp(pending.createdAt),
      updatedAt: pendingTimestamp(pending.updatedAt),
      url: '',
      replyToId,
      isPending: true,
    };
  }

  function pendingToReviewThread(pending: PendingReviewComment, viewerLogin: string): ReviewThread {
    return {
      id: pendingThreadId(pending.id),
      provider: createRepoIdentityFromParts(pending.providerId, pending.repoKey).provider,
      path: pending.path,
      canResolve: false,
      isResolved: false,
      isOutdated: false,
      line: pending.line,
      startLine: pending.startLine,
      side: pending.side,
      startSide: pending.startSide,
      subjectType: pending.subjectType,
      comments: [pendingToReviewComment(pending, viewerLogin, null)],
      isPending: true,
    };
  }

  function mergePendingThreads(
    repo: ReturnType<typeof createRepoIdentityFromParts>,
    threads: ReviewThread[],
    pendingComments: PendingReviewComment[],
    viewerLogin: string,
  ) {
    const mergedThreads = threads.map((thread) => ({
      ...thread,
      comments: [...thread.comments],
    }));

    for (const pending of pendingComments) {
      if (pending.kind !== 'reply' || !pending.replyToThreadId) {
        mergedThreads.push(pendingToReviewThread(pending, viewerLogin));
        continue;
      }

      const targetThread = mergedThreads.find((thread) => thread.id === pending.replyToThreadId);
      if (!targetThread) {
        mergedThreads.push(pendingToReviewThread(pending, viewerLogin));
        continue;
      }

      const rootCommentId =
        targetThread.comments.find((comment) => comment.replyToId === null)?.id ??
        targetThread.comments[0]?.id ??
        null;
      targetThread.comments.push(pendingToReviewComment(pending, viewerLogin, rootCommentId));
    }

    return mergedThreads.map((thread) =>
      thread.provider === repo.provider
        ? {
            ...thread,
            isPending:
              thread.isPending || thread.comments.some((comment) => comment.isPending === true),
          }
        : thread,
    );
  }

  function findPendingComment(pendingComments: PendingReviewComment[], pendingCommentId: number) {
    return pendingComments.find((comment) => comment.id === pendingCommentId) ?? null;
  }

  function getPendingState(repoInput: RepoIdentity, number: number) {
    return Effect.gen(function* () {
      const [session, comments] = yield* Effect.all([
        cache.getPendingReviewSession(repoInput, number),
        cache.listPendingReviewComments(repoInput, number),
      ]);
      return {
        session,
        comments,
      } satisfies PendingReviewState;
    });
  }

  function ensurePendingSession(
    repoInput: RepoIdentity,
    number: number,
    headSha: string,
    repo: ReturnType<typeof createRepoIdentityFromParts>,
  ): Effect.Effect<PendingReviewSession, Error> {
    return Effect.gen(function* () {
      const existingSession = yield* cache.getPendingReviewSession(repoInput, number);
      if (
        existingSession &&
        (repo.provider !== 'github' || existingSession.providerReviewId !== null)
      ) {
        return existingSession;
      }

      const providerSession = yield* provideProviderDeps(
        providerFor(repo.provider).ensurePendingReview(repo, number, headSha),
      );
      return yield* cache.ensurePendingReviewSession(
        repoInput,
        number,
        existingSession?.headSha ?? headSha,
        providerSession.providerReviewId,
      );
    });
  }

  function cleanupPendingProviderComment(
    repo: ReturnType<typeof createRepoIdentityFromParts>,
    number: number,
    providerCommentId: string,
  ) {
    return provideProviderDeps(
      providerFor(repo.provider).deletePendingReviewComment(repo, number, providerCommentId),
    ).pipe(Effect.catchAll(() => Effect.void));
  }

  const listThreads: ReviewCommentServiceShape['listThreads'] = Effect.fn(
    'ReviewCommentService.listThreads',
  )(function* (repoInput, number) {
    const repo = createRepoIdentityFromParts(repoInput.providerId, repoInput.repoKey);
    const [threads, pendingComments, viewerLogin] = yield* Effect.all([
      provideProviderDeps(providerFor(repo.provider).listReviewThreads(repo, number)),
      cache.listPendingReviewComments(repoInput, number),
      getProviderViewerLogin(repo),
    ]);
    return mergePendingThreads(repo, threads, pendingComments, viewerLogin);
  });

  const listPending: ReviewCommentServiceShape['listPending'] = Effect.fn(
    'ReviewCommentService.listPending',
  )(function* (repoInput, number) {
    return yield* getPendingState(repoInput, number);
  });

  const getApprovalState: ReviewCommentServiceShape['getApprovalState'] = Effect.fn(
    'ReviewCommentService.getApprovalState',
  )(function* (repoInput, number) {
    const repo = createRepoIdentityFromParts(repoInput.providerId, repoInput.repoKey);
    return yield* provideProviderDeps(
      providerFor(repo.provider).getPullRequestApprovalState(repo, number),
    );
  });

  const approve: ReviewCommentServiceShape['approve'] = Effect.fn('ReviewCommentService.approve')(
    function* (repoInput, number, headSha) {
      const repo = createRepoIdentityFromParts(repoInput.providerId, repoInput.repoKey);
      yield* provideProviderDeps(
        providerFor(repo.provider).approvePullRequest(repo, number, headSha),
      );
    },
  );

  const removeApproval: ReviewCommentServiceShape['removeApproval'] = Effect.fn(
    'ReviewCommentService.removeApproval',
  )(function* (repoInput, number) {
    const repo = createRepoIdentityFromParts(repoInput.providerId, repoInput.repoKey);
    yield* provideProviderDeps(providerFor(repo.provider).removePullRequestApproval(repo, number));
  });

  const createPendingThread: ReviewCommentServiceShape['createPendingThread'] = Effect.fn(
    'ReviewCommentService.createPendingThread',
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    const body = input.body.trim();
    if (!body) throw new Error('Comment body is required');

    const session = yield* ensurePendingSession(input, input.number, input.headSha, repo);
    const providerComment = yield* provideProviderDeps(
      providerFor(repo.provider).createPendingReviewThread(repo, input.number, session, {
        body,
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

    yield* cache
      .insertPendingReviewComment(input, input.number, {
        headSha: session.headSha,
        kind: 'thread',
        providerCommentId: providerComment.providerCommentId,
        providerThreadId: providerComment.providerThreadId,
        replyToThreadId: null,
        body,
        path: input.path,
        oldPath: input.oldPath,
        newPath: input.newPath,
        line: input.line,
        side: input.side,
        startLine: input.startLine,
        startSide: input.startSide,
        subjectType: input.subjectType,
      })
      .pipe(
        Effect.catchAll((error) =>
          cleanupPendingProviderComment(repo, input.number, providerComment.providerCommentId).pipe(
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      );
  });

  const createPendingReply: ReviewCommentServiceShape['createPendingReply'] = Effect.fn(
    'ReviewCommentService.createPendingReply',
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    const body = input.body.trim();
    const threadId = input.threadId.trim();
    if (!body) throw new Error('Reply body is required');
    if (!threadId) throw new Error('Thread id is required');

    const providerThreads = yield* provideProviderDeps(
      providerFor(repo.provider).listReviewThreads(repo, input.number),
    ).pipe(Effect.catchAll(() => Effect.succeed([])));
    const targetThread = providerThreads.find((thread) => thread.id === threadId) ?? null;
    const session = yield* ensurePendingSession(input, input.number, input.headSha, repo);
    const providerComment = yield* provideProviderDeps(
      providerFor(repo.provider).createPendingReviewReply(
        repo,
        input.number,
        session,
        threadId,
        body,
      ),
    );

    yield* cache
      .insertPendingReviewComment(input, input.number, {
        headSha: session.headSha,
        kind: 'reply',
        providerCommentId: providerComment.providerCommentId,
        providerThreadId: providerComment.providerThreadId,
        replyToThreadId: threadId,
        body,
        path: targetThread?.path ?? '',
        oldPath: targetThread?.path ?? '',
        newPath: targetThread?.path ?? '',
        line: targetThread?.line ?? null,
        side: targetThread?.side ?? null,
        startLine: targetThread?.startLine ?? null,
        startSide: targetThread?.startSide ?? null,
        subjectType: targetThread?.subjectType ?? 'line',
      })
      .pipe(
        Effect.catchAll((error) =>
          cleanupPendingProviderComment(repo, input.number, providerComment.providerCommentId).pipe(
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      );
  });

  const createPendingGlobal: ReviewCommentServiceShape['createPendingGlobal'] = Effect.fn(
    'ReviewCommentService.createPendingGlobal',
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    const body = input.body.trim();
    if (!body) throw new Error('Comment body is required');
    if (repo.provider === 'github') {
      throw new Error('GitHub global comments cannot be added to pending reviews.');
    }

    const session = yield* ensurePendingSession(input, input.number, input.headSha, repo);
    const providerComment = yield* provideProviderDeps(
      providerFor(repo.provider).createPendingGlobalComment(repo, input.number, session, body),
    );

    yield* cache
      .insertPendingReviewComment(input, input.number, {
        headSha: session.headSha,
        kind: 'global',
        providerCommentId: providerComment.providerCommentId,
        providerThreadId: providerComment.providerThreadId,
        replyToThreadId: null,
        body,
        path: '',
        oldPath: '',
        newPath: '',
        line: null,
        side: null,
        startLine: null,
        startSide: null,
        subjectType: 'global',
      })
      .pipe(
        Effect.catchAll((error) =>
          cleanupPendingProviderComment(repo, input.number, providerComment.providerCommentId).pipe(
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      );
  });

  const updatePending: ReviewCommentServiceShape['updatePending'] = Effect.fn(
    'ReviewCommentService.updatePending',
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    const body = input.body.trim();
    if (!body) throw new Error('Comment body is required');

    const pendingComments = yield* cache.listPendingReviewComments(input, input.number);
    const pendingComment = findPendingComment(pendingComments, input.pendingCommentId);
    if (!pendingComment) throw new Error('Pending comment was not found.');
    if (!pendingComment.providerCommentId) {
      throw new Error('Pending provider comment id is missing.');
    }

    const providerComment = yield* provideProviderDeps(
      providerFor(repo.provider).updatePendingReviewComment(
        repo,
        input.number,
        pendingComment.providerCommentId,
        body,
      ),
    );
    yield* cache.updatePendingReviewComment(
      input,
      input.number,
      input.pendingCommentId,
      body,
      providerComment.providerCommentId,
    );
  });

  const deletePending: ReviewCommentServiceShape['deletePending'] = Effect.fn(
    'ReviewCommentService.deletePending',
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    const pendingComments = yield* cache.listPendingReviewComments(input, input.number);
    const pendingComment = findPendingComment(pendingComments, input.pendingCommentId);
    if (!pendingComment) throw new Error('Pending comment was not found.');
    if (!pendingComment.providerCommentId) {
      throw new Error('Pending provider comment id is missing.');
    }

    yield* provideProviderDeps(
      providerFor(repo.provider).deletePendingReviewComment(
        repo,
        input.number,
        pendingComment.providerCommentId,
      ),
    );
    yield* cache.deletePendingReviewComment(input, input.number, input.pendingCommentId);
  });

  const publishPendingReview: ReviewCommentServiceShape['publishPendingReview'] = Effect.fn(
    'ReviewCommentService.publishPendingReview',
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    const { session, comments } = yield* getPendingState(input, input.number);
    if (!session || comments.length === 0) return;

    yield* provideProviderDeps(
      providerFor(repo.provider).publishPendingReview(repo, input.number, session, input),
    );
    yield* cache.clearPendingReview(input, input.number);
  });

  const discardPendingReview: ReviewCommentServiceShape['discardPendingReview'] = Effect.fn(
    'ReviewCommentService.discardPendingReview',
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    const { session, comments } = yield* getPendingState(input, input.number);
    if (!session) return;

    yield* provideProviderDeps(
      providerFor(repo.provider).discardPendingReview(repo, input.number, session, comments),
    );
    yield* cache.clearPendingReview(input, input.number);
  });

  const create: ReviewCommentServiceShape['create'] = Effect.fn('ReviewCommentService.create')(
    function* (input) {
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
    },
  );

  const reply: ReviewCommentServiceShape['reply'] = Effect.fn('ReviewCommentService.reply')(
    function* (input) {
      const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
      yield* provideProviderDeps(
        providerFor(repo.provider).replyToReviewThread(
          repo,
          input.number,
          input.threadId,
          input.body,
        ),
      );
    },
  );

  const update: ReviewCommentServiceShape['update'] = Effect.fn('ReviewCommentService.update')(
    function* (input) {
      const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
      yield* provideProviderDeps(
        providerFor(repo.provider).updateReviewComment(
          repo,
          input.number,
          input.threadId,
          input.commentId,
          input.body,
          input.subjectType,
        ),
      );
    },
  );

  const setResolved: ReviewCommentServiceShape['setResolved'] = Effect.fn(
    'ReviewCommentService.setResolved',
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    yield* provideProviderDeps(
      providerFor(repo.provider).setReviewThreadResolved(
        repo,
        input.number,
        input.threadId,
        input.isResolved,
      ),
    );
  });

  const deleteComment: ReviewCommentServiceShape['deleteComment'] = Effect.fn(
    'ReviewCommentService.deleteComment',
  )(function* (input) {
    const repo = createRepoIdentityFromParts(input.providerId, input.repoKey);
    yield* provideProviderDeps(
      providerFor(repo.provider).deleteReviewComment(
        repo,
        input.number,
        input.threadId,
        input.commentId,
        input.subjectType,
      ),
    );
  });

  return {
    getViewerLogin,
    getApprovalState,
    approve,
    removeApproval,
    listThreads,
    listPending,
    createPendingThread,
    createPendingReply,
    createPendingGlobal,
    updatePending,
    deletePending,
    publishPendingReview,
    discardPendingReview,
    create,
    reply,
    setResolved,
    update,
    deleteComment,
  } satisfies ReviewCommentServiceShape;
});

const ReviewCommentServiceLive = Layer.effect(ReviewCommentService, makeReviewCommentService);

export { ReviewCommentService, ReviewCommentServiceLive };
