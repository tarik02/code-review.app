import { Effect, Layer } from 'effect';
import { CacheService } from '../cache.ts';
import { ValidationError } from '../errors.ts';
import { ForgeProviderRegistry } from '../providers/registry.ts';
import { DataSourcePullRequestService } from './data-source-pull-requests.ts';
import { DiffDataService } from './diff-data.ts';
import type {
  OverviewPullRequestSummary,
  PullRequestDataSourceListInput,
  PrFileChangeType,
  PrFileContents,
  PrPatch,
  PullRequestSearchState,
  PullRequest,
  PullRequestListItem,
  RepoIdentity,
} from '@code-review-app/shared';

type PullRequestServiceShape = {
  listCached(repo: RepoIdentity): Effect.Effect<PullRequestListItem[], Error>;
  listRecent(): Effect.Effect<OverviewPullRequestSummary[], Error>;
  remember(repo: RepoIdentity, pullRequest: PullRequestListItem): Effect.Effect<void, Error>;
  listOverview(accountId: string): Effect.Effect<OverviewPullRequestSummary[], Error>;
  listDataSource(
    input: PullRequestDataSourceListInput,
  ): Effect.Effect<OverviewPullRequestSummary[], Error>;
  search(
    accountId: string,
    query: string,
    limit: number,
    states: PullRequestSearchState,
  ): Effect.Effect<OverviewPullRequestSummary[], Error>;
  list(repo: RepoIdentity): Effect.Effect<PullRequestListItem[], Error>;
  get(repo: RepoIdentity, number: number): Effect.Effect<PullRequest, Error>;
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

function matchesDataSourceStatus(
  entry: OverviewPullRequestSummary,
  statuses: ReadonlySet<string>,
) {
  const state = entry.pullRequest.state.toUpperCase();
  return (
    (statuses.has('open') && state === 'OPEN' && !entry.pullRequest.isDraft) ||
    (statuses.has('draft') && state === 'OPEN' && entry.pullRequest.isDraft) ||
    (statuses.has('closed') && state === 'CLOSED') ||
    (statuses.has('merged') && state === 'MERGED')
  );
}

function sortDataSourceEntries(
  entries: OverviewPullRequestSummary[],
  sortBy: PullRequestDataSourceListInput['dataSource']['sortBy'],
) {
  if (sortBy === 'created_desc' || sortBy === 'created_asc') return entries;
  return entries.sort((left, right) => {
    const leftTime = Date.parse(left.pullRequest.updatedAt || '');
    const rightTime = Date.parse(right.pullRequest.updatedAt || '');
    const leftValue = Number.isNaN(leftTime) ? 0 : leftTime;
    const rightValue = Number.isNaN(rightTime) ? 0 : rightTime;
    return sortBy === 'updated_asc' ? leftValue - rightValue : rightValue - leftValue;
  });
}

function dedupeOverviewEntries(entries: ReadonlyArray<OverviewPullRequestSummary>) {
  const byKey = new Map<string, OverviewPullRequestSummary>();
  for (const entry of entries) {
    byKey.set(`${entry.repo.providerId}:${entry.repo.repoKey}#${entry.pullRequest.number}`, entry);
  }
  return [...byKey.values()];
}

const makePullRequestService = Effect.gen(function* () {
  const cache = yield* CacheService;
  const dataSourcePullRequests = yield* DataSourcePullRequestService;
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

  const listRecent: PullRequestServiceShape['listRecent'] = Effect.fn(
    'PullRequestService.listRecent',
  )(function* () {
    return yield* cache.listRecentPullRequests();
  });

  const remember: PullRequestServiceShape['remember'] = Effect.fn('PullRequestService.remember')(
    function* (repoInput, pullRequest) {
      const repoIdentity = requireRepo(repoInput);
      yield* cache.ensureRepo(repoIdentity);
      yield* cache.cachePullRequest(repoIdentity, pullRequest);
    },
  );

  const listDataSource: PullRequestServiceShape['listDataSource'] = Effect.fn(
    'PullRequestService.listDataSource',
  )(function* (input) {
    const accountId = input.dataSource.accountId.trim();
    if (!accountId) throw new ValidationError('Account is required');
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      throw new ValidationError('Limit must be positive');
    }

    const entries = yield* dataSourcePullRequests.list(input.dataSource, input.limit);
    const statuses = new Set(input.dataSource.statuses);
    return sortDataSourceEntries(
      dedupeOverviewEntries(entries).filter((entry) => matchesDataSourceStatus(entry, statuses)),
      input.dataSource.sortBy,
    ).slice(0, input.limit);
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
      const pullRequest = yield* provider.getPullRequest(repo, number);
      yield* cache.cachePullRequest(repoIdentity, pullRequest);
      return pullRequest;
    },
  );

  const getPatch: PullRequestServiceShape['getPatch'] = Effect.fn('PullRequestService.getPatch')(
    function* (repo, number, headSha) {
      return yield* diffData.getPatch(requireRepo(repo), number, headSha);
    },
  );

  const search: PullRequestServiceShape['search'] = Effect.fn('PullRequestService.search')(
    function* (accountId, query, limit, states) {
      const trimmedAccountId = accountId.trim();
      if (!trimmedAccountId) throw new ValidationError('Account is required');
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        return [];
      }

      const provider = yield* providers.forAccount(trimmedAccountId);
      return yield* provider.searchPullRequests(trimmedQuery, limit, states);
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
    listRecent,
    remember,
    listOverview,
    listDataSource,
    search,
    list,
    get,
    getPatch,
    listChangedFiles,
    getFileContents,
  } satisfies PullRequestServiceShape;
});

const PullRequestServiceLive = Layer.effect(PullRequestService, makePullRequestService);

export { PullRequestService, PullRequestServiceLive };
