import { asc } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { repoSummarySchema } from '@code-review-app/shared';
import { AuthTokenStore } from '../auth/token-store.ts';
import { DatabaseService } from '../db/client.ts';
import { pullRequestDataSources } from '../db/schema.ts';
import type {
  PullRequestDataSource,
  PullRequestDataSourceResource,
  PullRequestDataSourcesSettings,
  PullRequestDataSourceSort,
  PullRequestDataSourceStatus,
} from '@code-review-app/shared';

type PullRequestDataSourceServiceShape = {
  list(): Effect.Effect<PullRequestDataSourcesSettings, Error>;
  replace(
    settings: PullRequestDataSourcesSettings,
  ): Effect.Effect<PullRequestDataSourcesSettings, Error>;
};

class PullRequestDataSourceService extends Effect.Tag('PullRequestDataSourceService')<
  PullRequestDataSourceService,
  PullRequestDataSourceServiceShape
>() {}

type DataSourceRow = typeof pullRequestDataSources.$inferSelect;

function nowUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function isStatus(value: unknown): value is PullRequestDataSourceStatus {
  return value === 'open' || value === 'draft' || value === 'closed' || value === 'merged';
}

function parseStatuses(value: string): PullRequestDataSourceStatus[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Data source statuses are invalid.');
  const statuses = parsed.filter(isStatus);
  if (statuses.length === 0) throw new Error('Data source must include at least one status.');
  return [...new Set(statuses)];
}

function parseSort(value: string): PullRequestDataSourceSort {
  if (
    value === 'updated_desc' ||
    value === 'updated_asc' ||
    value === 'created_desc' ||
    value === 'created_asc'
  ) {
    return value;
  }
  return 'updated_desc';
}

function defaultDataSource(accountId: string): PullRequestDataSource {
  return {
    id: `account:${accountId}`,
    accountId,
    resource: { kind: 'account' },
    statuses: ['open', 'draft'],
    sortBy: 'updated_desc',
    groupByProject: true,
  };
}

function rowToDataSource(row: DataSourceRow): PullRequestDataSource {
  let resource: PullRequestDataSourceResource;
  if (row.resourceKind === 'account') {
    resource = { kind: 'account' };
  } else if (row.resourceKind === 'namespace') {
    const namespaceKind = row.resourceNamespaceKind;
    resource = {
      kind: 'namespace',
      path: row.resourcePath ?? '',
      namespaceKind:
        namespaceKind === 'user' ||
        namespaceKind === 'organization' ||
        namespaceKind === 'group' ||
        namespaceKind === 'namespace'
          ? namespaceKind
          : 'namespace',
    };
  } else if (row.resourceKind === 'repo') {
    const repo = repoSummarySchema.parse(JSON.parse(row.resourceRepoJson ?? '{}'));
    resource = { kind: 'repo', repo };
  } else {
    throw new Error('Unsupported data source resource.');
  }

  return {
    id: row.id,
    ...(row.name ? { name: row.name } : {}),
    accountId: row.accountId,
    resource,
    statuses: parseStatuses(row.statusesJson),
    sortBy: parseSort(row.sortBy),
    groupByProject: row.groupByProject,
  };
}

