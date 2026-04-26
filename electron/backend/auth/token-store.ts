import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
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

const TOKEN_FILE_NAME = "auth-tokens.json";

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

function encryptValue(value: string) {
  assertEncryptionAvailable();
  return safeStorage.encryptString(value).toString("base64");
}

function decryptValue(value: string) {
  assertEncryptionAvailable();
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

async function readTokenRecords(): Promise<StoredAuthTokenRecord[]> {
  try {
    const raw = await readFile(tokenFilePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredAuthTokenRecord[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeTokenRecords(records: StoredAuthTokenRecord[]) {
  const filePath = tokenFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

async function getStoredAuthToken(
  accountId: string,
): Promise<StoredAuthToken | null> {
  const record = (await readTokenRecords()).find(
    (item) => item.id === accountId,
  );
  if (!record) return null;

  return {
    ...record,
    host: normalizeHost(record.host),
    accessToken: decryptValue(record.accessToken),
    refreshToken: record.refreshToken ? decryptValue(record.refreshToken) : null,
  };
}

async function listProviderAccounts(): Promise<ProviderAccount[]> {
  return (await readTokenRecords()).map((record) => ({
    id: record.id,
    provider: record.provider,
    host: normalizeHost(record.host),
    clientId: record.clientId,
    viewerLogin: record.viewerLogin,
    label: record.viewerLogin
      ? `${record.viewerLogin} @ ${normalizeHost(record.host)}`
      : normalizeHost(record.host),
    createdAt: record.createdAt,
  }));
}

async function saveStoredAuthToken(token: StoredAuthToken) {
  const normalizedHost = normalizeHost(token.host);
  const nextRecord: StoredAuthTokenRecord = {
    provider: token.provider,
    host: normalizedHost,
    id: token.id,
    clientId: token.clientId,
    accessToken: encryptValue(token.accessToken),
    refreshToken: token.refreshToken ? encryptValue(token.refreshToken) : null,
    expiresAt: token.expiresAt,
    scopes: token.scopes,
    viewerLogin: token.viewerLogin,
    createdAt: token.createdAt,
  };
  const records = await readTokenRecords();
  const nextRecords = records.filter((item) => item.id !== token.id);
  nextRecords.push(nextRecord);
  await writeTokenRecords(nextRecords);
}

async function deleteStoredAuthToken(accountId: string) {
  const records = await readTokenRecords();
  await writeTokenRecords(records.filter((item) => item.id !== accountId));
}

export {
  deleteStoredAuthToken,
  getStoredAuthToken,
  listProviderAccounts,
  saveStoredAuthToken,
};
export type { StoredAuthToken };
