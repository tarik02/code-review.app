import { initTRPC, TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { Effect } from "effect";
import { BackendError, getErrorMessage } from "./errors.ts";
import { PullRequestService } from "./services/pull-requests.ts";
import { PullRequestQualityService } from "./services/pull-request-quality.ts";
import { RepoService } from "./services/repos.ts";
import { ReviewCommentService } from "./services/review-comments.ts";
import { SettingsService } from "./services/settings.ts";
import { TrackedPullRequestService } from "./services/tracked-pull-requests.ts";
import {
  accountVisibilitySettingsSchema,
  appearanceBackgroundInputSchema,
  completeOAuthSchema,
  createPullRequestReviewCommentInputSchema,
  diffDataSettingsSchema,
  overviewPullRequestSummarySchema,
  providerAccountSchema,
  providerHostSchema,
  providerProfileSchema,
  pullRequestFileContentsInputSchema,
  pullRequestQualityReportSchema,
  pullRequestInputSchema,
  pullRequestSummarySchema,
  pullRequestVersionedInputSchema,
  replyToPullRequestReviewCommentInputSchema,
  repoIdentitySchema,
  repoSummarySchema,
  themePreferenceSettingsSchema,
  reviewEditorSettingsSchema,
  updatePullRequestReviewCommentInputSchema,
} from "@code-review-app/shared";
import { z } from "zod";
import { completeOAuth, pollDeviceOAuth, startOAuth } from "./auth/oauth.ts";
import { AuthTokenStore } from "./auth/token-store.ts";
import type {
  AvailableUpdate,
  ProviderProfile,
  ThemePreference,
  UpdateEvent,
} from "@code-review-app/shared";
import type { BackendRuntime } from "./runtime.ts";

type BackendRouterPlatform = {
  getCurrentVersion(): string;
  selectCustomBackgroundFile(): Promise<string | null>;
  getLatestOAuthCallback(): { url: string; emittedAt: number } | null;
  subscribeToOAuthCallbacks(listener: (url: string) => void): () => void;
  subscribeToDeepLinks(listener: (url: string) => void): () => void;
  subscribeToFullScreenStatus(listener: (value: boolean) => void): () => void;
  setNativeTheme(preference: ThemePreference): void;
  toggleMaximize(): void;
  checkForUpdate(): Promise<AvailableUpdate | null>;
  installUpdate(): Promise<void>;
  subscribeToUpdateEvents(listener: (event: UpdateEvent) => void): () => void;
};

type CreateAppRouterOptions = {
  runtime: BackendRuntime;
  platform: BackendRouterPlatform;
};

const t = initTRPC.create();

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

function summarizeRouterError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? summarizeRouterError(error.cause) : undefined,
    };
  }

  if (typeof error === "object" && error !== null) {
    return Object.fromEntries(
      Object.entries(error).map(([key, value]): [string, unknown] => [
        key,
        summarizeRouterError(value),
      ]),
    );
  }

  return {
    message: String(error),
  };
}