function normalizeSettings(
  settings: PullRequestDataSourcesSettings,
  knownAccountIds: ReadonlySet<string>,
): PullRequestDataSourcesSettings {
  const seenIds = new Set<string>();
  const sources: PullRequestDataSource[] = [];

  for (const source of settings.sources) {
    const id = source.id.trim();
    const accountId = source.accountId.trim();
    if (!id) throw new Error('Data source id is required.');
    if (seenIds.has(id)) throw new Error('Data source ids must be unique.');
    if (!knownAccountIds.has(accountId)) {
      throw new Error('Data source references an unknown provider account.');
    }

    const statuses = [...new Set(source.statuses)];
    if (statuses.length === 0) throw new Error('Data source must include at least one status.');
    for (const status of statuses) {
      if (!isStatus(status)) throw new Error('Unsupported data source status.');
    }
    if (
      source.sortBy !== 'updated_desc' &&
      source.sortBy !== 'updated_asc' &&
      source.sortBy !== 'created_desc' &&
      source.sortBy !== 'created_asc'
    ) {
      throw new Error('Unsupported data source sort.');
    }

    let resource: PullRequestDataSourceResource;
    if (source.resource.kind === 'account') {
      resource = { kind: 'account' };
    } else if (source.resource.kind === 'namespace') {
      const path = source.resource.path.trim();
      if (!path) throw new Error('Data source namespace is required.');
      resource = {
        kind: 'namespace',
        path,
        namespaceKind: source.resource.namespaceKind,
      };
    } else {
      if (source.resource.repo.providerAccountId !== accountId) {
        throw new Error('Data source repo must belong to the selected provider account.');
      }
      resource = { kind: 'repo', repo: repoSummarySchema.parse(source.resource.repo) };
    }

    const name = source.name?.trim() || undefined;

    seenIds.add(id);
    sources.push({
      id,
      ...(name ? { name } : {}),
      accountId,
      resource,
      statuses,
      sortBy: source.sortBy,
      groupByProject: source.groupByProject,
    });
  }

  return {
    activeDataSourceId:
      settings.activeDataSourceId && seenIds.has(settings.activeDataSourceId)
        ? settings.activeDataSourceId
        : (sources[0]?.id ?? null),
    sources,
  };
}

function sourceToRowValues(
  source: PullRequestDataSource,
  position: number,
  isActive: boolean,
  timestamp: number,
): typeof pullRequestDataSources.$inferInsert {
  return {
    id: source.id,
    name: source.name?.trim() || null,
    accountId: source.accountId,
    resourceKind: source.resource.kind,
    resourcePath:
      source.resource.kind === 'namespace'
        ? source.resource.path
        : source.resource.kind === 'repo'
          ? source.resource.repo.repoKey
          : null,
    resourceNamespaceKind:
      source.resource.kind === 'namespace' ? source.resource.namespaceKind : null,
    resourceRepoJson: source.resource.kind === 'repo' ? JSON.stringify(source.resource.repo) : null,
    statusesJson: JSON.stringify(source.statuses),
    sortBy: source.sortBy,
    groupByProject: source.groupByProject,
    position,
    isActive,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const makePullRequestDataSourceService = Effect.gen(function* () {
  const database = yield* DatabaseService;
  const tokenStore = yield* AuthTokenStore;

  const replaceRows = (settings: PullRequestDataSourcesSettings) =>
    Effect.gen(function* () {
      const accounts = yield* tokenStore.listAccounts();
      const knownAccountIds = new Set(accounts.map((account) => account.id));
      const normalized = normalizeSettings(settings, knownAccountIds);
      const timestamp = nowUnixTimestamp();

      yield* database.transaction(async (tx) => {
        await tx.delete(pullRequestDataSources);
        if (normalized.sources.length === 0) return;
        await tx.insert(pullRequestDataSources).values(
          normalized.sources.map((source, position) =>
            sourceToRowValues(
              source,
              position,
              source.id === normalized.activeDataSourceId,
              timestamp,
            ),
          ),
        );
      });

      return normalized;
    });

  const list: PullRequestDataSourceServiceShape['list'] = Effect.fn(
    'PullRequestDataSourceService.list',
  )(function* () {
    const rows = yield* database.query((db) =>
      db.select().from(pullRequestDataSources).orderBy(asc(pullRequestDataSources.position)),
    );

    if (rows.length > 0) {
      const sources = rows.map(rowToDataSource);
      const active = rows.find((row) => row.isActive)?.id ?? sources[0]?.id ?? null;
      return { activeDataSourceId: active, sources };
    }

    const accounts = yield* tokenStore.listAccounts();
    const settings: PullRequestDataSourcesSettings = {
      activeDataSourceId: accounts[0] ? `account:${accounts[0].id}` : null,
      sources: accounts.map((account) => defaultDataSource(account.id)),
    };
    return yield* replaceRows(settings);
  });

  const replace: PullRequestDataSourceServiceShape['replace'] = Effect.fn(
    'PullRequestDataSourceService.replace',
  )(function* (settings) {
    return yield* replaceRows(settings);
  });

  return { list, replace } satisfies PullRequestDataSourceServiceShape;
});

const PullRequestDataSourceServiceLive = Layer.effect(
  PullRequestDataSourceService,
  makePullRequestDataSourceService,
);

export { PullRequestDataSourceService, PullRequestDataSourceServiceLive };
