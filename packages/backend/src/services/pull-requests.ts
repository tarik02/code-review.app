import { Effect, Layer } from 'effect';
import { CacheService } from '../cache.ts';
import { ValidationError } from '../errors.ts';
import { ForgeProviderRegistry } from '../providers/registry.ts';
import { DiffDataService } from './diff-data.ts';
import type {
  OverviewPullRequestSummary,
  PrFileChangeType,
  PrFileContents,
  PrPatch,
  RepoIdentity,
  PullRequestSummary,
} from '@code-review-app/shared';

type PullRequestServiceShape = {
  listCached(repo: RepoIdentity): Effect.Effect<PullRequestSummary[], Error>;
  listOverview(accountId: string): Effect.Effect<OverviewPullRequestSummary[], Error>;
  list(repo: RepoIdentity): Effect.Effect<PullRequestSummary[], Error>;
  get(repo: RepoIdentity, number: number): Effect.Effect<PullRequestSummary, Error>;
  getPatch(repo: RepoIdentity, number: number, headSha: string): Effect.Effect<PrPatch, Error>;
  listChangedFiles(
    repo: RepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<string[], Error>;
  getFileContents(input: {
    providerId: string;
    repoKey: string;
    number: number;
    oldPath: string;
    newPath: string;
    baseSha: string | null;
    headSha: string;
    changeType: PrFileChangeType;
  }): Effect.Effect<PrFileContents, Error>;
};

class PullRequestService extends Effect.Tag('PullRequestService')<
  PullRequestService,
  PullRequestServiceShape
>() {}

function requireRepo(repo: RepoIdentity) {
  if (!repo.providerId.trim() || !repo.repoKey.trim()) {
    throw new ValidationError('Repo is required');
  }
  return repo;
}

const makePullRequestService = Effect.gen(function* () {
  const cache = yield* CacheService;
  const diffData = yield* DiffDataService;
  const providers = yield* ForgeProviderRegistry;

  const listCached: PullRequestServiceShape['listCached'] = Effect.fn(
    'PullRequestService.listCached',
  )(function* (repo) {
    return yield* cache.readCachedPullRequests(requireRepo(repo));
  });

  const listOverview: PullRequestServiceShape['listOverview'] = Effect.fn(
    'PullRequestService.listOverview',
  )(function* (accountId) {
    const trimmedAccountId = accountId.trim();
    if (!trimmedAccountId) throw new ValidationError('Account is required');
    yield* Effect.logInfo('loading pull request overview').pipe(
      Effect.annotateLogs({
        accountId: trimmedAccountId,
      }),
    );
    const provider = yield* providers.forAccount(trimmedAccountId);
    return yield* provider.listOverviewPullRequests();
  });

  const list: PullRequestServiceShape['list'] = Effect.fn('PullRequestService.list')(
    function* (repoInput) {
      const repoIdentity = requireRepo(repoInput);
      const { provider, repo } = yield* providers.forRepo(repoIdentity);
      const pullRequests = yield* provider.listPullRequests(repo);
      yield* cache.writePullRequestsCache(repoIdentity, pullRequests);
      yield* cache.updateRepoAccessTimestamp(repoIdentity);
      return pullRequests;
    },
  );

  const get: PullRequestServiceShape['get'] = Effect.fn('PullRequestService.get')(
    function* (repoInput, number) {
      const repoIdentity = requireRepo(repoInput);
      const { provider, repo } = yield* providers.forRepo(repoIdentity);
      return yield* provider.getPullRequest(repo, number);
    },
  );

  const getPatch: PullRequestServiceShape['getPatch'] = Effect.fn('PullRequestService.getPatch')(
    function* (repo, number, headSha) {
      return yield* diffData.getPatch(requireRepo(repo), number, headSha);
    },
  );

  const listChangedFiles: PullRequestServiceShape['listChangedFiles'] = Effect.fn(
    'PullRequestService.listChangedFiles',
  )(function* (repo, number, headSha) {
    return yield* diffData.getChangedFiles(requireRepo(repo), number, headSha);
  });

  const getFileContents: PullRequestServiceShape['getFileContents'] = Effect.fn(
    'PullRequestService.getFileContents',
  )(function* (input) {
    return yield* diffData.getFileContents(input);
  });

  return {
    listCached,
    listOverview,
    list,
    get,
    getPatch,
    listChangedFiles,
    getFileContents,
  } satisfies PullRequestServiceShape;
});

const PullRequestServiceLive = Layer.effect(PullRequestService, makePullRequestService);

export { PullRequestService, PullRequestServiceLive };
