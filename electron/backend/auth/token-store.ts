import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import { Effect, Layer } from "effect";
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

type StoredAuthTokenRecord = Omit<StoredAuthToken, "accessToken" | "refreshToken"> & {
  accessToken: string;
  refreshToken: string | null;
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

const TOKEN_FILE_NAME = "auth-tokens.json";

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function tokenFilePath() {
  return path.join(app.getPath("userData"), TOKEN_FILE_NAME);
}

function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is not available on this system.");
  }

  if (
    process.platform === "linux" &&
    safeStorage.getSelectedStorageBackend?.() === "basic_text"
  ) {
    throw new Error("Secure credential storage is not available for this Linux session.");
  }
}

function encryptValue(value: string): Effect.Effect<string, Error> {
  return Effect.try({
    try: () => {
      assertEncryptionAvailable();
      return safeStorage.encryptString(value).toString("base64");
    },
    catch: toError,
  });
}

function decryptValue(value: string): Effect.Effect<string, Error> {
  return Effect.try({
    try: () => {
      assertEncryptionAvailable();
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    },
    catch: toError,
  });
}

function readTokenRecords(): Effect.Effect<StoredAuthTokenRecord[], Error> {
  return Effect.tryPromise({
    try: async () => {
      try {
        const raw = await readFile(tokenFilePath(), "utf8");
        try {
          const parsed = JSON.parse(raw) as unknown;
          return Array.isArray(parsed) ? (parsed as StoredAuthTokenRecord[]) : [];
        } catch {
          return [];
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw error;
      }
    },
    catch: toError,
  });
}

function writeTokenRecords(
  records: StoredAuthTokenRecord[],
): Effect.Effect<void, Error> {
  return Effect.tryPromise({
    try: async () => {
      const filePath = tokenFilePath();
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    },
    catch: toError,
  });
}

const makeAuthTokenStore = Effect.gen(function* () {
  const get: AuthTokenStoreShape["get"] = Effect.fn(
    "AuthTokenStore.get",
  )(function* (accountId) {
        const records = yield* readTokenRecords();
        const record = records.find((item) => item.id === accountId);
        if (!record) return null;

        const accessToken = yield* decryptValue(record.accessToken);
        const refreshToken = record.refreshToken
          ? yield* decryptValue(record.refreshToken)
          : null;

        return {
          ...record,
          host: normalizeHost(record.host),
          accessToken,
          refreshToken,
        };
  });

  const listAccounts: AuthTokenStoreShape["listAccounts"] = Effect.fn(
    "AuthTokenStore.listAccounts",
  )(() =>
    Effect.map(readTokenRecords(), (records) =>
      records.map((record) => {
        const host = normalizeHost(record.host);
        return {
          id: record.id,
          provider: record.provider,
          host,
          clientId: record.clientId,
          viewerLogin: record.viewerLogin,
          label: record.viewerLogin ? `${record.viewerLogin} @ ${host}` : host,
          createdAt: record.createdAt,
        };
      }),
    ),
  );

  const save: AuthTokenStoreShape["save"] = Effect.fn(
    "AuthTokenStore.save",
  )(function* (token) {
        const normalizedHost = normalizeHost(token.host);
        const accessToken = yield* encryptValue(token.accessToken);
        const refreshToken = token.refreshToken
          ? yield* encryptValue(token.refreshToken)
          : null;
        const nextRecord: StoredAuthTokenRecord = {
          provider: token.provider,
          host: normalizedHost,
          id: token.id,
          clientId: token.clientId,
          accessToken,
          refreshToken,
          expiresAt: token.expiresAt,
          scopes: token.scopes,
          viewerLogin: token.viewerLogin,
          createdAt: token.createdAt,
        };
        const records = yield* readTokenRecords();
        const nextRecords = records.filter((item) => item.id !== token.id);
        nextRecords.push(nextRecord);
        yield* writeTokenRecords(nextRecords);
  });

  const deleteToken: AuthTokenStoreShape["delete"] = Effect.fn(
    "AuthTokenStore.delete",
  )(function* (accountId) {
        const records = yield* readTokenRecords();
        yield* writeTokenRecords(records.filter((item) => item.id !== accountId));
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
