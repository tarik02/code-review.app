import { ValidationError } from './errors.ts';
import type { ForgeProviderKind } from '@code-review-app/shared';

type RepoIdentity = {
  provider: ForgeProviderKind;
  host: string;
  accountId: string;
  path: string;
  providerId: string;
  repoKey: string;
};

type ProviderRepoIdentity = {
  provider: ForgeProviderKind;
  host: string;
  path: string;
  providerId: string;
  repoKey: string;
};

function providerKey(provider: ForgeProviderKind) {
  return provider;
}

function parseProviderKind(provider: string): ForgeProviderKind {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'github' || normalized === 'gitlab') {
    return normalized;
  }
  throw new ValidationError(`Unsupported provider: ${provider}`);
}

function normalizeHost(host: string) {
  const trimmed = host.trim();
  if (!trimmed) {
    return '';
  }

  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  return url.origin.toLowerCase();
}

function hostNameFromHost(host: string) {
  const normalizedHost = normalizeHost(host);
  return normalizedHost ? new URL(normalizedHost).hostname.toLowerCase() : '';
}

function normalizePath(path: string) {
  return path.trim().replace(/^\/+|\/+$/g, '');
}

function encodeKeyComponent(value: string) {
  return value.replace(/%/g, '%25').replace(/:/g, '%3A');
}

function decodeKeyComponent(value: string) {
  try {
    return value.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  } catch {
    throw new ValidationError('Invalid percent escape in repo id');
  }
}

function createProviderId(provider: ForgeProviderKind, host: string, accountId: string) {
  const normalizedHost = normalizeHost(host);
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) {
    throw new ValidationError('Provider account is required');
  }
  return `${providerKey(provider)}:${encodeKeyComponent(normalizedHost)}:${encodeKeyComponent(normalizedAccountId)}`;
}

function parseProviderId(providerId: string) {
  const trimmed = providerId.trim();
  const firstSeparator = trimmed.indexOf(':');
  const secondSeparator = firstSeparator === -1 ? -1 : trimmed.indexOf(':', firstSeparator + 1);
  if (firstSeparator === -1 || secondSeparator === -1) {
    throw new ValidationError('Provider id is missing provider, host, or account');
  }

  const provider = parseProviderKind(trimmed.slice(0, firstSeparator));
  const host = decodeKeyComponent(trimmed.slice(firstSeparator + 1, secondSeparator));
  const accountId = decodeKeyComponent(trimmed.slice(secondSeparator + 1));
  if (!accountId) {
    throw new ValidationError('Provider id account is required');
  }

  return {
    provider,
    host,
    accountId,
    providerId: createProviderId(provider, host, accountId),
  };
}

function createRepoIdentity(
  provider: ForgeProviderKind,
  host: string,
  accountId: string,
  path: string,
): RepoIdentity {
  const normalizedHost = normalizeHost(host);
  const normalizedAccountId = accountId.trim();
  const normalizedPath = normalizePath(path);
  if (!normalizedAccountId) {
    throw new ValidationError('Repo account is required');
  }
  if (!normalizedPath) {
    throw new ValidationError('Repo key is required');
  }
  const providerId = createProviderId(provider, normalizedHost, normalizedAccountId);
  return {
    provider,
    host: normalizedHost,
    accountId: normalizedAccountId,
    path: normalizedPath,
    providerId,
    repoKey: normalizedPath,
  };
}

function createProviderRepoIdentity(
  provider: ForgeProviderKind,
  host: string,
  accountId: string,
  path: string,
): ProviderRepoIdentity {
  const identity = createRepoIdentity(provider, host, accountId, path);
  return {
    provider: identity.provider,
    host: identity.host,
    path: identity.path,
    providerId: identity.providerId,
    repoKey: identity.repoKey,
  };
}

function createRepoIdentityFromParts(providerId: string, repoKey: string): RepoIdentity {
  const provider = parseProviderId(providerId);
  return createRepoIdentity(provider.provider, provider.host, provider.accountId, repoKey);
}

function createProviderRepoIdentityFromParts(
  providerId: string,
  repoKey: string,
): ProviderRepoIdentity {
  const provider = parseProviderId(providerId);
  return createProviderRepoIdentity(provider.provider, provider.host, provider.accountId, repoKey);
}

function repoIdentityCacheKey(repo: { providerId: string; repoKey: string }) {
  return `${repo.providerId}:${normalizePath(repo.repoKey)}`;
}

function parseOwnerRepo(repo: string): [string, string] {
  const trimmed = repo.trim();
  const [owner, name] = trimmed.split('/');
  if (!owner || !name || trimmed.split('/').length !== 2) {
    throw new ValidationError('Repo must be in owner/name format');
  }
  return [owner, name];
}

export {
  createRepoIdentity,
  createRepoIdentityFromParts,
  createProviderId,
  createProviderRepoIdentity,
  createProviderRepoIdentityFromParts,
  decodeKeyComponent,
  encodeKeyComponent,
  hostNameFromHost,
  normalizeHost,
  normalizePath,
  parseOwnerRepo,
  parseProviderId,
  parseProviderKind,
  providerKey,
  repoIdentityCacheKey,
};
export type { ProviderRepoIdentity, RepoIdentity };
