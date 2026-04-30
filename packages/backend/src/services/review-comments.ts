import { Effect, Layer } from 'effect';
import { createProviderRepoIdentityFromParts } from '../repo-id.ts';
import { ForgeProviderRegistry, type AccountScopedForgeProvider } from '../providers/registry.ts';
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
  listThreads(
    repo: RepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<ReviewThread[], Error>;
  listPending(
    repo: RepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<PendingReviewState, Error>;
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
  const providers = yield* ForgeProviderRegistry;

  const getViewerLogin: ReviewCommentServiceShape['getViewerLogin'] = Effect.fn(
    'ReviewCommentService.getViewerLogin',
  )(function* (accountId) {
    const provider = yield* providers.forAccount(accountId);
    const login = yield* provider.viewerLogin();
    return { login };
  });

  const getProviderViewerLogin = (repoInput: RepoIdentity) =>
    providers.forRepo(repoInput).pipe(
      Effect.flatMap(({ provider }) => provider.viewerLogin()),
      Effect.catchAll(() => Effect.succeed('You')),
    );

  function pendingCommentId(id: string) {
    return `pending-comment:${id}`;
  }

  function pendingThreadId(id: string) {
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
      databaseId: null,
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
      provider: createProviderRepoIdentityFromParts(pending.providerId, pending.repoKey).provider,
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
        const targetThread =
          pending.kind === 'reply' && pending.replyToCommentId != null
            ? mergedThreads.find((thread) =>
                thread.comments.some((comment) => comment.databaseId === pending.replyToCommentId),
              )
            : null;
        if (targetThread) {
          const rootCommentId =
            targetThread.comments.find((comment) => comment.replyToId === null)?.id ??
            targetThread.comments[0]?.id ??
            null;
          targetThread.comments.push(pendingToReviewComment(pending, viewerLogin, rootCommentId));
          continue;
        }

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

    return mergedThreads;
  }

  function getPendingState(repoInput: RepoIdentity, number: number, headSha: string) {
    return providers
      .forRepo(repoInput)
      .pipe(
        Effect.flatMap(({ provider, repo }) => provider.listPendingReview(repo, number, headSha)),
      );
  }

  function ensurePendingSession(
    repoInput: RepoIdentity,
    number: number,
    headSha: string,
    provider: AccountScopedForgeProvider,
    repo: ReturnType<typeof createProviderRepoIdentityFromParts>,
  ): Effect.Effect<PendingReviewSession, Error> {
    return Effect.gen(function* () {
      const existingSession = (yield* getPendingState(repoInput, number, headSha)).session;
      if (
        existingSession &&
        (repo.provider !== 'github' || existingSession.providerReviewId !== null)
      ) {
        return existingSession;
      }

      const providerSession = yield* provider.ensurePendingReview(repo, number, headSha);
      const timestamp = Math.floor(Date.now() / 1000);
      return {
        ...repoInput,
        id: 0,
        number,
        headSha,
        providerReviewId: providerSession.providerReviewId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });
  }

  const listThreads: ReviewCommentServiceShape['listThreads'] = Effect.fn(
    'ReviewCommentService.listThreads',
  )(function* (repoInput, number, headSha) {
    const { provider, repo } = yield* providers.forRepo(repoInput);
    const [threads, pendingComments, viewerLogin] = yield* Effect.all([
      provider.listReviewThreads(repo, number),
      getPendingState(repoInput, number, headSha).pipe(Effect.map((state) => state.comments)),
      getProviderViewerLogin(repoInput),
    ]);
    return mergePendingThreads(threads, pendingComments, viewerLogin);
  });

  const listPending: ReviewCommentServiceShape['listPending'] = Effect.fn(
    'ReviewCommentService.listPending',
  )(function* (repoInput, number, headSha) {
    return yield* getPendingState(repoInput, number, headSha);
  });

  const getApprovalState: ReviewCommentServiceShape['getApprovalState'] = Effect.fn(
    'ReviewCommentService.getApprovalState',
  )(function* (repoInput, number) {
    const { provider, repo } = yield* providers.forRepo(repoInput);
    return yield* provider.getPullRequestApprovalState(repo, number);
  });

  const approve: ReviewCommentServiceShape['approve'] = Effect.fn('ReviewCommentService.approve')(
    function* (repoInput, number, headSha) {
      const { provider, repo } = yield* providers.forRepo(repoInput);
      yield* provider.approvePullRequest(repo, number, headSha);
    },
  );

  const removeApproval: ReviewCommentServiceShape['removeApproval'] = Effect.fn(
    'ReviewCommentService.removeApproval',
  )(function* (repoInput, number) {
    const { provider, repo } = yield* providers.forRepo(repoInput);
    yield* provider.removePullRequestApproval(repo, number);
  });

  const createPendingThread: ReviewCommentServiceShape['createPendingThread'] = Effect.fn(
    'ReviewCommentService.createPendingThread',
  )(function* (input) {
    const { provider, repo } = yield* providers.forRepo(input);
    const body = input.body.trim();
    if (!body) throw new Error('Comment body is required');

    const session = yield* ensurePendingSession(input, input.number, input.headSha, provider, repo);
    yield* provider.createPendingReviewThread(repo, input.number, session, {
      body,
      path: input.path,
      oldPath: input.oldPath,
      newPath: input.newPath,
      line: input.line,
      side: input.side,
      startLine: input.startLine,
      startSide: input.startSide,
      subjectType: input.subjectType,
    });
  });

  const createPendingReply: ReviewCommentServiceShape['createPendingReply'] = Effect.fn(
    'ReviewCommentService.createPendingReply',
  )(function* (input) {
    const { provider, repo } = yield* providers.forRepo(input);
    const body = input.body.trim();
    const threadId = input.threadId.trim();
    if (!body) throw new Error('Reply body is required');
    if (!threadId) throw new Error('Thread id is required');

    const session = yield* ensurePendingSession(input, input.number, input.headSha, provider, repo);
    yield* provider.createPendingReviewReply(repo, input.number, session, threadId, body);
  });

  const createPendingGlobal: ReviewCommentServiceShape['createPendingGlobal'] = Effect.fn(
    'ReviewCommentService.createPendingGlobal',
  )(function* (input) {
    const { provider, repo } = yield* providers.forRepo(input);
    const body = input.body.trim();
    if (!body) throw new Error('Comment body is required');
    if (repo.provider === 'github') {
      throw new Error('GitHub global comments cannot be added to pending reviews.');
    }

    const session = yield* ensurePendingSession(input, input.number, input.headSha, provider, repo);
    yield* provider.createPendingGlobalComment(repo, input.number, session, body);
  });

  const updatePending: ReviewCommentServiceShape['updatePending'] = Effect.fn(
    'ReviewCommentService.updatePending',
  )(function* (input) {
    const { provider, repo } = yield* providers.forRepo(input);
    const body = input.body.trim();
    if (!body) throw new Error('Comment body is required');

    yield* provider.updatePendingReviewComment(repo, input.number, input.pendingCommentId, body);
  });

  const deletePending: ReviewCommentServiceShape['deletePending'] = Effect.fn(
    'ReviewCommentService.deletePending',
  )(function* (input) {
    const { provider, repo } = yield* providers.forRepo(input);
    yield* provider.deletePendingReviewComment(repo, input.number, input.pendingCommentId);
  });

  const publishPendingReview: ReviewCommentServiceShape['publishPendingReview'] = Effect.fn(
    'ReviewCommentService.publishPendingReview',
  )(function* (input) {
    const { provider, repo } = yield* providers.forRepo(input);
    const { session, comments } = yield* getPendingState(input, input.number, input.headSha);
    if (!session || comments.length === 0) return;

    yield* provider.publishPendingReview(repo, input.number, session, input);
  });

  const discardPendingReview: ReviewCommentServiceShape['discardPendingReview'] = Effect.fn(
    'ReviewCommentService.discardPendingReview',
  )(function* (input) {
    const { provider, repo } = yield* providers.forRepo(input);
    const { session, comments } = yield* getPendingState(input, input.number, input.headSha);
    if (!session) return;

    yield* provider.discardPendingReview(repo, input.number, session, comments);
  });

  const create: ReviewCommentServiceShape['create'] = Effect.fn('ReviewCommentService.create')(
    function* (input) {
      const { provider, repo } = yield* providers.forRepo(input);
      yield* provider.createReviewThread(repo, input.number, {
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
    },
  );

  const reply: ReviewCommentServiceShape['reply'] = Effect.fn('ReviewCommentService.reply')(
    function* (input) {
      const { provider, repo } = yield* providers.forRepo(input);
      yield* provider.replyToReviewThread(repo, input.number, input.threadId, input.body);
    },
  );

  const update: ReviewCommentServiceShape['update'] = Effect.fn('ReviewCommentService.update')(
    function* (input) {
      const { provider, repo } = yield* providers.forRepo(input);
      yield* provider.updateReviewComment(
        repo,
        input.number,
        input.threadId,
        input.commentId,
        input.body,
        input.subjectType,
      );
    },
  );

  const setResolved: ReviewCommentServiceShape['setResolved'] = Effect.fn(
    'ReviewCommentService.setResolved',
  )(function* (input) {
    const { provider, repo } = yield* providers.forRepo(input);
    yield* provider.setReviewThreadResolved(repo, input.number, input.threadId, input.isResolved);
  });

  const deleteComment: ReviewCommentServiceShape['deleteComment'] = Effect.fn(
    'ReviewCommentService.deleteComment',
  )(function* (input) {
    const { provider, repo } = yield* providers.forRepo(input);
    yield* provider.deleteReviewComment(
      repo,
      input.number,
      input.threadId,
      input.commentId,
      input.subjectType,
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
