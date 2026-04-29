import { asc, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { EncryptionService } from "./encryption";
import { DatabaseService } from "../db/client";
import { authTokens } from "../db/schema";
import { normalizeHost } from "../repo-id";
import type { ForgeProviderKind, ProviderAccount } from "../../shared/types";

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

class AuthTokenStore extends Effect.Tag("AuthTokenStore")<
  AuthTokenStore,
  AuthTokenStoreShape
>() {}

type AuthTokenRow = typeof authTokens.$inferSelect;

function parseScopes(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function rowToProviderAccount(row: AuthTokenRow): ProviderAccount {
  const host = normalizeHost(row.host);
  return {
    id: row.accountId,
    provider: row.provider as ForgeProviderKind,
    host,
    clientId: row.clientId,
    viewerLogin: row.viewerLogin,
    label: row.viewerLogin ? `${row.viewerLogin} @ ${host}` : host,
    createdAt: row.createdAt,
  };
}

const makeAuthTokenStore = Effect.gen(function* () {
  const database = yield* DatabaseService;
  const encryption = yield* EncryptionService;

  const get: AuthTokenStoreShape["get"] = Effect.fn(
    "AuthTokenStore.get",
  )(function* (accountId) {
    const row = yield* database.query(async (db) => {
      const [record] = await db
        .select()
        .from(authTokens)
        .where(eq(authTokens.accountId, accountId))
        .limit(1);
      return record ?? null;
    });
    if (!row) return null;

    const accessToken = yield* encryption.decryptString(row.accessToken);
    const refreshToken = row.refreshToken
      ? yield* encryption.decryptString(row.refreshToken)
      : null;

    return {
      id: row.accountId,
      provider: row.provider as ForgeProviderKind,
      host: normalizeHost(row.host),
      clientId: row.clientId,
      accessToken,
      refreshToken,
      expiresAt: row.expiresAt,
      scopes: parseScopes(row.scopesJson),
      viewerLogin: row.viewerLogin,
      createdAt: row.createdAt,
    };
  });

  const listAccounts: AuthTokenStoreShape["listAccounts"] = Effect.fn(
    "AuthTokenStore.listAccounts",
  )(() =>
    database.query(async (db) => {
      const rows = await db
        .select()
        .from(authTokens)
        .orderBy(asc(authTokens.createdAt));
      return rows.map(rowToProviderAccount);
    }),
  );

  const save: AuthTokenStoreShape["save"] = Effect.fn(
    "AuthTokenStore.save",
  )(function* (token) {
    const normalizedHost = normalizeHost(token.host);
    const accessToken = yield* encryption.encryptString(token.accessToken);
    const refreshToken = token.refreshToken
      ? yield* encryption.encryptString(token.refreshToken)
      : null;
    const scopesJson = JSON.stringify(token.scopes);
    const timestamp = Math.floor(Date.now() / 1000);
    yield* database.transaction(async (tx) => {
      await tx
        .insert(authTokens)
        .values({
          accountId: token.id,
          provider: token.provider,
          host: normalizedHost,
          clientId: token.clientId,
          accessToken,
          refreshToken,
          expiresAt: token.expiresAt,
          scopesJson,
          viewerLogin: token.viewerLogin,
          createdAt: token.createdAt,
          updatedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: authTokens.accountId,
          set: {
            provider: token.provider,
            host: normalizedHost,
            clientId: token.clientId,
            accessToken,
            refreshToken,
            expiresAt: token.expiresAt,
            scopesJson,
            viewerLogin: token.viewerLogin,
            updatedAt: timestamp,
          },
        });
    });
  });

  const deleteToken: AuthTokenStoreShape["delete"] = Effect.fn(
    "AuthTokenStore.delete",
  )(function* (accountId) {
    yield* database.transaction(async (tx) => {
      await tx.delete(authTokens).where(eq(authTokens.accountId, accountId));
    });
  });

  return {
    get,
    listAccounts,
    save,
    delete: deleteToken,
  } satisfies AuthTokenStoreShape;
});

const AuthTokenStoreLive = Layer.effect(AuthTokenStore, makeAuthTokenStore);

export { AuthTokenStore, AuthTokenStoreLive };
export type { StoredAuthToken };
