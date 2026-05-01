import { and, asc, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { DatabaseService, type Database, type DatabaseTransaction } from './db/client.ts';
import {
  prChangedFilesCache,
  prPatchCache,
  providerProfiles,
  pullRequests,
  repos,
} from './db/schema.ts';
import { CacheError } from './errors.ts';
import { createRepoIdentityFromParts } from './repo-id.ts';
import type {
  ForgeProviderKind,
  ProviderProfile,
  RepoIdentity,
  PullRequestListItem,
  RepoSummary,
  OverviewPullRequestSummary,
  TrackedPullRequestOrderEntry,
} from '@code-review-app/shared';

type CacheServiceShape = {
  listSavedRepos(): Effect.Effect<RepoSummary[], CacheError>;
  listTrackedRepos(): Effect.Effect<RepoSummary[], CacheError>;
  listRecentPullRequests(): Effect.Effect<OverviewPullRequestSummary[], CacheError>;
  saveRepo(repo: RepoSummary): Effect.Effect<void, CacheError>;
  ensureRepo(repo: RepoIdentity): Effect.Effect<void, CacheError>;
  readCachedPullRequests(repo: RepoIdentity): Effect.Effect<PullRequestListItem[], CacheError>;
  readTrackedPullRequests(repo: RepoIdentity): Effect.Effect<PullRequestListItem[], CacheError>;
  readTrackedPullRequestOrder(): Effect.Effect<TrackedPullRequestOrderEntry[], CacheError>;
  writePullRequestsCache(
    repo: RepoIdentity,
    pullRequests: PullRequestListItem[],
  ): Effect.Effect<void, CacheError>;
  cachePullRequest(
    repo: RepoIdentity,
    pullRequest: PullRequestListItem,
  ): Effect.Effect<void, CacheError>;
  trackPullRequest(
    repo: RepoIdentity,
    pullRequest: PullRequestListItem,
  ): Effect.Effect<void, CacheError>;
  setTrackedPullRequestOrder(
    entries: TrackedPullRequestOrderEntry[],
  ): Effect.Effect<TrackedPullRequestOrderEntry[], CacheError>;
  removeTrackedPullRequest(repo: RepoIdentity, number: number): Effect.Effect<void, CacheError>;
  getCachedPatch(
    repo: RepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<string | null, CacheError>;
  storePatch(
    repo: RepoIdentity,
    number: number,
    headSha: string,
    patch: string,
  ): Effect.Effect<void, CacheError>;
  getCachedChangedFiles(
    repo: RepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<string[] | null, CacheError>;
  storeChangedFiles(
    repo: RepoIdentity,
    number: number,
    headSha: string,
    files: string[],
  ): Effect.Effect<void, CacheError>;
  updateRepoAccessTimestamp(repo: RepoIdentity): Effect.Effect<void, CacheError>;
  readProviderAccountVisibility(
    accountIds: string[],
  ): Effect.Effect<Record<string, boolean>, CacheError>;
  setProviderAccountVisibility(
    accountIds: string[],
    enabledAccountIds: string[],
  ): Effect.Effect<void, CacheError>;
  readProviderProfile(accountId: string): Effect.Effect<ProviderProfile | null, CacheError>;
  writeProviderProfile(profile: ProviderProfile): Effect.Effect<void, CacheError>;
};

class CacheService extends Effect.Tag('CacheService')<CacheService, CacheServiceShape>() {}

type PullRequestCacheRow = typeof pullRequests.$inferSelect;

function nowUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function sqlExcluded<T>(column: { name: string }) {
  return sql.raw(`excluded.${column.name}`) as SQL<T>;
}

function rowToRepo(
  row: typeof repos.$inferSelect,
  profileAccountId: string | null,
  profileLogin: string | null,
): RepoSummary {
  const providerAccountId = profileAccountId ?? '';
  return {
    providerId: row.providerId,
    repoKey: row.repoKey,
    provider: row.provider as ForgeProviderKind,
    host: row.host,
    providerAccountId,
    providerAccountLabel: profileLogin ? `${profileLogin} @ ${row.host}` : row.host,
    name: row.name,
    nameWithOwner: row.nameWithOwner,
    description: row.description,
    isPrivate: row.isPrivate,
    avatarUrl: row.avatarUrl,
  };
}

function repoIdentityFromSummary(repo: RepoSummary) {
  return {
    providerId: repo.providerId,
    repoKey: repo.repoKey,
  };
}

function repoNameFromKey(repoKey: string) {
  const segments = repoKey.split('/').filter(Boolean);
  return segments.at(-1) ?? repoKey;
}

async function getProviderProfileRowId(
  database: DatabaseTransaction,
  accountId: string,
  timestamp: number,
) {
  await database
    .insert(providerProfiles)
    .values({
      accountId,
      isEnabled: true,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: providerProfiles.accountId,
      set: { updatedAt: timestamp },
    });

  const [row] = await database
    .select({ id: providerProfiles.id })
    .from(providerProfiles)
    .where(eq(providerProfiles.accountId, accountId))
    .limit(1);

  if (!row) {
    throw new Error('Provider profile was not saved in the cache.');
  }

  return row.id;
}

async function findRepoRowId(database: Database | DatabaseTransaction, repo: RepoIdentity) {
  const [row] = await database
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.providerId, repo.providerId), eq(repos.repoKey, repo.repoKey)))
    .limit(1);

  return row?.id ?? null;
}

