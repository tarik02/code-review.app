import Database from "better-sqlite3";
import path from "node:path";
import { Effect, Layer } from "effect";
import { CacheError } from "./errors";
import { createRepoId } from "./repo-id";
import { app } from "electron";
import type {
  ForgeProviderKind,
  PullRequestSummary,
  RepoSummary,
} from "../shared/types";

type CacheServiceShape = {
  listSavedRepos(): Effect.Effect<RepoSummary[], CacheError>;
  saveRepo(repo: RepoSummary): Effect.Effect<void, CacheError>;
  readCachedPullRequests(repoId: string): Effect.Effect<PullRequestSummary[], CacheError>;
  writePullRequestsCache(
    repoId: string,
    pullRequests: PullRequestSummary[],
  ): Effect.Effect<void, CacheError>;
  readTrackedPullRequests(repoId: string): Effect.Effect<PullRequestSummary[], CacheError>;
  trackPullRequest(
    repoId: string,
    pullRequest: PullRequestSummary,
  ): Effect.Effect<void, CacheError>;
  removeTrackedPullRequest(repoId: string, number: number): Effect.Effect<void, CacheError>;
  getCachedPatch(
    repoId: string,
    number: number,
    headSha: string,
  ): Effect.Effect<string | null, CacheError>;
  storePatch(
    repoId: string,
    number: number,
    headSha: string,
    patch: string,
  ): Effect.Effect<void, CacheError>;
  getCachedChangedFiles(
    repoId: string,
    number: number,
    headSha: string,
  ): Effect.Effect<string[] | null, CacheError>;
  storeChangedFiles(
    repoId: string,
    number: number,
    headSha: string,
    files: string[],
  ): Effect.Effect<void, CacheError>;
  updateRepoAccessTimestamp(repoId: string): Effect.Effect<void, CacheError>;
};

class CacheService extends Effect.Tag("CacheService")<
  CacheService,
  CacheServiceShape
>() {
  static Live = Layer.succeed(this, createCacheService());
}

let db: Database.Database | null = null;

function nowUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function boolToSql(value: boolean | null) {
  if (value === null) return null;
  return value ? 1 : 0;
}

function sqlToBool(value: number | null) {
  if (value === null) return null;
  return value !== 0;
}

