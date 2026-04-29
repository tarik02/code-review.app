import type {
  ForgeProviderKind,
  RepoIdentity,
} from "../types/forge";

function repoIdentity(repo: RepoIdentity): RepoIdentity {
  return {
    providerId: repo.providerId,
    repoKey: repo.repoKey,
  };
}

function repoIdentityKey(repo: RepoIdentity) {
  return `${repo.providerId}:${repo.repoKey}`;
}

function sameRepoIdentity(
  left: RepoIdentity,
  right: RepoIdentity,
) {
  return (
    left.providerId === right.providerId &&
    left.repoKey === right.repoKey
  );
}

function providerFromProviderId(providerId: string): ForgeProviderKind {
  return providerId.startsWith("gitlab:") ? "gitlab" : "github";
}

function decodeProviderIdComponent(value: string) {
  return value.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function providerAccountIdFromProviderId(providerId: string) {
  const firstSeparator = providerId.indexOf(":");
  const secondSeparator =
    firstSeparator === -1 ? -1 : providerId.indexOf(":", firstSeparator + 1);
  if (secondSeparator === -1) {
    return "";
  }
  return decodeProviderIdComponent(providerId.slice(secondSeparator + 1));
}

export {
  providerAccountIdFromProviderId,
  providerFromProviderId,
  repoIdentity,
  repoIdentityKey,
  sameRepoIdentity,
};
