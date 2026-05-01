import { initTRPC, TRPCError } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { Cause, Effect, Exit, Option } from 'effect';
import { BackendError, formatLogDetails, getErrorMessage } from './errors.ts';
import { PullRequestService } from './services/pull-requests.ts';
import { PullRequestQualityService } from './services/pull-request-quality.ts';
import { RepoService } from './services/repos.ts';
import { ReviewCommentService } from './services/review-comments.ts';
import { SettingsService } from './services/settings.ts';
import { TrackedPullRequestService } from './services/tracked-pull-requests.ts';
import {
  accountVisibilitySettingsSchema,
  appearanceBackgroundInputSchema,
  browseSearchInputSchema,
  browseSearchSnapshotSchema,
  completeOAuthSchema,
  createPendingReviewGlobalInputSchema,
  createPendingReviewReplyInputSchema,
  createPendingReviewThreadInputSchema,
  createPullRequestReviewCommentInputSchema,
  deletePendingReviewCommentInputSchema,
  deletePullRequestReviewCommentInputSchema,
  diffDataSettingsSchema,
  discardPendingReviewInputSchema,
  overviewPullRequestSummarySchema,
  pendingReviewStateSchema,
  providerAccountSchema,
  providerHostSchema,
  providerProfileSchema,
  publishPendingReviewInputSchema,
  pullRequestApprovalStateSchema,
  pullRequestFileContentsInputSchema,
  pullRequestSearchInputSchema,
  pullRequestQualityReportSchema,
  pullRequestInputSchema,
  pullRequestSummarySchema,
  pullRequestVersionedInputSchema,
  replyToPullRequestReviewCommentInputSchema,
  repoIdentitySchema,
  repoSummarySchema,
  setPullRequestReviewThreadResolvedInputSchema,
  themePreferenceSettingsSchema,
  reviewEditorSettingsSchema,
  updatePendingReviewCommentInputSchema,
  updatePullRequestReviewCommentInputSchema,
  trackedPullRequestOrderEntrySchema,
} from '@code-review-app/shared';
import { z } from 'zod';
import { completeOAuth, pollDeviceOAuth, startOAuth } from './auth/oauth.ts';
import { AuthTokenStore } from './auth/token-store.ts';
import type {
  AvailableUpdate,
  BrowseSearchSnapshot,
  NamespaceSummary,
  OverviewPullRequestSummary,
  ProviderAccount,
  ProviderProfile,
  PullRequestSummary,
  RepoSummary,
  ThemePreference,
  UpdateEvent,
} from '@code-review-app/shared';
import type { BackendRuntime } from './runtime.ts';

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

function dedupeRepos(repos: ReadonlyArray<RepoSummary>) {
  const entries = new Map<string, RepoSummary>();
  for (const repo of repos) {
    entries.set(`${repo.providerId}:${repo.repoKey}`, repo);
  }
  return [...entries.values()];
}

function dedupeNamespaces(namespaces: ReadonlyArray<NamespaceSummary>) {
  const entries = new Map<string, NamespaceSummary>();
  for (const namespace of namespaces) {
    entries.set(`${namespace.providerAccountId}:${namespace.path}`, namespace);
  }
  return [...entries.values()];
}

function dedupeOverviewPullRequests(pullRequests: ReadonlyArray<OverviewPullRequestSummary>) {
  const entries = new Map<string, OverviewPullRequestSummary>();
  for (const entry of pullRequests) {
    const key = `${entry.repo.providerId}:${entry.repo.repoKey}#${entry.pullRequest.number}`;
    const existing = entries.get(key);
    if (
      !existing ||
      Date.parse(entry.pullRequest.updatedAt || '') >
        Date.parse(existing.pullRequest.updatedAt || '')
    ) {
      entries.set(key, entry);
    }
  }
  return [...entries.values()].sort(
    (left, right) =>
      Date.parse(right.pullRequest.updatedAt || '') - Date.parse(left.pullRequest.updatedAt || ''),
  );
}

