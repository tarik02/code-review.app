import { normalizeHost } from "../repo-id";
import { deleteStoredAuthToken, getStoredAuthToken, saveStoredAuthToken } from "./token-store";
import type { ForgeProviderKind } from "../../shared/types";
import type { StoredAuthToken } from "./token-store";

type OAuthProviderConfig = {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
};

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

const DEFAULT_REDIRECT_URI = "code-review.app://oauth/callback";
const REFRESH_SKEW_MS = 60_000;

function redirectUri() {
  return process.env.RUDU_OAUTH_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
}

function defaultClientId(provider: ForgeProviderKind, host: string) {
  if (provider === "github" && host === "github.com") {
    return process.env.GITHUB_CLIENT_ID?.trim() ?? "";
  }

  if (provider === "gitlab" && host === "gitlab.com") {
    return process.env.GITLAB_CLIENT_ID?.trim() ?? "";
  }

  return "";
}

function resolveClientId(
  provider: ForgeProviderKind,
  host: string,
  clientId: string,
) {
  const normalizedHost = normalizeHost(host);
  const resolvedClientId =
    clientId.trim() || defaultClientId(provider, normalizedHost);
  if (resolvedClientId) {
    return resolvedClientId;
  }

  if (provider === "github" && normalizedHost === "github.com") {
    throw new Error("Client ID is required. Set GITHUB_CLIENT_ID or enter one.");
  }

  if (provider === "gitlab" && normalizedHost === "gitlab.com") {
    throw new Error("Client ID is required. Set GITLAB_CLIENT_ID or enter one.");
  }

  throw new Error("Client ID is required for custom provider instances.");
}

function oauthConfig(
  provider: ForgeProviderKind,
  host: string,
  clientId: string,
): OAuthProviderConfig {
  const normalizedHost = normalizeHost(host);
  const resolvedClientId = resolveClientId(provider, normalizedHost, clientId);
  if (provider === "github") {
    return {
      clientId: resolvedClientId,
      redirectUri: redirectUri(),
      scopes: ["repo", "read:org"],
      authorizeUrl:
        normalizedHost === "github.com"
          ? "https://github.com/login/oauth/authorize"
          : `https://${normalizedHost}/login/oauth/authorize`,
      tokenUrl:
        normalizedHost === "github.com"
          ? "https://github.com/login/oauth/access_token"
          : `https://${normalizedHost}/login/oauth/access_token`,
    };
  }

  return {
    clientId: resolvedClientId,
    redirectUri: redirectUri(),
    scopes: ["api"],
    authorizeUrl: `https://${normalizedHost}/oauth/authorize`,
    tokenUrl: `https://${normalizedHost}/oauth/token`,
  };
}

function parseScopes(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;
  return value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function expiresAt(expiresIn: number | undefined) {
  return typeof expiresIn === "number" && Number.isFinite(expiresIn)
    ? Date.now() + expiresIn * 1000
    : null;
}

async function exchangeOAuthCode(
  accountId: string,
  provider: ForgeProviderKind,
  host: string,
  clientId: string,
  code: string,
  codeVerifier: string,
) {
  const config = oauthConfig(provider, host, clientId);
  const body = new URLSearchParams({
    client_id: config.clientId,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "rudu",
    },
    body,
  });
  const payload = (await response.json()) as OAuthTokenResponse;
  if (!response.ok || payload.error || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "OAuth token exchange failed.");
  }

  const token: StoredAuthToken = {
    id: accountId,
    provider,
    host: normalizeHost(host),
    clientId: config.clientId,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: expiresAt(payload.expires_in),
    scopes: parseScopes(payload.scope, config.scopes),
    viewerLogin: null,
    createdAt: Date.now(),
  };
  await saveStoredAuthToken(token);
  return token;
}

async function refreshStoredAuthToken(token: StoredAuthToken) {
  if (!token.refreshToken) return token;
  const config = oauthConfig(token.provider, token.host, token.clientId);
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: "refresh_token",
    redirect_uri: config.redirectUri,
    refresh_token: token.refreshToken,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "rudu",
    },
    body,
  });
  const payload = (await response.json()) as OAuthTokenResponse;
  if (!response.ok || payload.error || !payload.access_token) {
    await deleteStoredAuthToken(token.id);
    throw new Error(payload.error_description ?? payload.error ?? "OAuth token refresh failed.");
  }

  const refreshed: StoredAuthToken = {
    ...token,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? token.refreshToken,
    expiresAt: expiresAt(payload.expires_in),
    scopes: parseScopes(payload.scope, token.scopes),
  };
  await saveStoredAuthToken(refreshed);
  return refreshed;
}

async function getValidAccessToken(accountId: string) {
  const token = await getStoredAuthToken(accountId);
  if (!token) {
    throw new Error("Provider account is not signed in.");
  }

  if (token.expiresAt !== null && token.expiresAt <= Date.now() + REFRESH_SKEW_MS) {
    return (await refreshStoredAuthToken(token)).accessToken;
  }

  return token.accessToken;
}

async function updateViewerLogin(accountId: string, viewerLogin: string) {
  const token = await getStoredAuthToken(accountId);
  if (!token) return;
  await saveStoredAuthToken({ ...token, viewerLogin });
}

export {
  deleteStoredAuthToken,
  exchangeOAuthCode,
  getStoredAuthToken,
  getValidAccessToken,
  oauthConfig,
  updateViewerLogin,
};
