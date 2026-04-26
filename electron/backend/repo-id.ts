import { ValidationError } from "./errors";
import type { ForgeProviderKind } from "../shared/types";

type RepoId = {
  provider: ForgeProviderKind;
  host: string;
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
  path: string,
): RepoId {
  const normalizedHost = normalizeHost(host);
  const normalizedPath = normalizePath(path);
  const key = `${providerKey(provider)}:${encodeKeyComponent(normalizedHost)}:${normalizedPath}`;
  return {
    provider,
    host: normalizedHost,
    path: normalizedPath,
    key,
  };
}

function parseRepoId(key: string): RepoId {
  const trimmed = key.trim();
  const firstSeparator = trimmed.indexOf(":");
  const secondSeparator = firstSeparator === -1 ? -1 : trimmed.indexOf(":", firstSeparator + 1);
  if (firstSeparator === -1 || secondSeparator === -1) {
    throw new ValidationError("Repo id is missing provider or host");
  }

  const providerRaw = trimmed.slice(0, firstSeparator);
  const encodedHost = trimmed.slice(firstSeparator + 1, secondSeparator);
  const path = trimmed.slice(secondSeparator + 1);
  const provider = parseProviderKind(providerRaw);
  const host = decodeKeyComponent(encodedHost);

  if (path.trim().length === 0) {
    throw new ValidationError("Repo id path is required");
  }

  return createRepoId(provider, host, path);
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