function repoMatchesNamespace(repo: RepoSummary, namespacePath: string | null) {
  if (!namespacePath) return true;
  return repo.nameWithOwner === namespacePath || repo.nameWithOwner.startsWith(`${namespacePath}/`);
}

function matchesPullRequestSearchState(
  pullRequest: PullRequestSummary,
  state: 'open' | 'draft_open' | 'all',
) {
  if (state === 'all') return true;
  if (pullRequest.state !== 'OPEN') return false;
  return state === 'draft_open' || !pullRequest.isDraft;
}

function parseRepoUrl(input: string, fallbackProvider: ProviderAccount['provider']) {
  try {
    const url = new URL(input);
    const host = url.origin.toLowerCase();
    const provider = url.hostname.toLowerCase() === 'github.com' ? 'github' : fallbackProvider;
    if (provider === 'github') {
      const [owner, name] = url.pathname.split('/').filter(Boolean);
      return owner && name ? { host, provider, path: `${owner}/${name}` } : null;
    }

    const path = url.pathname
      .replace(/\/-\/merge_requests\/\d+$/, '')
      .replace(/\/merge_requests\/\d+$/, '')
      .split('/')
      .filter(Boolean)
      .join('/');
    return path ? { host, provider, path } : null;
  } catch {
    return null;
  }
}

function mapError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  if (error instanceof BackendError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: getErrorMessage(error),
  });
}

function causeFailureOrSquash<E>(cause: Cause.Cause<E>): unknown {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    return Cause.originalError(failure.value);
  }
  return Cause.squash(cause);
}

function summarizeEffectCause<E>(cause: Cause.Cause<E>) {
  const errors = Cause.prettyErrors(cause).map((error) => {
    const originalError = Cause.originalError(error);
    return {
      message: getErrorMessage(originalError),
      name: originalError instanceof Error ? originalError.name : typeof originalError,
    };
  });
  return {
    pretty: Cause.pretty(cause, { renderErrorCause: true }),
    errors,
    primaryError: errors[0] ?? { message: getErrorMessage(causeFailureOrSquash(cause)) },
  };
}