function createAppRouter({ runtime, platform }: CreateAppRouterOptions) {
  async function runEffect<A, E, R>(effect: Effect.Effect<A, E, R>, label = "effect") {
    try {
      return await runtime.runPromise(effect as Effect.Effect<A, E, never>);
    } catch (error) {
      console.error(`[trpc] ${label} failed`, summarizeRouterError(error));
      throw mapError(error);
    }
  }

  return t.router({
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
      getProviderProfile: t.procedure.input(providerAccountSchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* RepoService;
            const profile = yield* service.getProviderProfile(input.accountId);
            const parsed: ProviderProfile = providerProfileSchema.parse(profile);
            return parsed;
          }),
        ),
      ),
      startOAuth: t.procedure
        .input(providerHostSchema)
        .mutation(({ input }) =>
          runEffect(startOAuth(input.provider, input.host, input.clientId, input.clientSecret)),
        ),
      pollDeviceOAuth: t.procedure
        .input(providerAccountSchema)
        .mutation(({ input }) => runEffect(pollDeviceOAuth(input.accountId))),
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
          const unsubscribe = platform.subscribeToOAuthCallbacks((url) => emit.next(url));
          return unsubscribe;
        }),
      ),
      latestOAuthCallback: t.procedure.query(() => platform.getLatestOAuthCallback()),
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
      getDiffDataSettings: t.procedure.query(() =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* SettingsService;
            return yield* service.getDiffDataSettings();
          }),
        ),
      ),
      setDiffDataSettings: t.procedure.input(diffDataSettingsSchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* SettingsService;
            return yield* service.setDiffDataSettings(input);
          }),
        ),
      ),
      getThemePreference: t.procedure.query(() =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* SettingsService;
            return yield* service.getThemePreference();
          }),
        ),
      ),
      setThemePreference: t.procedure
        .input(themePreferenceSettingsSchema)
        .mutation(async ({ input }) => {
          const settings = await runEffect(
            Effect.gen(function* () {
              const service = yield* SettingsService;
              return yield* service.setThemePreference(input);
            }),
          );
          platform.setNativeTheme(settings.preference);
          return settings;
        }),
      getReviewEditorSettings: t.procedure.query(() =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* SettingsService;
            return yield* service.getReviewEditorSettings();
          }),
        ),
      ),
      setReviewEditorSettings: t.procedure.input(reviewEditorSettingsSchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* SettingsService;
            return yield* service.setReviewEditorSettings(input);
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
      selectCustomBackgroundFile: t.procedure.mutation(async () => {
        const filePath = await platform.selectCustomBackgroundFile();

        return runEffect(
          Effect.gen(function* () {
            const service = yield* SettingsService;
            if (!filePath) {
              return yield* service.getAppearanceBackground();
            }

            return yield* service.setCustomBackgroundFromPath(filePath);
          }),
        );
      }),
    }),

    deepLinks: t.router({
      urls: t.procedure.subscription(() =>
        observable<string>((emit) => {
          const unsubscribe = platform.subscribeToDeepLinks((url) => emit.next(url));
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
        .input(providerAccountSchema.extend({ repo: z.string() }))
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
      save: t.procedure.input(z.object({ repo: repoSummarySchema })).mutation(({ input }) =>
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
            return pullRequests.map((entry) => overviewPullRequestSummarySchema.parse(entry));
          }),
        ),
      ),
      listCached: t.procedure.input(repoIdentitySchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* PullRequestService;
            return yield* service.listCached(input);
          }),
        ),
      ),
      list: t.procedure.input(repoIdentitySchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* PullRequestService;
            return yield* service.list(input);
          }),
        ),
      ),
      get: t.procedure.input(pullRequestInputSchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* PullRequestService;
            return yield* service.get(input, input.number);
          }),
        ),
      ),
      getPatch: t.procedure.input(pullRequestVersionedInputSchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* PullRequestService;
            return yield* service.getPatch(input, input.number, input.headSha);
          }),
        ),
      ),
      listChangedFiles: t.procedure.input(pullRequestVersionedInputSchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* PullRequestService;
            return yield* service.listChangedFiles(input, input.number, input.headSha);
          }),
        ),
      ),
      getQualityReport: t.procedure.input(pullRequestVersionedInputSchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* PullRequestQualityService;
            const report = yield* service.get(input, input.number, input.headSha);
            return pullRequestQualityReportSchema.parse(report);
          }),
        ),
      ),
      getFileContents: t.procedure.input(pullRequestFileContentsInputSchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* PullRequestService;
            return yield* service.getFileContents(input);
          }),
        ),
      ),
    }),

    tracked: t.router({
      list: t.procedure.input(repoIdentitySchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* TrackedPullRequestService;
            return yield* service.list(input);
          }),
        ),
      ),
      track: t.procedure
        .input(repoIdentitySchema.extend({ pullRequest: pullRequestSummarySchema }))
        .mutation(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* TrackedPullRequestService;
              return yield* service.track(input, input.pullRequest);
            }),
          ),
        ),
      remove: t.procedure.input(pullRequestInputSchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* TrackedPullRequestService;
            return yield* service.remove(input, input.number);
          }),
        ),
      ),
      refresh: t.procedure.input(repoIdentitySchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* TrackedPullRequestService;
            return yield* service.refresh(input);
          }),
        ),
      ),
    }),

    reviewComments: t.router({
      getViewerLogin: t.procedure.input(providerAccountSchema).query(({ input }) =>
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
            return yield* service.listThreads(input, input.number);
          }),
          "reviewComments.listThreads",
        ),
      ),
      create: t.procedure.input(createPullRequestReviewCommentInputSchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.create(input);
          }),
          "reviewComments.create",
        ),
      ),
      reply: t.procedure.input(replyToPullRequestReviewCommentInputSchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.reply(input);
          }),
          "reviewComments.reply",
        ),
      ),
      update: t.procedure.input(updatePullRequestReviewCommentInputSchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.update(input);
          }),
          "reviewComments.update",
        ),
      ),
    }),

    window: t.router({
      fullScreenStatus: t.procedure.subscription(() =>
        observable<boolean>((emit) => {
          return platform.subscribeToFullScreenStatus((value) => emit.next(value));
        }),
      ),
      toggleMaximize: t.procedure.mutation(() => platform.toggleMaximize()),
    }),

    updates: t.router({
      getCurrentVersion: t.procedure.query(() => platform.getCurrentVersion()),
      check: t.procedure.query(async () => {
        try {
          return await platform.checkForUpdate();
        } catch (error) {
          throw mapError(error);
        }
      }),
      install: t.procedure.mutation(async () => {
        try {
          await platform.installUpdate();
        } catch (error) {
          throw mapError(error);
        }
      }),
      events: t.procedure.subscription(() =>
        observable<UpdateEvent>((emit) => {
          const unsubscribe = platform.subscribeToUpdateEvents((event) => emit.next(event));
          return unsubscribe;
        }),
      ),
    }),
  });
}

type AppRouter = ReturnType<typeof createAppRouter>;

export { createAppRouter };
export type { AppRouter, BackendRouterPlatform };
