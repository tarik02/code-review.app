import { Effect, Layer } from 'effect';
import { ValidationError } from '../errors.ts';
import { ForgeProviderRegistry } from '../providers/registry.ts';
import type { OverviewPullRequestSummary, PullRequestDataSource } from '@code-review-app/shared';

type DataSourcePullRequestServiceShape = {
  list(
    dataSource: PullRequestDataSource,
    limit: number,
  ): Effect.Effect<OverviewPullRequestSummary[], Error>;
};

class DataSourcePullRequestService extends Effect.Tag('DataSourcePullRequestService')<
  DataSourcePullRequestService,
  DataSourcePullRequestServiceShape
>() {}

const makeDataSourcePullRequestService = Effect.gen(function* () {
  const providers = yield* ForgeProviderRegistry;

  const list: DataSourcePullRequestServiceShape['list'] = Effect.fn(
    'DataSourcePullRequestService.list',
  )(function* (dataSource, limit) {
    const accountId = dataSource.accountId.trim();
    if (!accountId) throw new ValidationError('Account is required');
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ValidationError('Limit must be positive');
    }

    const provider = yield* providers.forAccount(accountId);
    const filters = {
      statuses: dataSource.statuses,
      sortBy: dataSource.sortBy,
      limit,
    };

    if (dataSource.resource.kind === 'account') {
      return yield* provider.listViewerPullRequests(filters);
    }
    if (dataSource.resource.kind === 'namespace') {
      return yield* provider.listNamespacePullRequests(
        dataSource.resource.path,
        dataSource.resource.namespaceKind,
        filters,
      );
    }
    return yield* provider.listRepoPullRequests(dataSource.resource.repo, filters);
  });

  return { list } satisfies DataSourcePullRequestServiceShape;
});

const DataSourcePullRequestServiceLive = Layer.effect(
  DataSourcePullRequestService,
  makeDataSourcePullRequestService,
);

export { DataSourcePullRequestService, DataSourcePullRequestServiceLive };
