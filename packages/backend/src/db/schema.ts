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
    accountId: text('account_id').primaryKey(),
    provider: text('provider').notNull(),
    host: text('host').notNull(),
    clientId: text('client_id').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: integer('expires_at'),
    scopesJson: text('scopes_json').notNull(),
    viewerLogin: text('viewer_login'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('idx_auth_tokens_provider_host').on(table.provider, table.host)],
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
    id: integer('id').primaryKey({ autoIncrement: true }),
    repoRowId: integer('repo_row_id').notNull(),
    prNumber: integer('pr_number').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    isDraft: integer('is_draft', { mode: 'boolean' }).notNull().default(false),
    isTracked: integer('is_tracked', { mode: 'boolean' }).notNull().default(false),
    mergeStateStatus: text('merge_state_status').notNull().default('UNKNOWN'),
    mergeable: text('mergeable').notNull().default('UNKNOWN'),
    additions: integer('additions'),
    deletions: integer('deletions'),
    changeCount: integer('change_count'),
    authorLogin: text('author_login').notNull(),
    updatedAt: text('updated_at').notNull(),
    url: text('url').notNull(),
    headSha: text('head_sha').notNull(),
    baseSha: text('base_sha'),
    cachedAt: integer('cached_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_pull_requests_repo_pr_number').on(table.repoRowId, table.prNumber),
    index('idx_pull_requests_repo_updated').on(table.repoRowId, sql`${table.updatedAt} desc`),
    index('idx_pull_requests_repo_tracked').on(table.repoRowId, table.isTracked),
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

export const pendingReviewSessions = sqliteTable(
  'pending_review_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    repoRowId: integer('repo_row_id').notNull(),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha').notNull(),
    providerReviewId: text('provider_review_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_pending_review_sessions_repo_pr').on(table.repoRowId, table.prNumber),
    index('idx_pending_review_sessions_repo_pr_head').on(
      table.repoRowId,
      table.prNumber,
      table.headSha,
    ),
  ],
);

export const pendingReviewComments = sqliteTable(
  'pending_review_comments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id').notNull(),
    kind: text('kind').notNull(),
    providerCommentId: text('provider_comment_id'),
    providerThreadId: text('provider_thread_id'),
    replyToThreadId: text('reply_to_thread_id'),
    body: text('body').notNull(),
    path: text('path').notNull(),
    oldPath: text('old_path').notNull(),
    newPath: text('new_path').notNull(),
    line: integer('line'),
    side: text('side'),
    startLine: integer('start_line'),
    startSide: text('start_side'),
    subjectType: text('subject_type').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_pending_review_comments_session').on(table.sessionId),
    uniqueIndex('idx_pending_review_comments_provider_comment').on(
      table.sessionId,
      table.providerCommentId,
    ),
  ],
);

export const providerProfiles = sqliteTable('provider_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: text('account_id').notNull().unique(),
  login: text('login'),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  updatedAt: integer('updated_at').notNull(),
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
