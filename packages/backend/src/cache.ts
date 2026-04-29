import { and, asc, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { DatabaseService, type Database, type DatabaseTransaction } from './db/client.ts';
import {
  pendingReviewComments,
  pendingReviewSessions,
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
  PendingReviewComment,
  PendingReviewSession,
  ProviderProfile,
  RepoIdentity,
  PullRequestSummary,
  RepoSummary,
} from '@code-review-app/shared';

type PendingReviewCommentWrite = {
  headSha: string;
  kind: PendingReviewComment['kind'];
  providerCommentId: string | null;
  providerThreadId: string | null;
  replyToThreadId: string | null;
  body: string;
  path: string;
  oldPath: string;
  newPath: string;
  line: number | null;
  side: PendingReviewComment['side'];
  startLine: number | null;
  startSide: PendingReviewComment['startSide'];
  subjectType: PendingReviewComment['subjectType'];
};

type CacheServiceShape = {
  listSavedRepos(): Effect.Effect<RepoSummary[], CacheError>;
  listTrackedRepos(): Effect.Effect<RepoSummary[], CacheError>;
  saveRepo(repo: RepoSummary): Effect.Effect<void, CacheError>;
  ensureRepo(repo: RepoIdentity): Effect.Effect<void, CacheError>;
  readCachedPullRequests(repo: RepoIdentity): Effect.Effect<PullRequestSummary[], CacheError>;
  writePullRequestsCache(
    repo: RepoIdentity,
    pullRequests: PullRequestSummary[],
  ): Effect.Effect<void, CacheError>;
  readTrackedPullRequests(repo: RepoIdentity): Effect.Effect<PullRequestSummary[], CacheError>;
  trackPullRequest(
    repo: RepoIdentity,
    pullRequest: PullRequestSummary,
  ): Effect.Effect<void, CacheError>;
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
  getPendingReviewSession(
    repo: RepoIdentity,
    number: number,
  ): Effect.Effect<PendingReviewSession | null, CacheError>;
  ensurePendingReviewSession(
    repo: RepoIdentity,
    number: number,
    headSha: string,
    providerReviewId: string | null,
  ): Effect.Effect<PendingReviewSession, CacheError>;
  listPendingReviewComments(
    repo: RepoIdentity,
    number: number,
  ): Effect.Effect<PendingReviewComment[], CacheError>;
  insertPendingReviewComment(
    repo: RepoIdentity,
    number: number,
    comment: PendingReviewCommentWrite,
  ): Effect.Effect<PendingReviewComment, CacheError>;
  updatePendingReviewComment(
    repo: RepoIdentity,
    number: number,
    pendingCommentId: number,
    body: string,
    providerCommentId?: string | null,
  ): Effect.Effect<PendingReviewComment | null, CacheError>;
  deletePendingReviewComment(
    repo: RepoIdentity,
    number: number,
    pendingCommentId: number,
  ): Effect.Effect<PendingReviewComment | null, CacheError>;
  clearPendingReview(repo: RepoIdentity, number: number): Effect.Effect<void, CacheError>;
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

async function ensureRepoRowId(database: DatabaseTransaction, repo: RepoIdentity) {
  const existingRepoRowId = await findRepoRowId(database, repo);
  if (existingRepoRowId !== null) return existingRepoRowId;

  const timestamp = nowUnixTimestamp();
  const identity = createRepoIdentityFromParts(repo.providerId, repo.repoKey);
  const providerProfileId = await getProviderProfileRowId(database, identity.accountId, timestamp);

  await database
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

  const repoRowId = await findRepoRowId(database, repo);
  if (repoRowId === null) {
    throw new Error('Repo was not saved in the cache.');
  }
  return repoRowId;
}

function rowToPullRequest(row: PullRequestCacheRow): PullRequestSummary {
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
    url: row.url,
    headSha: row.headSha,
    baseSha: row.baseSha,
  };
}

function rowToPendingReviewSession(
  repo: RepoIdentity,
  row: typeof pendingReviewSessions.$inferSelect,
): PendingReviewSession {
  return {
    providerId: repo.providerId,
    repoKey: repo.repoKey,
    id: row.id,
    number: row.prNumber,
    headSha: row.headSha,
    providerReviewId: row.providerReviewId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToPendingReviewComment(
  repo: RepoIdentity,
  session: typeof pendingReviewSessions.$inferSelect,
  row: typeof pendingReviewComments.$inferSelect,
): PendingReviewComment {
  return {
    providerId: repo.providerId,
    repoKey: repo.repoKey,
    id: row.id,
    sessionId: row.sessionId,
    number: session.prNumber,
    headSha: session.headSha,
    kind: row.kind as PendingReviewComment['kind'],
    providerCommentId: row.providerCommentId,
    providerThreadId: row.providerThreadId,
    replyToThreadId: row.replyToThreadId,
    body: row.body,
    path: row.path,
    oldPath: row.oldPath,
    newPath: row.newPath,
    line: row.line,
    side: row.side as PendingReviewComment['side'],
    startLine: row.startLine,
    startSide: row.startSide as PendingReviewComment['startSide'],
    subjectType: row.subjectType as PendingReviewComment['subjectType'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function pullRequestValues(repoRowId: number, pullRequest: PullRequestSummary) {
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
    url: pullRequest.url,
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
    url: sqlExcluded(pullRequests.url),
    headSha: sqlExcluded(pullRequests.headSha),
    baseSha: sqlExcluded(pullRequests.baseSha),
    cachedAt: timestamp,
    lastSeenAt: timestamp,
  };
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
        .where(eq(pullRequests.isTracked, true))
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

      return rows.map(rowToPullRequest);
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
        .where(and(eq(pullRequests.repoRowId, repoRowId), eq(pullRequests.isTracked, false)));

      if (summaries.length === 0) return;

      await tx
        .insert(pullRequests)
        .values(
          summaries.map((pullRequest) => ({
            ...pullRequestValues(repoRowId, pullRequest),
            isTracked: false,
            cachedAt: timestamp,
            lastSeenAt: timestamp,
          })),
        )
        .onConflictDoUpdate({
          target: [pullRequests.repoRowId, pullRequests.prNumber],
          set: pullRequestCacheUpdateValues(timestamp),
        });
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
        .where(and(eq(pullRequests.repoRowId, repoRowId), eq(pullRequests.isTracked, true)))
        .orderBy(desc(pullRequests.updatedAt));

      return rows.map(rowToPullRequest);
    }),
  );

  const trackPullRequest: CacheServiceShape['trackPullRequest'] = Effect.fn(
    'CacheService.trackPullRequest',
  )((repo, pullRequest) =>
    database.transaction(async (tx) => {
      const repoRowId = await findRepoRowId(tx, repo);
      if (repoRowId === null) return;

      const timestamp = nowUnixTimestamp();
      const values = pullRequestValues(repoRowId, pullRequest);

      await tx
        .insert(pullRequests)
        .values({
          ...values,
          isTracked: true,
          cachedAt: timestamp,
          lastSeenAt: timestamp,
        })
        .onConflictDoUpdate({
          target: [pullRequests.repoRowId, pullRequests.prNumber],
          set: {
            ...pullRequestCacheUpdateValues(timestamp),
            isTracked: true,
          },
        });
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
        .set({ isTracked: false })
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

  const getPendingReviewSession: CacheServiceShape['getPendingReviewSession'] = Effect.fn(
    'CacheService.getPendingReviewSession',
  )((repo, number) =>
    database.query(async (db) => {
      const repoRowId = await findRepoRowId(db, repo);
      if (repoRowId === null) return null;

      const [row] = await db
        .select()
        .from(pendingReviewSessions)
        .where(
          and(
            eq(pendingReviewSessions.repoRowId, repoRowId),
            eq(pendingReviewSessions.prNumber, number),
          ),
        )
        .limit(1);

      return row ? rowToPendingReviewSession(repo, row) : null;
    }),
  );

  const ensurePendingReviewSession: CacheServiceShape['ensurePendingReviewSession'] = Effect.fn(
    'CacheService.ensurePendingReviewSession',
  )((repo, number, headSha, providerReviewId) =>
    database.transaction(async (tx) => {
      const repoRowId = await ensureRepoRowId(tx, repo);
      const timestamp = nowUnixTimestamp();

      await tx
        .insert(pendingReviewSessions)
        .values({
          repoRowId,
          prNumber: number,
          headSha,
          providerReviewId,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: [pendingReviewSessions.repoRowId, pendingReviewSessions.prNumber],
          set: {
            headSha,
            providerReviewId,
            updatedAt: timestamp,
          },
        });

      const [row] = await tx
        .select()
        .from(pendingReviewSessions)
        .where(
          and(
            eq(pendingReviewSessions.repoRowId, repoRowId),
            eq(pendingReviewSessions.prNumber, number),
          ),
        )
        .limit(1);

      if (!row) {
        throw new Error('Pending review session was not saved in the cache.');
      }
      return rowToPendingReviewSession(repo, row);
    }),
  );

  const listPendingReviewComments: CacheServiceShape['listPendingReviewComments'] = Effect.fn(
    'CacheService.listPendingReviewComments',
  )((repo, number) =>
    database.query(async (db) => {
      const repoRowId = await findRepoRowId(db, repo);
      if (repoRowId === null) return [];

      const rows = await db
        .select({
          session: pendingReviewSessions,
          comment: pendingReviewComments,
        })
        .from(pendingReviewComments)
        .innerJoin(
          pendingReviewSessions,
          eq(pendingReviewSessions.id, pendingReviewComments.sessionId),
        )
        .where(
          and(
            eq(pendingReviewSessions.repoRowId, repoRowId),
            eq(pendingReviewSessions.prNumber, number),
          ),
        )
        .orderBy(asc(pendingReviewComments.createdAt), asc(pendingReviewComments.id));

      return rows.map((row) => rowToPendingReviewComment(repo, row.session, row.comment));
    }),
  );

  const insertPendingReviewComment: CacheServiceShape['insertPendingReviewComment'] = Effect.fn(
    'CacheService.insertPendingReviewComment',
  )((repo, number, comment) =>
    database.transaction(async (tx) => {
      const repoRowId = await ensureRepoRowId(tx, repo);
      const [session] = await tx
        .select()
        .from(pendingReviewSessions)
        .where(
          and(
            eq(pendingReviewSessions.repoRowId, repoRowId),
            eq(pendingReviewSessions.prNumber, number),
          ),
        )
        .limit(1);

      if (!session) {
        throw new Error('Pending review session is required before inserting comments.');
      }

      const timestamp = nowUnixTimestamp();
      const [inserted] = await tx
        .insert(pendingReviewComments)
        .values({
          sessionId: session.id,
          kind: comment.kind,
          providerCommentId: comment.providerCommentId,
          providerThreadId: comment.providerThreadId,
          replyToThreadId: comment.replyToThreadId,
          body: comment.body,
          path: comment.path,
          oldPath: comment.oldPath,
          newPath: comment.newPath,
          line: comment.line,
          side: comment.side,
          startLine: comment.startLine,
          startSide: comment.startSide,
          subjectType: comment.subjectType,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      if (!inserted) {
        throw new Error('Pending review comment was not saved in the cache.');
      }
      return rowToPendingReviewComment(repo, session, inserted);
    }),
  );

  const updatePendingReviewComment: CacheServiceShape['updatePendingReviewComment'] = Effect.fn(
    'CacheService.updatePendingReviewComment',
  )((repo, number, pendingCommentId, body, providerCommentId) =>
    database.transaction(async (tx) => {
      const repoRowId = await findRepoRowId(tx, repo);
      if (repoRowId === null) return null;

      const [existing] = await tx
        .select({
          session: pendingReviewSessions,
          comment: pendingReviewComments,
        })
        .from(pendingReviewComments)
        .innerJoin(
          pendingReviewSessions,
          eq(pendingReviewSessions.id, pendingReviewComments.sessionId),
        )
        .where(
          and(
            eq(pendingReviewSessions.repoRowId, repoRowId),
            eq(pendingReviewSessions.prNumber, number),
            eq(pendingReviewComments.id, pendingCommentId),
          ),
        )
        .limit(1);

      if (!existing) return null;

      const setValues: Partial<typeof pendingReviewComments.$inferInsert> = {
        body,
        updatedAt: nowUnixTimestamp(),
      };
      if (providerCommentId !== undefined) {
        setValues.providerCommentId = providerCommentId;
      }

      const [updated] = await tx
        .update(pendingReviewComments)
        .set(setValues)
        .where(eq(pendingReviewComments.id, pendingCommentId))
        .returning();

      return updated ? rowToPendingReviewComment(repo, existing.session, updated) : null;
    }),
  );

  const deletePendingReviewComment: CacheServiceShape['deletePendingReviewComment'] = Effect.fn(
    'CacheService.deletePendingReviewComment',
  )((repo, number, pendingCommentId) =>
    database.transaction(async (tx) => {
      const repoRowId = await findRepoRowId(tx, repo);
      if (repoRowId === null) return null;

      const [existing] = await tx
        .select({
          session: pendingReviewSessions,
          comment: pendingReviewComments,
        })
        .from(pendingReviewComments)
        .innerJoin(
          pendingReviewSessions,
          eq(pendingReviewSessions.id, pendingReviewComments.sessionId),
        )
        .where(
          and(
            eq(pendingReviewSessions.repoRowId, repoRowId),
            eq(pendingReviewSessions.prNumber, number),
            eq(pendingReviewComments.id, pendingCommentId),
          ),
        )
        .limit(1);

      if (!existing) return null;

      await tx.delete(pendingReviewComments).where(eq(pendingReviewComments.id, pendingCommentId));
      return rowToPendingReviewComment(repo, existing.session, existing.comment);
    }),
  );

  const clearPendingReview: CacheServiceShape['clearPendingReview'] = Effect.fn(
    'CacheService.clearPendingReview',
  )((repo, number) =>
    database.transaction(async (tx) => {
      const repoRowId = await findRepoRowId(tx, repo);
      if (repoRowId === null) return;

      const [session] = await tx
        .select()
        .from(pendingReviewSessions)
        .where(
          and(
            eq(pendingReviewSessions.repoRowId, repoRowId),
            eq(pendingReviewSessions.prNumber, number),
          ),
        )
        .limit(1);

      if (!session) return;

      await tx
        .delete(pendingReviewComments)
        .where(eq(pendingReviewComments.sessionId, session.id));
      await tx.delete(pendingReviewSessions).where(eq(pendingReviewSessions.id, session.id));
    }),
  );

  return {
    listSavedRepos,
    listTrackedRepos,
    saveRepo,
    ensureRepo,
    readCachedPullRequests,
    writePullRequestsCache,
    readTrackedPullRequests,
    trackPullRequest,
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
    getPendingReviewSession,
    ensurePendingReviewSession,
    listPendingReviewComments,
    insertPendingReviewComment,
    updatePendingReviewComment,
    deletePendingReviewComment,
    clearPendingReview,
  } satisfies CacheServiceShape;
});

const CacheServiceLive = Layer.effect(CacheService, makeCacheService);

export { CacheService, CacheServiceLive };