function rowToPullRequestListItem(row: PullRequestCacheRow): PullRequestListItem {
  return {
    number: row.prNumber,
    title: row.title,
    state: row.state,
    isDraft: row.isDraft,
    mergeStateStatus: row.mergeStateStatus,
    mergeable: row.mergeable,
    additions: row.additions,
    deletions: row.deletions,
    changeCount: row.changeCount,
    authorLogin: row.authorLogin,
    updatedAt: row.updatedAt,
    headSha: row.headSha,
    baseSha: row.baseSha,
  };
}

function rowToOverviewPullRequestSummary(input: {
  repo: typeof repos.$inferSelect;
  profileAccountId: string | null;
  profileLogin: string | null;
  pullRequest: PullRequestCacheRow;
}): OverviewPullRequestSummary {
  return {
    repo: rowToRepo(input.repo, input.profileAccountId, input.profileLogin),
    pullRequest: rowToPullRequestListItem(input.pullRequest),
  };
}

function pullRequestValues(repoRowId: number, pullRequest: PullRequestListItem) {
  return {
    repoRowId,
    prNumber: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.state,
    isDraft: pullRequest.isDraft,
    mergeStateStatus: pullRequest.mergeStateStatus,
    mergeable: pullRequest.mergeable,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    changeCount: pullRequest.changeCount,
    authorLogin: pullRequest.authorLogin,
    updatedAt: pullRequest.updatedAt,
    headSha: pullRequest.headSha,
    baseSha: pullRequest.baseSha,
  };
}

function pullRequestCacheUpdateValues(timestamp: number) {
  return {
    title: sqlExcluded(pullRequests.title),
    state: sqlExcluded(pullRequests.state),
    isDraft: sqlExcluded(pullRequests.isDraft),
    mergeStateStatus: sqlExcluded(pullRequests.mergeStateStatus),
    mergeable: sqlExcluded(pullRequests.mergeable),
    additions: sqlExcluded(pullRequests.additions),
    deletions: sqlExcluded(pullRequests.deletions),
    changeCount: sqlExcluded(pullRequests.changeCount),
    authorLogin: sqlExcluded(pullRequests.authorLogin),
    updatedAt: sqlExcluded(pullRequests.updatedAt),
    headSha: sqlExcluded(pullRequests.headSha),
    baseSha: sqlExcluded(pullRequests.baseSha),
    lastSeenAt: timestamp,
  };
}

function trackedPullRequestOrderBy() {
  return [
    sql`case when ${pullRequests.trackedPosition} is null then 1 else 0 end`,
    asc(pullRequests.trackedPosition),
    desc(pullRequests.trackedAt),
  ] as const;
}