function createAppRouter({ runtime, platform }: CreateAppRouterOptions) {
  async function runEffect<A, E, R>(effect: Effect.Effect<A, E, R>, label = 'effect') {
    const exit = await runtime.runPromiseExit(effect as Effect.Effect<A, E, never>);
    if (Exit.isSuccess(exit)) {
      return exit.value;
    }
    const error = causeFailureOrSquash(exit.cause);
    await runtime.runPromise(
      Effect.logError(
        `[trpc] ${label} failed\n${formatLogDetails(summarizeEffectCause(exit.cause))}`,
      ),
    );
    throw mapError(error);
  }

  async function searchReposForAccount(account: ProviderAccount, query: string, limit: number) {
    const trimmedQuery = query.trim();
    const serviceEffect = Effect.gen(function* () {
      const service = yield* RepoService;

      if (!trimmedQuery) {
        return yield* service.listInitialRepos(account.id, limit);
      }

      const parsedUrl = parseRepoUrl(trimmedQuery, account.provider);
      if (parsedUrl) {
        if (parsedUrl.provider !== account.provider || parsedUrl.host !== account.host) {
          return [];
        }
        return yield* service.validateRepo(account.id, parsedUrl.path).pipe(
          Effect.map((repo) => [repo]),
          Effect.catchAll(() => Effect.succeed([])),
        );
      }

      const pathQuery = trimmedQuery.replace(/\.git$/, '');
      const pathSegmentCount = pathQuery.split('/').filter(Boolean).length;
      if (
        ((account.provider === 'github' && pathSegmentCount === 2) ||
          (account.provider === 'gitlab' && pathSegmentCount >= 2)) &&
        !pathQuery.startsWith('/') &&
        !pathQuery.endsWith('/')
      ) {
        const validated = yield* service.validateRepo(account.id, pathQuery).pipe(
          Effect.map((repo) => [repo]),
          Effect.catchAll(() => Effect.succeed(null)),
        );
        if (validated) {
          return validated;
        }
      }

      return yield* service.searchRepos(account.id, trimmedQuery, limit);
    });

    return runEffect(serviceEffect, 'browse.searchRepos');
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
            throw new Error('Provider auth status was not returned.');
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

    browse: t.router({
      search: t.procedure.input(browseSearchInputSchema).subscription(({ input }) =>
        observable<BrowseSearchSnapshot>((emit) => {
          let cancelled = false;
          let pendingCount = 0;
          let completedCount = 0;
          let accountIds: string[] = [];
          let repos: RepoSummary[] = [];
          let namespaces: NamespaceSummary[] = [];
          let pullRequests: OverviewPullRequestSummary[] = [];
          const errors: string[] = [];

          const scopedSearch = Boolean(input.repoFilterKey || input.namespaceFilterPath);

          const emitSnapshot = () => {
            if (cancelled) return;
            emit.next(
              browseSearchSnapshotSchema.parse({
                repos: dedupeRepos(repos),
                namespaces: dedupeNamespaces(namespaces),
                pullRequests: dedupeOverviewPullRequests(pullRequests),
                accountIds,
                pendingCount,
                completedCount,
                errors,
                loading: pendingCount > 0,
              }),
            );
          };

          const applyAccountResults = (accountRepos: RepoSummary[]) => {
            repos = dedupeRepos([...repos, ...accountRepos]);
            emitSnapshot();
          };

          void (async () => {
            try {
              const accounts = await runEffect(
                Effect.gen(function* () {
                  const service = yield* RepoService;
                  return yield* service.listProviderAccounts();
                }),
                'browse.listProviderAccounts',
              );
              const enabledAccountIds = new Set(input.accountIds);
              const activeAccounts = accounts.filter((account) =>
                enabledAccountIds.has(account.id),
              );
              accountIds = activeAccounts.map((account) => account.id);
              pendingCount = activeAccounts.length;
              emitSnapshot();

              await Promise.all(
                activeAccounts.map(async (account) => {
                  try {
                    const accountRepos = await searchReposForAccount(
                      account,
                      input.query,
                      input.repoLimit,
                    );
                    applyAccountResults(accountRepos);

                    if (input.query.trim()) {
                      try {
                        const accountNamespaces = await runEffect(
                          Effect.gen(function* () {
                            const service = yield* RepoService;
                            return yield* service.searchNamespaces(
                              account.id,
                              input.query,
                              input.namespaceLimit,
                            );
                          }),
                          'browse.searchNamespaces',
                        );
                        namespaces = dedupeNamespaces([...namespaces, ...accountNamespaces]);
                        emitSnapshot();
                      } catch (error) {
                        errors.push(getErrorMessage(error));
                        emitSnapshot();
                      }
                    }

                    if (scopedSearch) {
                      let scopedRepos = accountRepos;
                      if (input.repoFilterKey) {
                        scopedRepos = await runEffect(
                          Effect.gen(function* () {
                            const service = yield* RepoService;
                            return yield* service
                              .validateRepo(account.id, input.repoFilterKey ?? '')
                              .pipe(
                                Effect.map((repo) => [repo]),
                                Effect.catchAll(() => Effect.succeed([])),
                              );
                          }),
                          'browse.validateScopedRepo',
                        );
                      } else if (input.namespaceFilterPath) {
                        scopedRepos = await runEffect(
                          Effect.gen(function* () {
                            const service = yield* RepoService;
                            return yield* service.listNamespaceRepos(
                              account.id,
                              input.namespaceFilterPath ?? '',
                              input.repoLimit,
                            );
                          }),
                          'browse.listNamespaceRepos',
                        );
                        applyAccountResults(scopedRepos);
                      }

                      const visibleRepos = scopedRepos.filter(
                        (repo) =>
                          (!input.profileFilterAccountId ||
                            repo.providerAccountId === input.profileFilterAccountId) &&
                          repoMatchesNamespace(repo, input.namespaceFilterPath),
                      );
                      const repoPullRequestGroups = await Promise.all(
                        visibleRepos.map(async (repo) => {
                          try {
                            const repoPullRequests = await runEffect(
                              Effect.gen(function* () {
                                const service = yield* PullRequestService;
                                return yield* service.list(repo);
                              }),
                              'browse.listPullRequests',
                            );
                            return repoPullRequests
                              .filter((pullRequest) =>
                                matchesPullRequestSearchState(pullRequest, input.states),
                              )
                              .map(
                                (pullRequest) =>
                                  ({
                                    repo,
                                    pullRequest,
                                  }) satisfies OverviewPullRequestSummary,
                              );
                          } catch (error) {
                            errors.push(getErrorMessage(error));
                            return [];
                          }
                        }),
                      );
                      pullRequests = dedupeOverviewPullRequests([
                        ...pullRequests,
                        ...repoPullRequestGroups.flat(),
                      ]).slice(0, input.pullRequestLimit);
                      emitSnapshot();
                    } else if (input.query.trim()) {
                      try {
                        const accountPullRequests = await runEffect(
                          Effect.gen(function* () {
                            const service = yield* PullRequestService;
                            return yield* service.search(
                              account.id,
                              input.query,
                              input.pullRequestLimit,
                              input.states,
                            );
                          }),
                          'browse.searchPullRequests',
                        );
                        pullRequests = dedupeOverviewPullRequests([
                          ...pullRequests,
                          ...accountPullRequests,
                        ]).slice(0, input.pullRequestLimit);
                        emitSnapshot();
                      } catch (error) {
                        errors.push(getErrorMessage(error));
                        emitSnapshot();
                      }
                    }
                  } catch (error) {
                    errors.push(getErrorMessage(error));
                    emitSnapshot();
                  } finally {
                    completedCount += 1;
                    pendingCount = Math.max(0, pendingCount - 1);
                    emitSnapshot();
                  }
                }),
              );

              emit.complete();
            } catch (error) {
              emit.error(mapError(error));
            }
          })();

          return () => {
            cancelled = true;
          };
        }),
      ),
    }),

    repos: t.router({
      listInitial: t.procedure
        .input(
          providerAccountSchema.extend({
            limit: z.number().int().positive().optional(),
          }),
        )
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
      searchNamespaces: t.procedure
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
              return yield* service.searchNamespaces(input.accountId, input.query, input.limit);
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
      tryValidate: t.procedure
        .input(providerAccountSchema.extend({ repo: z.string() }))
        .query(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* RepoService;
              return yield* service
                .validateRepo(input.accountId, input.repo)
                .pipe(Effect.catchAll(() => Effect.succeed(null)));
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
            yield* Effect.logInfo('tRPC pullRequests.listOverview').pipe(
              Effect.annotateLogs({
                accountId: input.accountId,
              }),
            );
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
      search: t.procedure.input(pullRequestSearchInputSchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* PullRequestService;
            return yield* service.search(input.accountId, input.query, input.limit, input.states);
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
      tryGet: t.procedure.input(pullRequestInputSchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* PullRequestService;
            return yield* service
              .get(input, input.number)
              .pipe(Effect.catchAll(() => Effect.succeed(null)));
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
      getOrder: t.procedure.query(() =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* TrackedPullRequestService;
            return yield* service.getOrder();
          }),
        ),
      ),
      listRepos: t.procedure.query(() =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* TrackedPullRequestService;
            return yield* service.listRepos();
          }),
        ),
      ),
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
      setOrder: t.procedure
        .input(z.array(trackedPullRequestOrderEntrySchema))
        .mutation(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* TrackedPullRequestService;
              return yield* service.setOrder(input);
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
      getApprovalState: t.procedure.input(pullRequestVersionedInputSchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            const approvalState = yield* service.getApprovalState(input, input.number);
            return pullRequestApprovalStateSchema.parse(approvalState);
          }),
          'reviewComments.getApprovalState',
        ),
      ),
      approve: t.procedure.input(pullRequestVersionedInputSchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.approve(input, input.number, input.headSha);
          }),
          'reviewComments.approve',
        ),
      ),
      removeApproval: t.procedure.input(pullRequestVersionedInputSchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.removeApproval(input, input.number);
          }),
          'reviewComments.removeApproval',
        ),
      ),
      listThreads: t.procedure.input(pullRequestVersionedInputSchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.listThreads(input, input.number, input.headSha);
          }),
          'reviewComments.listThreads',
        ),
      ),
      listPending: t.procedure.input(pullRequestVersionedInputSchema).query(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            const pendingState = yield* service.listPending(input, input.number, input.headSha);
            return pendingReviewStateSchema.parse(pendingState);
          }),
          'reviewComments.listPending',
        ),
      ),
      createPendingThread: t.procedure
        .input(createPendingReviewThreadInputSchema)
        .mutation(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* ReviewCommentService;
              return yield* service.createPendingThread(input);
            }),
            'reviewComments.createPendingThread',
          ),
        ),
      createPendingReply: t.procedure
        .input(createPendingReviewReplyInputSchema)
        .mutation(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* ReviewCommentService;
              return yield* service.createPendingReply(input);
            }),
            'reviewComments.createPendingReply',
          ),
        ),
      createPendingGlobal: t.procedure
        .input(createPendingReviewGlobalInputSchema)
        .mutation(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* ReviewCommentService;
              return yield* service.createPendingGlobal(input);
            }),
            'reviewComments.createPendingGlobal',
          ),
        ),
      updatePending: t.procedure
        .input(updatePendingReviewCommentInputSchema)
        .mutation(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* ReviewCommentService;
              return yield* service.updatePending(input);
            }),
            'reviewComments.updatePending',
          ),
        ),
      deletePending: t.procedure
        .input(deletePendingReviewCommentInputSchema)
        .mutation(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* ReviewCommentService;
              return yield* service.deletePending(input);
            }),
            'reviewComments.deletePending',
          ),
        ),
      publishPendingReview: t.procedure
        .input(publishPendingReviewInputSchema)
        .mutation(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* ReviewCommentService;
              return yield* service.publishPendingReview(input);
            }),
            'reviewComments.publishPendingReview',
          ),
        ),
      discardPendingReview: t.procedure
        .input(discardPendingReviewInputSchema)
        .mutation(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* ReviewCommentService;
              return yield* service.discardPendingReview(input);
            }),
            'reviewComments.discardPendingReview',
          ),
        ),
      create: t.procedure.input(createPullRequestReviewCommentInputSchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.create(input);
          }),
          'reviewComments.create',
        ),
      ),
      reply: t.procedure.input(replyToPullRequestReviewCommentInputSchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.reply(input);
          }),
          'reviewComments.reply',
        ),
      ),
      setResolved: t.procedure
        .input(setPullRequestReviewThreadResolvedInputSchema)
        .mutation(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* ReviewCommentService;
              return yield* service.setResolved(input);
            }),
            'reviewComments.setResolved',
          ),
        ),
      update: t.procedure.input(updatePullRequestReviewCommentInputSchema).mutation(({ input }) =>
        runEffect(
          Effect.gen(function* () {
            const service = yield* ReviewCommentService;
            return yield* service.update(input);
          }),
          'reviewComments.update',
        ),
      ),
      deleteComment: t.procedure
        .input(deletePullRequestReviewCommentInputSchema)
        .mutation(({ input }) =>
          runEffect(
            Effect.gen(function* () {
              const service = yield* ReviewCommentService;
              return yield* service.deleteComment(input);
            }),
            'reviewComments.deleteComment',
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
          await runtime.runPromise(
            Effect.logError(
              `[trpc] updates.check failed\n${formatLogDetails({ message: getErrorMessage(error) })}`,
            ),
          );
          throw mapError(error);
        }
      }),
      install: t.procedure.mutation(async () => {
        try {
          await platform.installUpdate();
        } catch (error) {
          await runtime.runPromise(
            Effect.logError(
              `[trpc] updates.install failed\n${formatLogDetails({ message: getErrorMessage(error) })}`,
            ),
          );
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
