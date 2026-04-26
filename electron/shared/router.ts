import type { BrowserWindow } from "electron";
import { initTRPC, TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { Effect } from "effect";
import { runtime } from "../backend/runtime";
import { BackendError, getErrorMessage } from "../backend/errors";
import { PullRequestService } from "../backend/services/pull-requests";
import { RepoService } from "../backend/services/repos";
import { ReviewCommentService } from "../backend/services/review-comments";
import { TrackedPullRequestService } from "../backend/services/tracked-pull-requests";
import {
  checkForUpdate,
  installUpdate,
  subscribeToUpdateEvents,
} from "../main/updater";
import {
  createPullRequestReviewCommentInputSchema,
  forgeProviderKindSchema,
  providerHostLimitSchema,
  pullRequestInputSchema,
  pullRequestSummarySchema,
  pullRequestVersionedInputSchema,
  replyToPullRequestReviewCommentInputSchema,
  repoIdSchema,
  repoSummarySchema,
  updatePullRequestReviewCommentInputSchema,
} from "../backend/schemas";
import { z } from "zod";
import { app } from "electron";
import type { UpdateEvent } from "./types";

type Context = {
  getWindow(): BrowserWindow | null;
};

const t = initTRPC.context<Context>().create();

function mapError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  if (error instanceof BackendError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: getErrorMessage(error),
  });
}

async function runEffect<A, E, R>(effect: Effect.Effect<A, E, R>) {
  try {
    return await runtime.runPromise(effect as Effect.Effect<A, E, never>);
  } catch (error) {
    throw mapError(error);
  }
}

const router = t.router({
  preflight: t.router({
    getCliStatuses: t.procedure
      .input(z.object({ gitlabHost: z.string().optional() }))
      .query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* RepoService;
            return yield* service.getCliStatuses(input.gitlabHost);
          }),
        ),
      ),
  }),

  repos: t.router({
    listInitial: t.procedure.input(providerHostLimitSchema).query(({ input }) =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.listInitialRepos(input.provider, input.host, input.limit);
        }),
      ),
    ),
    search: t.procedure
      .input(
        providerHostLimitSchema.extend({
          query: z.string(),
        }),
      )
      .query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* RepoService;
            return yield* service.searchRepos(
              input.provider,
              input.host,
              input.query,
              input.limit,
            );
          }),
        ),
      ),
    validate: t.procedure
      .input(
        z.object({
          provider: forgeProviderKindSchema.optional(),
          host: z.string().optional(),
          repo: z.string(),
        }),
      )
      .query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* RepoService;
            return yield* service.validateRepo(input.provider, input.host, input.repo);
          }),
        ),
      ),
    listSaved: t.procedure.query(() =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.listSavedRepos();
        }),
      ),
    ),
    save: t.procedure
      .input(z.object({ repo: repoSummarySchema }))
      .mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* RepoService;
            return yield* service.saveRepo(input.repo);
          }),
        ),
      ),
  }),

  pullRequests: t.router({
    listCached: t.procedure.input(repoIdSchema).query(({ input }) =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* PullRequestService;
          return yield* service.listCached(input.repoId);
        }),
      ),
    ),
    list: t.procedure.input(repoIdSchema).query(({ input }) =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* PullRequestService;
          return yield* service.list(input.repoId);
        }),
      ),
    ),
    getPatch: t.procedure.input(pullRequestVersionedInputSchema).query(({ input }) =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* PullRequestService;
          return yield* service.getPatch(input.repoId, input.number, input.headSha);
        }),
      ),
    ),
    listChangedFiles: t.procedure
      .input(pullRequestVersionedInputSchema)
      .query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* PullRequestService;
            return yield* service.listChangedFiles(
              input.repoId,
              input.number,
              input.headSha,
            );
          }),
        ),
      ),
  }),

  tracked: t.router({
    list: t.procedure.input(repoIdSchema).query(({ input }) =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* TrackedPullRequestService;
          return yield* service.list(input.repoId);
        }),
      ),
    ),
    track: t.procedure
      .input(z.object({ repoId: z.string(), pullRequest: pullRequestSummarySchema }))
      .mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* TrackedPullRequestService;
            return yield* service.track(input.repoId, input.pullRequest);
          }),
        ),
      ),
    remove: t.procedure.input(pullRequestInputSchema).mutation(({ input }) =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* TrackedPullRequestService;
          return yield* service.remove(input.repoId, input.number);
        }),
      ),
    ),
    refresh: t.procedure.input(repoIdSchema).mutation(({ input }) =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* TrackedPullRequestService;
          return yield* service.refresh(input.repoId);
        }),
      ),
    ),
  }),

  reviewComments: t.router({
    getViewerLogin: t.procedure
      .input(
        z.object({
          provider: forgeProviderKindSchema.optional(),
          host: z.string().optional(),
        }),
      )
      .query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.getViewerLogin(input.provider, input.host);
          }),
        ),
      ),
    listThreads: t.procedure.input(pullRequestInputSchema).query(({ input }) =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* ReviewCommentService;
          return yield* service.listThreads(input.repoId, input.number);
        }),
      ),
    ),
    create: t.procedure
      .input(createPullRequestReviewCommentInputSchema)
      .mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.create(input);
          }),
        ),
      ),
    reply: t.procedure
      .input(replyToPullRequestReviewCommentInputSchema)
      .mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.reply(input);
          }),
        ),
      ),
    update: t.procedure
      .input(updatePullRequestReviewCommentInputSchema)
      .mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.update(input);
          }),
        ),
      ),
  }),

  window: t.router({
    toggleMaximize: t.procedure.mutation(({ ctx }) => {
      const currentWindow = ctx.getWindow();
      if (!currentWindow) return;
      if (currentWindow.isMaximized()) currentWindow.unmaximize();
      else currentWindow.maximize();
    }),
  }),

  updates: t.router({
    getCurrentVersion: t.procedure.query(() => app.getVersion()),
    check: t.procedure.query(async () => {
      try {
        return await checkForUpdate();
      } catch (error) {
        throw mapError(error);
      }
    }),
    install: t.procedure.mutation(async () => {
      try {
        await installUpdate();
      } catch (error) {
        throw mapError(error);
      }
    }),
    events: t.procedure.subscription(() =>
      observable<UpdateEvent>((emit) => {
        const unsubscribe = subscribeToUpdateEvents((event) => emit.next(event));
        return unsubscribe;
      }),
    ),
  }),
});

type AppRouter = typeof router;

export { router };
export type { AppRouter };
