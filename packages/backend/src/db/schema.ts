import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const authTokens = sqliteTable(
  'auth_tokens',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    clientId: text('client_id').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: integer('expires_at'),
    scopesJson: text('scopes_json').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_auth_tokens_account').on(table.accountId)],
);

export const repos = sqliteTable(
  'repos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    providerId: text('provider_id').notNull(),
    repoKey: text('repo_key').notNull(),
    provider: text('provider').notNull(),
    host: text('host').notNull(),
    providerProfileId: integer('provider_profile_id').notNull(),
    name: text('name').notNull(),
    nameWithOwner: text('name_with_owner').notNull(),
    description: text('description'),
    isPrivate: integer('is_private', { mode: 'boolean' }),
    avatarUrl: text('avatar_url'),
    addedAt: integer('added_at').notNull(),
    lastOpenedAt: integer('last_opened_at'),
  },
  (table) => [
    uniqueIndex('idx_repos_provider_id_repo_key').on(table.providerId, table.repoKey),
    index('idx_repos_provider_host').on(
      table.provider,
      table.host,
      table.providerProfileId,
      table.repoKey,
    ),
  ],
);

export const pullRequests = sqliteTable(
  'pull_requests',
  {
    repoRowId: integer('repo_row_id').notNull(),
    prNumber: integer('pr_number').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    isDraft: integer('is_draft', { mode: 'boolean' }).notNull().default(false),
    trackedAt: integer('tracked_at'),
    trackedPosition: integer('tracked_position'),
    mergeStateStatus: text('merge_state_status').notNull().default('UNKNOWN'),
    mergeable: text('mergeable').notNull().default('UNKNOWN'),
    additions: integer('additions'),
    deletions: integer('deletions'),
    changeCount: integer('change_count'),
    authorLogin: text('author_login').notNull(),
    updatedAt: text('updated_at').notNull(),
    headSha: text('head_sha').notNull(),
    baseSha: text('base_sha'),
    url: text('url'),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_pull_requests_repo_pr_number').on(table.repoRowId, table.prNumber),
    index('idx_pull_requests_repo_updated').on(table.repoRowId, sql`${table.updatedAt} desc`),
    index('idx_pull_requests_tracked_position').on(table.trackedPosition, table.trackedAt),
    index('idx_pull_requests_repo_tracked').on(table.repoRowId, table.trackedAt),
  ],
);

export const prPatchCache = sqliteTable(
  'pr_patch_cache',
  {
    repoRowId: integer('repo_row_id').notNull(),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha').notNull(),
    patchText: text('patch_text').notNull(),
    cachedAt: integer('cached_at').notNull(),
    lastAccessedAt: integer('last_accessed_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.repoRowId, table.prNumber, table.headSha] })],
);

export const prChangedFilesCache = sqliteTable(
  'pr_changed_files_cache',
  {
    repoRowId: integer('repo_row_id').notNull(),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha').notNull(),
    filesJson: text('files_json').notNull(),
    cachedAt: integer('cached_at').notNull(),
    lastAccessedAt: integer('last_accessed_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.repoRowId, table.prNumber, table.headSha] })],
);

export const providerProfiles = sqliteTable(
  'provider_profiles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id').notNull().unique(),
    provider: text('provider').notNull(),
    host: text('host').notNull(),
    login: text('login'),
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_provider_profiles_provider_host_login').on(
      table.provider,
      table.host,
      table.login,
    ),
  ],
);

export const pullRequestDataSources = sqliteTable(
  'pull_request_data_sources',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    accountId: text('account_id').notNull(),
    resourceKind: text('resource_kind').notNull(),
    resourcePath: text('resource_path'),
    resourceNamespaceKind: text('resource_namespace_kind'),
    resourceRepoJson: text('resource_repo_json'),
    statusesJson: text('statuses_json').notNull(),
    sortBy: text('sort_by').notNull(),
    groupByProject: integer('group_by_project', { mode: 'boolean' }).notNull(),
    position: integer('position').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_pr_data_sources_account').on(table.accountId),
    index('idx_pr_data_sources_position').on(table.position),
    index('idx_pr_data_sources_active').on(table.isActive),
  ],
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
