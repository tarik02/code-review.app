import type { ForgeProviderKind } from '../types/forge';

function normalizeHostInput(host: string) {
  const trimmed = host.trim();
  if (!trimmed) {
    return '';
  }

  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  return url.origin.toLowerCase();
}

function hostNameFromInput(host: string) {
  const normalizedHost = normalizeHostInput(host);
  return normalizedHost ? new URL(normalizedHost).hostname.toLowerCase() : '';
}

function isDefaultProviderHost(provider: ForgeProviderKind, host: string) {
  const hostname = hostNameFromInput(host);
  return (
    (provider === 'github' && hostname === 'github.com') ||
    (provider === 'gitlab' && hostname === 'gitlab.com')
  );
}

function hasDefaultClientId(provider: ForgeProviderKind, host: string) {
  return isDefaultProviderHost(provider, host);
}

type ParsedForgeResourceUrl = {
  provider: ForgeProviderKind;
  host: string;
  repoPath: string;
  number: number | null;
};

function parseForgeResourceUrl(
  value: string,
  providerHint?: ForgeProviderKind,
): ParsedForgeResourceUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = normalizeHostInput(parsed.origin);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const gitlabDashIndex = segments.indexOf('-');
  if (gitlabDashIndex > 0 && segments[gitlabDashIndex + 1] === 'merge_requests') {
    const number = Number.parseInt(segments[gitlabDashIndex + 2] ?? '', 10);
    const repoPath = segments.slice(0, gitlabDashIndex).join('/');
    if (Number.isInteger(number) && number > 0 && repoPath) {
      return {
        provider: 'gitlab',
        host,
        repoPath,
        number,
      };
    }
  }

  const githubPullIndex = segments.indexOf('pull');
  if (githubPullIndex === 2) {
    const number = Number.parseInt(segments[3] ?? '', 10);
    if (Number.isInteger(number) && number > 0) {
      return {
        provider: 'github',
        host,
        repoPath: `${segments[0]}/${segments[1]}`,
        number,
      };
    }
  }

  if (
    (providerHint === 'gitlab' || hostNameFromInput(host).includes('gitlab')) &&
    segments.length >= 1
  ) {
    return {
      provider: 'gitlab',
      host,
      repoPath: segments.join('/'),
      number: null,
    };
  }

  if (segments.length >= 2) {
    return {
      provider: providerHint ?? 'github',
      host,
      repoPath: `${segments[0]}/${segments[1]}`,
      number: null,
    };
  }

  return null;
}

function parseAppOpenUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'code-review.app:' || parsed.hostname !== 'open') {
      return null;
    }
    return parsed.searchParams.get('url');
  } catch {
    return null;
  }
}

export {
  hasDefaultClientId,
  hostNameFromInput,
  isDefaultProviderHost,
  normalizeHostInput,
  parseAppOpenUrl,
  parseForgeResourceUrl,
};
export type { ParsedForgeResourceUrl };
