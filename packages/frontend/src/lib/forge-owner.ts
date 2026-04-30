import type { ForgeProviderKind } from '../types/forge';
import { normalizeHostInput } from './forge-links';

function getOwnerLogin(nameWithOwner: string) {
  const [owner] = nameWithOwner.split('/');
  return owner || nameWithOwner;
}

function getOwnerInitials(nameWithOwner: string) {
  return getOwnerLogin(nameWithOwner).slice(0, 1).toUpperCase();
}

function getOwnerAvatarUrl(
  nameWithOwner: string,
  provider: ForgeProviderKind = 'github',
  host = provider === 'github' ? 'github.com' : 'gitlab.com',
  size = 40,
): string | null {
  const ownerLogin = getOwnerLogin(nameWithOwner);
  if (provider !== 'github') {
    return null;
  }

  const normalizedHost = normalizeHostInput(host);
  return normalizedHost ? `${normalizedHost}/${ownerLogin}.png?size=${size}` : null;
}

export { getOwnerAvatarUrl, getOwnerInitials, getOwnerLogin };
