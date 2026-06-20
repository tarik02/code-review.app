import { eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { EncryptionService } from './encryption.ts';
import { DatabaseService } from '../db/client.ts';
import { authTokens, providerProfiles } from '../db/schema.ts';
import { normalizeHost } from '../repo-id.ts';
import type { ForgeProviderKind, ProviderAccount } from '@code-review-app/shared';

type StoredAuthToken = {
  id: string;
  provider: ForgeProviderKind;
  host: string;
  clientId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
  viewerLogin: string | null;
  createdAt: number;
};

type AuthTokenStoreShape = {
  get(accountId: string): Effect.Effect<StoredAuthToken | null, Error>;
  listAccounts(): Effect.Effect<ProviderAccount[], Error>;
  save(token: StoredAuthToken): Effect.Effect<void, Error>;
  delete(accountId: string): Effect.Effect<void, Error>;
};

class AuthTokenStore extends Effect.Tag('AuthTokenStore')<AuthTokenStore, AuthTokenStoreShape>() {}

type AuthTokenRow = typeof authTokens.$inferSelect;
type ProviderProfileRow = typeof providerProfiles.$inferSelect;

function parseScopes(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function rowToProviderAccount(row: AuthTokenRow, profile: ProviderProfileRow): ProviderAccount {
  const host = normalizeHost(profile.host);
  return {
    id: row.accountId,
    provider: profile.provider as ForgeProviderKind,
    host,
    clientId: row.clientId,
    viewerLogin: profile.login,
    label: profile.login ? `${profile.login} @ ${host}` : host,
    createdAt: row.createdAt,
  };
}

const makeAuthTokenStore = Effect.gen(function* () {
  const database = yield* DatabaseService;
  const encryption = yield* EncryptionService;

  const get: AuthTokenStoreShape['get'] = Effect.fn('AuthTokenStore.get')(function* (accountId) {
    const row = yield* database.query(async (db) => {
      const [record] = await db
        .select({
          token: authTokens,
          profile: providerProfiles,
        })
        .from(authTokens)
        .innerJoin(providerProfiles, eq(providerProfiles.accountId, authTokens.accountId))
        .where(eq(authTokens.accountId, accountId))
        .limit(1);
      return record ?? null;
    });
    if (!row) return null;

    const accessToken = yield* encryption.decryptString(row.token.accessToken);
    if (!accessToken) return null;

    const refreshToken = row.token.refreshToken
      ? yield* encryption.decryptString(row.token.refreshToken)
      : null;
    const host = normalizeHost(row.profile.host);

    return {
      id: row.token.accountId,
      provider: row.profile.provider as ForgeProviderKind,
      host,
      clientId: row.token.clientId,
      accessToken,
      refreshToken,
      expiresAt: row.token.expiresAt,
      scopes: parseScopes(row.token.scopesJson),
      viewerLogin: row.profile.login,
      createdAt: row.token.createdAt,
    };
  });

  const listAccounts: AuthTokenStoreShape['listAccounts'] = Effect.fn(
    'AuthTokenStore.listAccounts',
  )(() =>
    database.query(async (db) => {
      const rows = await db
        .select({
          token: authTokens,
          profile: providerProfiles,
        })
        .from(authTokens)
        .innerJoin(providerProfiles, eq(providerProfiles.accountId, authTokens.accountId))
        .orderBy(authTokens.createdAt);
      return rows.map((row) => rowToProviderAccount(row.token, row.profile));
    }),
  );

  const save: AuthTokenStoreShape['save'] = Effect.fn('AuthTokenStore.save')(function* (token) {
    const normalizedHost = normalizeHost(token.host);
    const accessToken = yield* encryption.encryptString(token.accessToken);
    const refreshToken = token.refreshToken
      ? yield* encryption.encryptString(token.refreshToken)
      : null;
    const scopesJson = JSON.stringify(token.scopes);
    const timestamp = Math.floor(Date.now() / 1000);
    yield* database.transaction(async (tx) => {
      await tx
        .insert(providerProfiles)
        .values({
          accountId: token.id,
          provider: token.provider,
          host: normalizedHost,
          login: token.viewerLogin,
          isEnabled: true,
          updatedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: providerProfiles.accountId,
          set: {
            provider: token.provider,
            host: normalizedHost,
            login: token.viewerLogin,
            updatedAt: timestamp,
          },
        });
      await tx
        .insert(authTokens)
        .values({
          id: randomUUID(),
          accountId: token.id,
          clientId: token.clientId,
          accessToken,
          refreshToken,
          expiresAt: token.expiresAt,
          scopesJson,
          createdAt: token.createdAt,
          updatedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: authTokens.accountId,
          set: {
            clientId: token.clientId,
            accessToken,
            refreshToken,
            expiresAt: token.expiresAt,
            scopesJson,
            updatedAt: timestamp,
          },
        });
    });
  });

  const deleteToken: AuthTokenStoreShape['delete'] = Effect.fn('AuthTokenStore.delete')(
    function* (accountId) {
      yield* database.transaction(async (tx) => {
        await tx.delete(authTokens).where(eq(authTokens.accountId, accountId));
      });
    },
  );

  return {
    get,
    listAccounts,
    save,
    delete: deleteToken,
  } satisfies AuthTokenStoreShape;
});

const AuthTokenStoreLive = Layer.effect(AuthTokenStore, makeAuthTokenStore);

export { AuthTokenStore, AuthTokenStoreLive };
export type { AuthTokenStoreShape, StoredAuthToken };
