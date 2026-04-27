import type { BrowserWindow, OpenDialogOptions } from "electron";
import { initTRPC, TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { Effect } from "effect";
import { runtime } from "../backend/runtime";
import { BackendError, getErrorMessage } from "../backend/errors";
import { PullRequestService } from "../backend/services/pull-requests";
import { RepoService } from "../backend/services/repos";
import { ReviewCommentService } from "../backend/services/review-comments";
import { SettingsService } from "../backend/services/settings";
import { TrackedPullRequestService } from "../backend/services/tracked-pull-requests";
import {
  checkForUpdate,
  installUpdate,
  subscribeToUpdateEvents,
} from "../main/updater";
import {
  completeOAuthSchema,
  accountVisibilitySettingsSchema,
  appearanceBackgroundInputSchema,
  createPullRequestReviewCommentInputSchema,
  providerAccountSchema,
  providerProfileSchema,
  overviewPullRequestSummarySchema,
  providerHostSchema,
  pullRequestFileContentsInputSchema,
  pullRequestInputSchema,
  pullRequestSummarySchema,
  pullRequestVersionedInputSchema,
  replyToPullRequestReviewCommentInputSchema,
  repoIdSchema,
  repoSummarySchema,
  updatePullRequestReviewCommentInputSchema,
} from "../backend/schemas";
import { z } from "zod";
import { app, dialog } from "electron";
import { completeOAuth, pollDeviceOAuth, startOAuth } from "../backend/auth/oauth";
import { AuthTokenStore } from "../backend/auth/token-store";
import {
  getLatestOAuthCallback,
  subscribeToDeepLinks,
  subscribeToOAuthCallbacks,
} from "../main/oauth-callback";
import type { ProviderProfile, UpdateEvent } from "./types";

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
  auth: t.router({
    listProviderAccounts: t.procedure.query(() =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.listProviderAccounts();
        }),
      ),
    ),
    getProviderStatuses: t.procedure.query(() =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.getProviderStatuses();
        }),
      ),
    ),
    getProviderProfile: t.procedure
      .input(providerAccountSchema)
      .query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* RepoService;
            const profile = yield* service.getProviderProfile(input.accountId);
            const parsed: ProviderProfile = providerProfileSchema.parse(profile);
            return parsed;
          }),
        ),
      ),
    startOAuth: t.procedure.input(providerHostSchema).mutation(({ input }) =>
      runEffect(
        startOAuth(
          input.provider,
          input.host,
          input.clientId,
          input.clientSecret,
        ),
      ),
    ),
    pollDeviceOAuth: t.procedure.input(providerAccountSchema).mutation(({ input }) =>
      runEffect(pollDeviceOAuth(input.accountId)),
    ),
    completeOAuth: t.procedure.input(completeOAuthSchema).mutation(async ({ input }) => {
      try {
        const session = await runEffect(completeOAuth(input.code, input.state));
        const statuses = await runEffect(
          Effect.gen(function* () {
            const service = yield* RepoService;
            return yield* service.getProviderStatuses();
          }),
        );
        const status = statuses[session.accountId];
        if (!status) {
          throw new Error("Provider auth status was not returned.");
        }
        return status;
      } catch (error) {
        throw mapError(error);
      }
    }),
    signOut: t.procedure.input(providerAccountSchema).mutation(async ({ input }) => {
      return runEffect(
        Effect.gen(function* () {
          const tokenStore = yield* AuthTokenStore;
          yield* tokenStore.delete(input.accountId);
        }),
      );
    }),
    oauthCallbacks: t.procedure.subscription(() =>
      observable<string>((emit) => {
        const unsubscribe = subscribeToOAuthCallbacks((url) => emit.next(url));
        return unsubscribe;
      }),
    ),
    latestOAuthCallback: t.procedure.query(() => getLatestOAuthCallback()),
  }),

  settings: t.router({
    getAccountVisibility: t.procedure.query(() =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* SettingsService;
          return yield* service.getAccountVisibility();
        }),
      ),
    ),
    setAccountVisibility: t.procedure
      .input(accountVisibilitySettingsSchema)
      .mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* SettingsService;
            return yield* service.setAccountVisibility(input.enabledAccountIds);
          }),
        ),
      ),
    getAppearanceBackground: t.procedure.query(() =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* SettingsService;
          return yield* service.getAppearanceBackground();
        }),
      ),
    ),
    setAppearanceBackground: t.procedure
      .input(appearanceBackgroundInputSchema)
      .mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* SettingsService;
            return yield* service.setAppearanceBackground(input);
          }),
        ),
      ),
    selectCustomBackgroundFile: t.procedure.mutation(async ({ ctx }) => {
      const openDialogOptions = {
        properties: ["openFile"],
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"],
          },
        ],
      } satisfies OpenDialogOptions;
      const window = ctx.getWindow();
      const result = window
        ? await dialog.showOpenDialog(window, openDialogOptions)
        : await dialog.showOpenDialog(openDialogOptions);

      return runEffect(
        Effect.gen(function* () {
          const service = yield* SettingsService;
          if (result.canceled || result.filePaths.length === 0) {
            return yield* service.getAppearanceBackground();
          }

          return yield* service.setCustomBackgroundFromPath(result.filePaths[0]);
        }),
      );
    }),
  }),

  deepLinks: t.router({
    urls: t.procedure.subscription(() =>
      observable<string>((emit) => {
        const unsubscribe = subscribeToDeepLinks((url) => emit.next(url));
        return unsubscribe;
      }),
    ),
  }),

  repos: t.router({
    listInitial: t.procedure
      .input(providerAccountSchema.extend({ limit: z.number().int().positive().optional() }))
      .query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* RepoService;
            return yield* service.listInitialRepos(input.accountId, input.limit);
          }),
        ),
      ),
    search: t.procedure
      .input(
        providerAccountSchema.extend({
          query: z.string(),
          limit: z.number().int().positive().optional(),
        }),
      )
      .query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* RepoService;
            return yield* service.searchRepos(input.accountId, input.query, input.limit);
          }),
        ),
      ),
    validate: t.procedure
      .input(
        providerAccountSchema.extend({ repo: z.string() }),
      )
      .query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* RepoService;
            return yield* service.validateRepo(input.accountId, input.repo);
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
    listOverview: t.procedure.input(providerAccountSchema).query(({ input }) =>
      runEffect(
        Effect.gen(function* () {
          console.info(`[trpc] pullRequests.listOverview ${input.accountId}`);
          const service = yield* PullRequestService;
          const pullRequests = yield* service.listOverview(input.accountId);
          return pullRequests.map((entry) =>
            overviewPullRequestSummarySchema.parse(entry),
          );
        }),
      ),
    ),
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
    get: t.procedure.input(pullRequestInputSchema).query(({ input }) =>
      runEffect(
        Effect.gen(function* () {
          const service = yield* PullRequestService;
          return yield* service.get(input.repoId, input.number);
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
    getFileContents: t.procedure
      .input(pullRequestFileContentsInputSchema)
      .query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* PullRequestService;
            return yield* service.getFileContents(input);
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
      .input(providerAccountSchema)
      .query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.getViewerLogin(input.accountId);
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
    fullScreenStatus: t.procedure.subscription(({ ctx }) =>
      observable<boolean>((emit) => {
        const currentWindow = ctx.getWindow();
        if (!currentWindow) {
          emit.next(false);
          return () => {};
        }

        const emitStatus = () => {
          if (!currentWindow.isDestroyed()) {
            emit.next(currentWindow.isFullScreen());
          }
        };

        emitStatus();
        currentWindow.on("enter-full-screen", emitStatus);
        currentWindow.on("leave-full-screen", emitStatus);

        return () => {
          if (currentWindow.isDestroyed()) return;
          currentWindow.off("enter-full-screen", emitStatus);
          currentWindow.off("leave-full-screen", emitStatus);
        };
      }),
    ),
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
