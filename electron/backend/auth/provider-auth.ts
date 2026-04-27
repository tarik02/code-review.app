import { normalizeHost } from "../repo-id";
import { Effect } from "effect";
import { AuthTokenStore } from "./token-store";
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

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

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

function exchangeOAuthCode(
  accountId: string,
  provider: ForgeProviderKind,
  host: string,
  clientId: string,
  code: string,
  codeVerifier: string,
): Effect.Effect<StoredAuthToken, Error, AuthTokenStore> {
  return Effect.gen(function* () {
    const tokenStore = yield* AuthTokenStore;
    const config = yield* Effect.try({
      try: () => oauthConfig(provider, host, clientId),
      catch: toError,
    });
    const body = new URLSearchParams({
      client_id: config.clientId,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    });

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(config.tokenUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "rudu",
          },
          body,
        }),
      catch: toError,
    });
    const payload = yield* Effect.tryPromise({
      try: () => response.json() as Promise<OAuthTokenResponse>,
      catch: toError,
    });
    if (!response.ok || payload.error || !payload.access_token) {
      return yield* Effect.fail(
        new Error(payload.error_description ?? payload.error ?? "OAuth token exchange failed."),
      );
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
    yield* tokenStore.save(token);
    return token;
  });
}

function refreshStoredAuthToken(
  token: StoredAuthToken,
): Effect.Effect<StoredAuthToken, Error, AuthTokenStore> {
  return Effect.gen(function* () {
    if (!token.refreshToken) return token;
    const tokenStore = yield* AuthTokenStore;
    const config = yield* Effect.try({
      try: () => oauthConfig(token.provider, token.host, token.clientId),
      catch: toError,
    });
    const body = new URLSearchParams({
      client_id: config.clientId,
      grant_type: "refresh_token",
      redirect_uri: config.redirectUri,
      refresh_token: token.refreshToken,
    });

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(config.tokenUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "rudu",
          },
          body,
        }),
      catch: toError,
    });
    const payload = yield* Effect.tryPromise({
      try: () => response.json() as Promise<OAuthTokenResponse>,
      catch: toError,
    });
    if (!response.ok || payload.error || !payload.access_token) {
      yield* tokenStore.delete(token.id);
      return yield* Effect.fail(
        new Error(payload.error_description ?? payload.error ?? "OAuth token refresh failed."),
      );
    }

    const refreshed: StoredAuthToken = {
      ...token,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? token.refreshToken,
      expiresAt: expiresAt(payload.expires_in),
      scopes: parseScopes(payload.scope, token.scopes),
    };
    yield* tokenStore.save(refreshed);
    return refreshed;
  });
}

function getValidAccessToken(
  accountId: string,
): Effect.Effect<string, Error, AuthTokenStore> {
  return Effect.gen(function* () {
    const tokenStore = yield* AuthTokenStore;
    const token = yield* tokenStore.get(accountId);
    if (!token) {
      return yield* Effect.fail(new Error("Provider account is not signed in."));
    }

    if (token.expiresAt !== null && token.expiresAt <= Date.now() + REFRESH_SKEW_MS) {
      return (yield* refreshStoredAuthToken(token)).accessToken;
    }

    return token.accessToken;
  });
}

function updateViewerLogin(
  accountId: string,
  viewerLogin: string,
): Effect.Effect<void, Error, AuthTokenStore> {
  return Effect.gen(function* () {
    const tokenStore = yield* AuthTokenStore;
    const token = yield* tokenStore.get(accountId);
    if (!token) return;
    yield* tokenStore.save({ ...token, viewerLogin });
  });
}

export {
  exchangeOAuthCode,
  getValidAccessToken,
  oauthConfig,
  updateViewerLogin,
};