const makeCacheService = Effect.gen(function* () {
  const database = yield* DatabaseService;

  const listSavedRepos: CacheServiceShape['listSavedRepos'] = Effect.fn(
    'CacheService.listSavedRepos',
  )(() =>
    database.query(async (db) => {
      const rows = await db
        .select({
          repo: repos,
          profileAccountId: providerProfiles.accountId,
          profileLogin: providerProfiles.login,
        })
        .from(repos)
        .leftJoin(providerProfiles, eq(providerProfiles.id, repos.providerProfileId))
        .where(gt(repos.addedAt, 0))
        .orderBy(asc(repos.addedAt));

      return rows.map((row) => rowToRepo(row.repo, row.profileAccountId, row.profileLogin));
    }),
  );

  const listTrackedRepos: CacheServiceShape['listTrackedRepos'] = Effect.fn(
    'CacheService.listTrackedRepos',
  )(() =>
    database.query(async (db) => {
      const trackedRepoRows = db
        .select({ repoRowId: pullRequests.repoRowId })
        .from(pullRequests)
        .where(sql`${pullRequests.trackedAt} is not null`)
        .groupBy(pullRequests.repoRowId)
        .as('tracked_repo_rows');

      const rows = await db
        .select({
          repo: repos,
          profileAccountId: providerProfiles.accountId,
          profileLogin: providerProfiles.login,
        })
        .from(repos)
        .innerJoin(trackedRepoRows, eq(trackedRepoRows.repoRowId, repos.id))
        .leftJoin(providerProfiles, eq(providerProfiles.id, repos.providerProfileId))
        .orderBy(asc(repos.nameWithOwner));

      return rows.map((row) => rowToRepo(row.repo, row.profileAccountId, row.profileLogin));
    }),
  );

  const listRecentPullRequests: CacheServiceShape['listRecentPullRequests'] = Effect.fn(
    'CacheService.listRecentPullRequests',
  )(() =>
    database.query(async (db) => {
      const rows = await db
        .select({
          repo: repos,
          profileAccountId: providerProfiles.accountId,
          profileLogin: providerProfiles.login,
          pullRequest: pullRequests,
        })
        .from(pullRequests)
        .innerJoin(repos, eq(repos.id, pullRequests.repoRowId))
        .leftJoin(providerProfiles, eq(providerProfiles.id, repos.providerProfileId))
        .orderBy(desc(pullRequests.lastSeenAt), desc(pullRequests.updatedAt));

      return rows.map((row) => rowToOverviewPullRequestSummary(row));
    }),
  );

  const saveRepo: CacheServiceShape['saveRepo'] = Effect.fn('CacheService.saveRepo')((repo) =>
    database.transaction(async (tx) => {
      const timestamp = nowUnixTimestamp();
      const identity = repoIdentityFromSummary(repo);
      const providerProfileId = await getProviderProfileRowId(
        tx,
        repo.providerAccountId,
        timestamp,
      );

      await tx
        .insert(repos)
        .values({
          providerId: identity.providerId,
          repoKey: identity.repoKey,
          provider: repo.provider,
          host: repo.host,
          providerProfileId,
          name: repo.name,
          nameWithOwner: repo.nameWithOwner,
          description: repo.description,
          isPrivate: repo.isPrivate,
          avatarUrl: repo.avatarUrl,
          addedAt: timestamp,
          lastOpenedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: [repos.providerId, repos.repoKey],
          set: {
            provider: repo.provider,
            host: repo.host,
            providerProfileId,
            name: repo.name,
            nameWithOwner: repo.nameWithOwner,
            description: repo.description,
            isPrivate: repo.isPrivate,
            avatarUrl: repo.avatarUrl,
            addedAt: sql<number>`case when ${repos.addedAt} = 0 then ${timestamp} else ${repos.addedAt} end`,
            lastOpenedAt: timestamp,
          },
        });
    }),
  );

  const ensureRepo: CacheServiceShape['ensureRepo'] = Effect.fn('CacheService.ensureRepo')((repo) =>
    database.transaction(async (tx) => {
      const timestamp = nowUnixTimestamp();
      const identity = createRepoIdentityFromParts(repo.providerId, repo.repoKey);
      const providerProfileId = await getProviderProfileRowId(tx, identity.accountId, timestamp);

      await tx
        .insert(repos)
        .values({
          providerId: identity.providerId,
          repoKey: identity.repoKey,
          provider: identity.provider,
          host: identity.host,
          providerProfileId,
          name: repoNameFromKey(identity.repoKey),
          nameWithOwner: identity.repoKey,
          description: null,
          isPrivate: null,
          avatarUrl: null,
          addedAt: 0,
          lastOpenedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: [repos.providerId, repos.repoKey],
          set: {
            provider: identity.provider,
            host: identity.host,
            providerProfileId,
            lastOpenedAt: timestamp,
          },
        });
    }),
  );

  const readCachedPullRequests: CacheServiceShape['readCachedPullRequests'] = Effect.fn(
    'CacheService.readCachedPullRequests',
  )((repo) =>
    database.query(async (db) => {
      const repoRowId = await findRepoRowId(db, repo);
      if (repoRowId === null) return [];

      const rows = await db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.repoRowId, repoRowId))
        .orderBy(desc(pullRequests.updatedAt));

      return rows.map(rowToPullRequestListItem);
    }),
  );

  const readTrackedPullRequests: CacheServiceShape['readTrackedPullRequests'] = Effect.fn(
    'CacheService.readTrackedPullRequests',
  )((repo) =>
    database.query(async (db) => {
      const repoRowId = await findRepoRowId(db, repo);
      if (repoRowId === null) return [];

      const rows = await db
        .select()
        .from(pullRequests)
        .where(
          and(eq(pullRequests.repoRowId, repoRowId), sql`${pullRequests.trackedAt} is not null`),
        )
        .orderBy(...trackedPullRequestOrderBy());

      return rows.map(rowToPullRequestListItem);
    }),
  );

  const readTrackedPullRequestOrder: CacheServiceShape['readTrackedPullRequestOrder'] = Effect.fn(
    'CacheService.readTrackedPullRequestOrder',
  )(() =>
    database.query(async (db) => {
      return db
        .select({
          providerId: repos.providerId,
          repoKey: repos.repoKey,
          number: pullRequests.prNumber,
        })
        .from(pullRequests)
        .innerJoin(repos, eq(repos.id, pullRequests.repoRowId))
        .where(sql`${pullRequests.trackedAt} is not null`)
        .orderBy(...trackedPullRequestOrderBy());
    }),
  );

  const writePullRequestsCache: CacheServiceShape['writePullRequestsCache'] = Effect.fn(
    'CacheService.writePullRequestsCache',
  )((repo, summaries) =>
    database.transaction(async (tx) => {
      const repoRowId = await findRepoRowId(tx, repo);
      if (repoRowId === null) return;

      const timestamp = nowUnixTimestamp();

      await tx
        .delete(pullRequests)
        .where(and(eq(pullRequests.repoRowId, repoRowId), sql`${pullRequests.trackedAt} is null`));

      if (summaries.length === 0) return;

      await tx
        .insert(pullRequests)
        .values(
          summaries.map((pullRequest) => ({
            ...pullRequestValues(repoRowId, pullRequest),
            lastSeenAt: timestamp,
          })),
        )
        .onConflictDoUpdate({
          target: [pullRequests.repoRowId, pullRequests.prNumber],
          set: pullRequestCacheUpdateValues(timestamp),
        });
    }),
  );

  const cachePullRequest: CacheServiceShape['cachePullRequest'] = Effect.fn(
    'CacheService.cachePullRequest',
  )((repo, pullRequest) =>
    database.transaction(async (tx) => {
      const repoRowId = await findRepoRowId(tx, repo);
      if (repoRowId === null) return;

      const timestamp = nowUnixTimestamp();

      await tx
        .insert(pullRequests)
        .values({
          ...pullRequestValues(repoRowId, pullRequest),
          lastSeenAt: timestamp,
        })
        .onConflictDoUpdate({
          target: [pullRequests.repoRowId, pullRequests.prNumber],
          set: pullRequestCacheUpdateValues(timestamp),
        });
    }),
  );

  const trackPullRequest: CacheServiceShape['trackPullRequest'] = Effect.fn(
    'CacheService.trackPullRequest',
  )((repo, pullRequest) =>
    database.transaction(async (tx) => {
      const repoRowId = await findRepoRowId(tx, repo);
      if (repoRowId === null) return;

      const [minTrackedPositionRow] = await tx
        .select({ trackedPosition: sql<number>`min(${pullRequests.trackedPosition})` })
        .from(pullRequests)
        .where(sql`${pullRequests.trackedAt} is not null`);
      const timestamp = nowUnixTimestamp();
      const trackedPosition =
        minTrackedPositionRow?.trackedPosition == null
          ? 0
          : minTrackedPositionRow.trackedPosition - 1;

      await tx
        .insert(pullRequests)
        .values({
          ...pullRequestValues(repoRowId, pullRequest),
          trackedAt: timestamp,
          trackedPosition,
          lastSeenAt: timestamp,
        })
        .onConflictDoUpdate({
          target: [pullRequests.repoRowId, pullRequests.prNumber],
          set: {
            ...pullRequestCacheUpdateValues(timestamp),
            trackedAt: timestamp,
            trackedPosition,
          },
        });
    }),
  );

  const setTrackedPullRequestOrder: CacheServiceShape['setTrackedPullRequestOrder'] = Effect.fn(
    'CacheService.setTrackedPullRequestOrder',
  )((entries) =>
    database.transaction(async (tx) => {
      await tx
        .update(pullRequests)
        .set({ trackedPosition: null })
        .where(sql`${pullRequests.trackedAt} is not null`);

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const repoRowId = await findRepoRowId(tx, entry);
        if (repoRowId === null) continue;

        await tx
          .update(pullRequests)
          .set({ trackedPosition: index })
          .where(
            and(eq(pullRequests.repoRowId, repoRowId), eq(pullRequests.prNumber, entry.number)),
          );
      }

      return tx
        .select({
          providerId: repos.providerId,
          repoKey: repos.repoKey,
          number: pullRequests.prNumber,
        })
        .from(pullRequests)
        .innerJoin(repos, eq(repos.id, pullRequests.repoRowId))
        .where(sql`${pullRequests.trackedAt} is not null`)
        .orderBy(...trackedPullRequestOrderBy());
    }),
  );

  const removeTrackedPullRequest: CacheServiceShape['removeTrackedPullRequest'] = Effect.fn(
    'CacheService.removeTrackedPullRequest',
  )((repo, number) =>
    database.transaction(async (tx) => {
      const repoRowId = await findRepoRowId(tx, repo);
      if (repoRowId === null) return;

      await tx
        .update(pullRequests)
        .set({ trackedAt: null, trackedPosition: null })
        .where(and(eq(pullRequests.repoRowId, repoRowId), eq(pullRequests.prNumber, number)));
    }),
  );

  const getCachedPatch: CacheServiceShape['getCachedPatch'] = Effect.fn(
    'CacheService.getCachedPatch',
  )((repo, number, headSha) =>
    database.transaction(async (tx) => {
      const repoRowId = await findRepoRowId(tx, repo);
      if (repoRowId === null) return null;

      const [row] = await tx
        .select({ patchText: prPatchCache.patchText })
        .from(prPatchCache)
        .where(
          and(
            eq(prPatchCache.repoRowId, repoRowId),
            eq(prPatchCache.prNumber, number),
            eq(prPatchCache.headSha, headSha),
          ),
        )
        .limit(1);

      if (!row) return null;

      await tx
        .update(prPatchCache)
        .set({ lastAccessedAt: nowUnixTimestamp() })
        .where(
          and(
            eq(prPatchCache.repoRowId, repoRowId),
            eq(prPatchCache.prNumber, number),
            eq(prPatchCache.headSha, headSha),
          ),
        );

      return row.patchText;
    }),
  );

  const storePatch: CacheServiceShape['storePatch'] = Effect.fn('CacheService.storePatch')(
    (repo, number, headSha, patch) =>
      database.transaction(async (tx) => {
        const repoRowId = await findRepoRowId(tx, repo);
        if (repoRowId === null) return;

        const timestamp = nowUnixTimestamp();

        await tx
          .insert(prPatchCache)
          .values({
            repoRowId,
            prNumber: number,
            headSha,
            patchText: patch,
            cachedAt: timestamp,
            lastAccessedAt: timestamp,
          })
          .onConflictDoUpdate({
            target: [prPatchCache.repoRowId, prPatchCache.prNumber, prPatchCache.headSha],
            set: {
              patchText: patch,
              cachedAt: timestamp,
              lastAccessedAt: timestamp,
            },
          });
      }),
  );

  const getCachedChangedFiles: CacheServiceShape['getCachedChangedFiles'] = Effect.fn(
    'CacheService.getCachedChangedFiles',
  )((repo, number, headSha) =>
    database.transaction(async (tx) => {
      const repoRowId = await findRepoRowId(tx, repo);
      if (repoRowId === null) return null;

      const [row] = await tx
        .select({ filesJson: prChangedFilesCache.filesJson })
        .from(prChangedFilesCache)
        .where(
          and(
            eq(prChangedFilesCache.repoRowId, repoRowId),
            eq(prChangedFilesCache.prNumber, number),
            eq(prChangedFilesCache.headSha, headSha),
          ),
        )
        .limit(1);

      if (!row) return null;

      await tx
        .update(prChangedFilesCache)
        .set({ lastAccessedAt: nowUnixTimestamp() })
        .where(
          and(
            eq(prChangedFilesCache.repoRowId, repoRowId),
            eq(prChangedFilesCache.prNumber, number),
            eq(prChangedFilesCache.headSha, headSha),
          ),
        );

      return JSON.parse(row.filesJson) as string[];
    }),
  );

  const storeChangedFiles: CacheServiceShape['storeChangedFiles'] = Effect.fn(
    'CacheService.storeChangedFiles',
  )((repo, number, headSha, files) =>
    database.transaction(async (tx) => {
      const repoRowId = await findRepoRowId(tx, repo);
      if (repoRowId === null) return;

      const timestamp = nowUnixTimestamp();
      const filesJson = JSON.stringify(files);

      await tx
        .insert(prChangedFilesCache)
        .values({
          repoRowId,
          prNumber: number,
          headSha,
          filesJson,
          cachedAt: timestamp,
          lastAccessedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: [
            prChangedFilesCache.repoRowId,
            prChangedFilesCache.prNumber,
            prChangedFilesCache.headSha,
          ],
          set: {
            filesJson,
            cachedAt: timestamp,
            lastAccessedAt: timestamp,
          },
        });
    }),
  );

  const updateRepoAccessTimestamp: CacheServiceShape['updateRepoAccessTimestamp'] = Effect.fn(
    'CacheService.updateRepoAccessTimestamp',
  )((repo) =>
    database.transaction(async (tx) => {
      await tx
        .update(repos)
        .set({ lastOpenedAt: nowUnixTimestamp() })
        .where(and(eq(repos.providerId, repo.providerId), eq(repos.repoKey, repo.repoKey)));
    }),
  );

  const readProviderAccountVisibility: CacheServiceShape['readProviderAccountVisibility'] =
    Effect.fn('CacheService.readProviderAccountVisibility')((accountIds) =>
      accountIds.length === 0
        ? Effect.succeed({})
        : database.query(async (db) => {
            const rows = await db
              .select({
                providerAccountId: providerProfiles.accountId,
                isEnabled: providerProfiles.isEnabled,
              })
              .from(providerProfiles)
              .where(inArray(providerProfiles.accountId, accountIds));

            return Object.fromEntries(rows.map((row) => [row.providerAccountId, row.isEnabled]));
          }),
    );

  const setProviderAccountVisibility: CacheServiceShape['setProviderAccountVisibility'] = Effect.fn(
    'CacheService.setProviderAccountVisibility',
  )((accountIds, enabledAccountIds) =>
    database.transaction(async (tx) => {
      const timestamp = nowUnixTimestamp();
      const enabled = new Set(enabledAccountIds);

      for (const accountId of accountIds) {
        const isEnabled = enabled.has(accountId);
        await tx
          .insert(providerProfiles)
          .values({
            accountId,
            isEnabled,
            updatedAt: timestamp,
          })
          .onConflictDoUpdate({
            target: providerProfiles.accountId,
            set: {
              isEnabled,
              updatedAt: timestamp,
            },
          });
      }
    }),
  );

  const readProviderProfile: CacheServiceShape['readProviderProfile'] = Effect.fn(
    'CacheService.readProviderProfile',
  )((accountId) =>
    database.query(async (db) => {
      const [row] = await db
        .select({
          accountId: providerProfiles.accountId,
          login: providerProfiles.login,
        })
        .from(providerProfiles)
        .where(eq(providerProfiles.accountId, accountId))
        .limit(1);

      return row?.login ? { accountId: row.accountId, login: row.login } : null;
    }),
  );

  const writeProviderProfile: CacheServiceShape['writeProviderProfile'] = Effect.fn(
    'CacheService.writeProviderProfile',
  )((profile) =>
    database.transaction(async (tx) => {
      const timestamp = nowUnixTimestamp();

      await tx
        .insert(providerProfiles)
        .values({
          accountId: profile.accountId,
          login: profile.login,
          isEnabled: true,
          updatedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: providerProfiles.accountId,
          set: {
            login: profile.login,
            updatedAt: timestamp,
          },
        });
    }),
  );

  return {
    listSavedRepos,
    listTrackedRepos,
    listRecentPullRequests,
    saveRepo,
    ensureRepo,
    readCachedPullRequests,
    readTrackedPullRequests,
    readTrackedPullRequestOrder,
    writePullRequestsCache,
    cachePullRequest,
    trackPullRequest,
    setTrackedPullRequestOrder,
    removeTrackedPullRequest,
    getCachedPatch,
    storePatch,
    getCachedChangedFiles,
    storeChangedFiles,
    updateRepoAccessTimestamp,
    readProviderAccountVisibility,
    setProviderAccountVisibility,
    readProviderProfile,
    writeProviderProfile,
  } satisfies CacheServiceShape;
});

const CacheServiceLive = Layer.effect(CacheService, makeCacheService);

export { CacheService, CacheServiceLive };