function getDatabase() {
  if (db) return db;

  const dbPath = path.join(app.getPath("userData"), "cache.sqlite");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      repo_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      host TEXT NOT NULL,
      provider_account_id TEXT NOT NULL DEFAULT '',
      provider_account_label TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      name_with_owner TEXT NOT NULL,
      description TEXT,
      is_private INTEGER,
      avatar_url TEXT,
      added_at INTEGER NOT NULL,
      last_opened_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_repos_provider_host
      ON repos (provider, host, provider_account_id, name_with_owner);

    CREATE TABLE IF NOT EXISTS repo_pull_requests (
      repo_key TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      is_draft INTEGER NOT NULL DEFAULT 0,
      merge_state_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      mergeable TEXT NOT NULL DEFAULT 'UNKNOWN',
      additions INTEGER,
      deletions INTEGER,
      change_count INTEGER,
      author_login TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      url TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      base_sha TEXT,
      cached_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (repo_key, pr_number)
    );

    CREATE INDEX IF NOT EXISTS idx_repo_pull_requests_repo_updated
      ON repo_pull_requests (repo_key, updated_at DESC);

    CREATE TABLE IF NOT EXISTS pr_patch_cache (
      repo_key TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      head_sha TEXT NOT NULL,
      patch_text TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      PRIMARY KEY (repo_key, pr_number, head_sha)
    );

    CREATE TABLE IF NOT EXISTS pr_changed_files_cache (
      repo_key TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      head_sha TEXT NOT NULL,
      files_json TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      PRIMARY KEY (repo_key, pr_number, head_sha)
    );

    CREATE TABLE IF NOT EXISTS tracked_pull_requests (
      repo_key TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      is_draft INTEGER NOT NULL DEFAULT 0,
      merge_state_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      mergeable TEXT NOT NULL DEFAULT 'UNKNOWN',
      additions INTEGER,
      deletions INTEGER,
      change_count INTEGER,
      author_login TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      url TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      base_sha TEXT,
      added_at INTEGER NOT NULL,
      last_refreshed_at INTEGER NOT NULL,
      PRIMARY KEY (repo_key, pr_number)
    );

    CREATE INDEX IF NOT EXISTS idx_tracked_pull_requests_repo_added
      ON tracked_pull_requests (repo_key, added_at DESC);
  `);
  try {
    db.exec("ALTER TABLE repos ADD COLUMN provider_account_id TEXT NOT NULL DEFAULT '';");
  } catch {
    // Column already exists.
  }
  try {
    db.exec("ALTER TABLE repos ADD COLUMN provider_account_label TEXT NOT NULL DEFAULT '';");
  } catch {
    // Column already exists.
  }

  return db;
}

function rowToPullRequest(row: Record<string, unknown>): PullRequestSummary {
  return {
    number: Number(row.pr_number),
    title: String(row.title),
    state: String(row.state),
    isDraft: Number(row.is_draft) !== 0,
    mergeStateStatus: String(row.merge_state_status),
    mergeable: String(row.mergeable),
    additions: row.additions === null ? null : Number(row.additions),
    deletions: row.deletions === null ? null : Number(row.deletions),
    changeCount: row.change_count === null ? null : Number(row.change_count),
    authorLogin: String(row.author_login),
    updatedAt: String(row.updated_at),
    url: String(row.url),
    headSha: String(row.head_sha),
    baseSha: row.base_sha === null ? null : String(row.base_sha),
  };
}

function pullRequestParams(repoId: string, pullRequest: PullRequestSummary, timestamp: number) {
  return {
    repo_key: repoId,
    pr_number: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.state,
    is_draft: pullRequest.isDraft ? 1 : 0,
    merge_state_status: pullRequest.mergeStateStatus,
    mergeable: pullRequest.mergeable,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    change_count: pullRequest.changeCount,
    author_login: pullRequest.authorLogin,
    updated_at: pullRequest.updatedAt,
    url: pullRequest.url,
    head_sha: pullRequest.headSha,
    base_sha: pullRequest.baseSha,
    timestamp,
  };
}

function wrap<A>(operation: () => A): Effect.Effect<A, CacheError> {
  return Effect.try({
    try: operation,
    catch: (error) =>
      new CacheError(error instanceof Error ? error.message : String(error)),
  });
}

function createCacheService(): CacheServiceShape {
  return {
    listSavedRepos: () =>
      wrap(() => {
        const rows = getDatabase()
          .prepare(
            `
            SELECT repo_key, provider, host, provider_account_id, provider_account_label,
              name, name_with_owner, description, is_private, avatar_url
            FROM repos
            ORDER BY added_at ASC
            `,
          )
          .all() as Record<string, unknown>[];

        return rows.map((row) => ({
          id: String(row.repo_key),
          provider: String(row.provider) as ForgeProviderKind,
          host: String(row.host),
          providerAccountId: String(row.provider_account_id),
          providerAccountLabel: String(row.provider_account_label),
          name: String(row.name),
          nameWithOwner: String(row.name_with_owner),
          description: row.description === null ? null : String(row.description),
          isPrivate: sqlToBool(row.is_private as number | null),
          avatarUrl: row.avatar_url === null ? null : String(row.avatar_url),
        }));
      }),

    saveRepo: (repo) =>
      wrap(() => {
        const timestamp = nowUnixTimestamp();
        const repoKey =
          repo.id.trim().length > 0
            ? repo.id
            : createRepoId(
                repo.provider,
                repo.host,
                repo.providerAccountId,
                repo.nameWithOwner,
              ).key;
        getDatabase()
          .prepare(
            `
            INSERT INTO repos (
              repo_key, provider, host, provider_account_id, provider_account_label,
              name, name_with_owner, description, is_private, avatar_url, added_at,
              last_opened_at
            )
            VALUES (
              @repo_key, @provider, @host, @provider_account_id,
              @provider_account_label, @name, @name_with_owner, @description,
              @is_private, @avatar_url, @timestamp, @timestamp
            )
            ON CONFLICT(repo_key)
            DO UPDATE SET
              provider = excluded.provider,
              host = excluded.host,
              provider_account_id = excluded.provider_account_id,
              provider_account_label = excluded.provider_account_label,
              name = excluded.name,
              name_with_owner = excluded.name_with_owner,
              description = excluded.description,
              is_private = excluded.is_private,
              avatar_url = excluded.avatar_url
            `,
          )
          .run({
            repo_key: repoKey,
            provider: repo.provider,
            host: repo.host,
            provider_account_id: repo.providerAccountId,
            provider_account_label: repo.providerAccountLabel,
            name: repo.name,
            name_with_owner: repo.nameWithOwner,
            description: repo.description,
            is_private: boolToSql(repo.isPrivate),
            avatar_url: repo.avatarUrl,
            timestamp,
          });
      }),

    readCachedPullRequests: (repoId) =>
      wrap(() => {
        const rows = getDatabase()
          .prepare(
            `
            SELECT pr_number, title, state, is_draft, merge_state_status, mergeable,
              additions, deletions, change_count, author_login, updated_at, url,
              head_sha, base_sha
            FROM repo_pull_requests
            WHERE repo_key = ?
            ORDER BY updated_at DESC
            `,
          )
          .all(repoId) as Record<string, unknown>[];
        return rows.map(rowToPullRequest);
      }),

    writePullRequestsCache: (repoId, pullRequests) =>
      wrap(() => {
        const database = getDatabase();
        const timestamp = nowUnixTimestamp();
        const insert = database.prepare(`
          INSERT INTO repo_pull_requests (
            repo_key, pr_number, title, state, is_draft, merge_state_status, mergeable,
            additions, deletions, change_count, author_login, updated_at, url,
            head_sha, base_sha, cached_at, last_seen_at
          )
          VALUES (
            @repo_key, @pr_number, @title, @state, @is_draft, @merge_state_status,
            @mergeable, @additions, @deletions, @change_count, @author_login,
            @updated_at, @url, @head_sha, @base_sha, @timestamp, @timestamp
          )
        `);
        database.transaction(() => {
          database.prepare("DELETE FROM repo_pull_requests WHERE repo_key = ?").run(repoId);
          for (const pullRequest of pullRequests) {
            insert.run(pullRequestParams(repoId, pullRequest, timestamp));
          }
        })();
      }),

    readTrackedPullRequests: (repoId) =>
      wrap(() => {
        const rows = getDatabase()
          .prepare(
            `
            SELECT pr_number, title, state, is_draft, merge_state_status, mergeable,
              additions, deletions, change_count, author_login, updated_at, url,
              head_sha, base_sha
            FROM tracked_pull_requests
            WHERE repo_key = ?
            ORDER BY added_at DESC
            `,
          )
          .all(repoId) as Record<string, unknown>[];
        return rows.map(rowToPullRequest);
      }),

    trackPullRequest: (repoId, pullRequest) =>
      wrap(() => {
        const timestamp = nowUnixTimestamp();
        getDatabase()
          .prepare(
            `
            INSERT INTO tracked_pull_requests (
              repo_key, pr_number, title, state, is_draft, merge_state_status, mergeable,
              additions, deletions, change_count, author_login, updated_at, url,
              head_sha, base_sha, added_at, last_refreshed_at
            )
            VALUES (
              @repo_key, @pr_number, @title, @state, @is_draft, @merge_state_status,
              @mergeable, @additions, @deletions, @change_count, @author_login,
              @updated_at, @url, @head_sha, @base_sha, @timestamp, @timestamp
            )
            ON CONFLICT(repo_key, pr_number)
            DO UPDATE SET
              title = excluded.title,
              state = excluded.state,
              is_draft = excluded.is_draft,
              merge_state_status = excluded.merge_state_status,
              mergeable = excluded.mergeable,
              additions = excluded.additions,
              deletions = excluded.deletions,
              change_count = excluded.change_count,
              author_login = excluded.author_login,
              updated_at = excluded.updated_at,
              url = excluded.url,
              head_sha = excluded.head_sha,
              base_sha = excluded.base_sha,
              last_refreshed_at = excluded.last_refreshed_at
            `,
          )
          .run(pullRequestParams(repoId, pullRequest, timestamp));
      }),

    removeTrackedPullRequest: (repoId, number) =>
      wrap(() => {
        getDatabase()
          .prepare(
            `
            DELETE FROM tracked_pull_requests
            WHERE repo_key = ? AND pr_number = ?
            `,
          )
          .run(repoId, number);
      }),

    getCachedPatch: (repoId, number, headSha) =>
      wrap(() => {
        const row = getDatabase()
          .prepare(
            `
            SELECT patch_text
            FROM pr_patch_cache
            WHERE repo_key = ? AND pr_number = ? AND head_sha = ?
            `,
          )
          .get(repoId, number, headSha) as { patch_text: string } | undefined;
        if (!row) return null;
        getDatabase()
          .prepare(
            `
            UPDATE pr_patch_cache
            SET last_accessed_at = ?
            WHERE repo_key = ? AND pr_number = ? AND head_sha = ?
            `,
          )
          .run(nowUnixTimestamp(), repoId, number, headSha);
        return row.patch_text;
      }),

    storePatch: (repoId, number, headSha, patch) =>
      wrap(() => {
        const timestamp = nowUnixTimestamp();
        getDatabase()
          .prepare(
            `
            INSERT INTO pr_patch_cache (
              repo_key, pr_number, head_sha, patch_text, cached_at, last_accessed_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(repo_key, pr_number, head_sha)
            DO UPDATE SET
              patch_text = excluded.patch_text,
              cached_at = excluded.cached_at,
              last_accessed_at = excluded.last_accessed_at
            `,
          )
          .run(repoId, number, headSha, patch, timestamp, timestamp);
      }),

    getCachedChangedFiles: (repoId, number, headSha) =>
      wrap(() => {
        const row = getDatabase()
          .prepare(
            `
            SELECT files_json
            FROM pr_changed_files_cache
            WHERE repo_key = ? AND pr_number = ? AND head_sha = ?
            `,
          )
          .get(repoId, number, headSha) as { files_json: string } | undefined;
        if (!row) return null;
        getDatabase()
          .prepare(
            `
            UPDATE pr_changed_files_cache
            SET last_accessed_at = ?
            WHERE repo_key = ? AND pr_number = ? AND head_sha = ?
            `,
          )
          .run(nowUnixTimestamp(), repoId, number, headSha);
        return JSON.parse(row.files_json) as string[];
      }),

    storeChangedFiles: (repoId, number, headSha, files) =>
      wrap(() => {
        const timestamp = nowUnixTimestamp();
        getDatabase()
          .prepare(
            `
            INSERT INTO pr_changed_files_cache (
              repo_key, pr_number, head_sha, files_json, cached_at, last_accessed_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(repo_key, pr_number, head_sha)
            DO UPDATE SET
              files_json = excluded.files_json,
              cached_at = excluded.cached_at,
              last_accessed_at = excluded.last_accessed_at
            `,
          )
          .run(repoId, number, headSha, JSON.stringify(files), timestamp, timestamp);
      }),

    updateRepoAccessTimestamp: (repoId) =>
      wrap(() => {
        getDatabase()
          .prepare("UPDATE repos SET last_opened_at = ? WHERE repo_key = ?")
          .run(nowUnixTimestamp(), repoId);
      }),
  };
}

export { CacheService };
