import { ValidationError } from "./errors";
import type { ForgeProviderKind } from "../shared/types";

type RepoId = {
  provider: ForgeProviderKind;
  host: string;
  accountId: string;
  path: string;
  key: string;
};

function providerKey(provider: ForgeProviderKind) {
  return provider;
}

function parseProviderKind(provider: string): ForgeProviderKind {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "github" || normalized === "gitlab") {
    return normalized;
  }
  throw new ValidationError(`Unsupported provider: ${provider}`);
}

function normalizeHost(host: string) {
  return host
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function normalizePath(path: string) {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

function encodeKeyComponent(value: string) {
  return value.replace(/%/g, "%25").replace(/:/g, "%3A");
}

function decodeKeyComponent(value: string) {
  try {
    return value.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  } catch {
    throw new ValidationError("Invalid percent escape in repo id");
  }
}

function createRepoId(
  provider: ForgeProviderKind,
  host: string,
  accountId: string,
  path: string,
): RepoId {
  const normalizedHost = normalizeHost(host);
  const normalizedAccountId = accountId.trim();
  const normalizedPath = normalizePath(path);
  if (!normalizedAccountId) {
    throw new ValidationError("Repo id account is required");
  }
  const key = `${providerKey(provider)}:${encodeKeyComponent(normalizedHost)}:${encodeKeyComponent(normalizedAccountId)}:${normalizedPath}`;
  return {
    provider,
    host: normalizedHost,
    accountId: normalizedAccountId,
    path: normalizedPath,
    key,
  };
}

function parseRepoId(key: string): RepoId {
  const trimmed = key.trim();
  const firstSeparator = trimmed.indexOf(":");
  const secondSeparator = firstSeparator === -1 ? -1 : trimmed.indexOf(":", firstSeparator + 1);
  const thirdSeparator = secondSeparator === -1 ? -1 : trimmed.indexOf(":", secondSeparator + 1);
  if (firstSeparator === -1 || secondSeparator === -1 || thirdSeparator === -1) {
    throw new ValidationError("Repo id is missing provider, host, or account");
  }

  const providerRaw = trimmed.slice(0, firstSeparator);
  const encodedHost = trimmed.slice(firstSeparator + 1, secondSeparator);
  const encodedAccountId = trimmed.slice(secondSeparator + 1, thirdSeparator);
  const path = trimmed.slice(thirdSeparator + 1);
  const provider = parseProviderKind(providerRaw);
  const host = decodeKeyComponent(encodedHost);
  const accountId = decodeKeyComponent(encodedAccountId);

  if (path.trim().length === 0) {
    throw new ValidationError("Repo id path is required");
  }

  return createRepoId(provider, host, accountId, path);
}

function parseOwnerRepo(repo: string): [string, string] {
  const trimmed = repo.trim();
  const [owner, name] = trimmed.split("/");
  if (!owner || !name || trimmed.split("/").length !== 2) {
    throw new ValidationError("Repo must be in owner/name format");
  }
  return [owner, name];
}

export {
  createRepoId,
  decodeKeyComponent,
  encodeKeyComponent,
  normalizeHost,
  normalizePath,
  parseOwnerRepo,
  parseProviderKind,
  parseRepoId,
  providerKey,
};
export type { RepoId };
