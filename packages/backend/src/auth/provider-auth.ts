import {
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import { normalizeHost } from "../repo-id.ts";
import { Effect } from "effect";
import { AuthTokenStore } from "./token-store.ts";
import type { ForgeProviderKind } from "@rudu/shared";
import type { StoredAuthToken } from "./token-store.ts";

type OAuthProviderConfig = {
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  deviceCodeUrl: string | null;
};

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  interval?: number;
};

type OAuthDeviceCodeResponse = {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
};

type DeviceOAuthPollResult =
  | { status: "pending"; intervalMs: number }
  | { status: "complete"; token: StoredAuthToken };

const DEFAULT_REDIRECT_URI = "code-review.app://oauth/callback";
const REFRESH_SKEW_MS = 60_000;

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function envValue(key: string) {
  switch (key) {
    case "GITHUB_CLIENT_ID":
      return process.env.GITHUB_CLIENT_ID?.trim() ?? "";
    case "GITHUB_CLIENT_SECRET":
      return process.env.GITHUB_CLIENT_SECRET?.trim() ?? "";
    case "GITLAB_CLIENT_ID":
      return process.env.GITLAB_CLIENT_ID?.trim() ?? "";
    case "GITLAB_CLIENT_SECRET":
      return process.env.GITLAB_CLIENT_SECRET?.trim() ?? "";
    case "RUDU_OAUTH_REDIRECT_URI":
      return process.env.RUDU_OAUTH_REDIRECT_URI?.trim() ?? "";
    default:
      return "";
  }
}

function redirectUri() {
  return envValue("RUDU_OAUTH_REDIRECT_URI") || DEFAULT_REDIRECT_URI;
}

function defaultClientId(provider: ForgeProviderKind, host: string) {
  if (provider === "github" && host === "github.com") {
    return envValue("GITHUB_CLIENT_ID");
  }

  if (provider === "gitlab" && host === "gitlab.com") {
    return envValue("GITLAB_CLIENT_ID");
  }

  return "";
}

function defaultClientSecret(provider: ForgeProviderKind, host: string) {
  if (provider === "github" && host === "github.com") {
    return envValue("GITHUB_CLIENT_SECRET");
  }

  if (provider === "gitlab" && host === "gitlab.com") {
    return envValue("GITLAB_CLIENT_SECRET");
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
  clientSecret = "",
): OAuthProviderConfig {
  const normalizedHost = normalizeHost(host);
  const resolvedClientId = resolveClientId(provider, normalizedHost, clientId);
  const resolvedClientSecret =
    clientSecret.trim() || defaultClientSecret(provider, normalizedHost);
  if (provider === "github") {
    return {
      clientId: resolvedClientId,
      clientSecret: resolvedClientSecret || null,
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
      deviceCodeUrl:
        normalizedHost === "github.com"
          ? "https://github.com/login/device/code"
          : `https://${normalizedHost}/login/device/code`,
    };
  }

  return {
    clientId: resolvedClientId,
    clientSecret: resolvedClientSecret || null,
    redirectUri: redirectUri(),
    scopes: ["api"],
    authorizeUrl: `https://${normalizedHost}/oauth/authorize`,
    tokenUrl: `https://${normalizedHost}/oauth/token`,
    deviceCodeUrl: null,
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

function tokenFromPayload(
  accountId: string,
  provider: ForgeProviderKind,
  host: string,
  clientId: string,
  scopes: string[],
  payload: OAuthTokenResponse,
): StoredAuthToken {
  return {
    id: accountId,
    provider,
    host: normalizeHost(host),
    clientId,
    accessToken: payload.access_token ?? "",
    refreshToken: payload.refresh_token ?? null,
    expiresAt: expiresAt(payload.expires_in),
    scopes: parseScopes(payload.scope, scopes),
    viewerLogin: null,
    createdAt: Date.now(),
  };
}

function oauthFormJson<A>(
  url: string,
  body: URLSearchParams,
): Effect.Effect<A, Error, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json"),
      HttpClientRequest.setHeader("User-Agent", "rudu"),
      HttpClientRequest.bodyText(
        body.toString(),
        "application/x-www-form-urlencoded",
      ),
    );
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(request).pipe(
      Effect.mapError(toError),
    );
    return yield* response.json.pipe(
      Effect.map((payload) => payload as A),
      Effect.mapError(toError),
    );
  });
}

function requestDeviceOAuthCode(
  provider: ForgeProviderKind,
  host: string,
  clientId: string,
): Effect.Effect<{
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  intervalMs: number;
}, Error, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const config = yield* Effect.try({
      try: () => oauthConfig(provider, host, clientId),
      catch: toError,
    });
    if (!config.deviceCodeUrl) {
      return yield* Effect.fail(
        new Error("Device authorization is only supported for GitHub."),
      );
    }

    const body = new URLSearchParams({
      client_id: config.clientId,
      scope: config.scopes.join(" "),
    });
    const payload = yield* oauthFormJson<OAuthDeviceCodeResponse>(
      config.deviceCodeUrl,
      body,
    );
    if (
      payload.error ||
      !payload.device_code ||
      !payload.user_code ||
      !payload.verification_uri
    ) {
      return yield* Effect.fail(
        new Error(
          payload.error_description ??
            payload.error ??
            "OAuth device authorization failed.",
        ),
      );
    }

    return {
      clientId: config.clientId,
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri_complete ?? payload.verification_uri,
      expiresIn: payload.expires_in ?? 900,
      intervalMs: Math.max(1, payload.interval ?? 5) * 1000,
    };
  });
}

function exchangeOAuthCode(
  accountId: string,
  provider: ForgeProviderKind,
  host: string,
  clientId: string,
  clientSecret: string,
  code: string,
  codeVerifier: string,
): Effect.Effect<StoredAuthToken, Error, AuthTokenStore | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const tokenStore = yield* AuthTokenStore;
    const config = yield* Effect.try({
      try: () => oauthConfig(provider, host, clientId, clientSecret),
      catch: toError,
    });
    const body = new URLSearchParams({
      client_id: config.clientId,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    });
    if (config.clientSecret) {
      body.set("client_secret", config.clientSecret);
    }

    const payload = yield* oauthFormJson<OAuthTokenResponse>(config.tokenUrl, body);
    if (payload.error || !payload.access_token) {
      return yield* Effect.fail(
        new Error(payload.error_description ?? payload.error ?? "OAuth token exchange failed."),
      );
    }

    const token = tokenFromPayload(
      accountId,
      provider,
      host,
      config.clientId,
      config.scopes,
      payload,
    );
    yield* tokenStore.save(token);
    return token;
  });
}

function exchangeDeviceOAuthCode(
  accountId: string,
  provider: ForgeProviderKind,
  host: string,
  clientId: string,
  deviceCode: string,
): Effect.Effect<
  DeviceOAuthPollResult,
  Error,
  AuthTokenStore | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const tokenStore = yield* AuthTokenStore;
    const config = yield* Effect.try({
      try: () => oauthConfig(provider, host, clientId),
      catch: toError,
    });
    const body = new URLSearchParams({
      client_id: config.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    const payload = yield* oauthFormJson<OAuthTokenResponse>(config.tokenUrl, body);

    if (payload.error === "authorization_pending") {
      return {
        status: "pending",
        intervalMs: Math.max(1, payload.interval ?? 5) * 1000,
      } satisfies DeviceOAuthPollResult;
    }
    if (payload.error === "slow_down") {
      return {
        status: "pending",
        intervalMs: Math.max(1, payload.interval ?? 10) * 1000,
      } satisfies DeviceOAuthPollResult;
    }
    if (payload.error || !payload.access_token) {
      return yield* Effect.fail(
        new Error(
          payload.error_description ??
            payload.error ??
            "OAuth device token exchange failed.",
        ),
      );
    }

    const token = tokenFromPayload(
      accountId,
      provider,
      host,
      config.clientId,
      config.scopes,
      payload,
    );
    yield* tokenStore.save(token);
    return { status: "complete", token } satisfies DeviceOAuthPollResult;
  });
}

function refreshStoredAuthToken(
  token: StoredAuthToken,
): Effect.Effect<StoredAuthToken, Error, AuthTokenStore | HttpClient.HttpClient> {
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

    const payload = yield* oauthFormJson<OAuthTokenResponse>(config.tokenUrl, body);
    if (payload.error || !payload.access_token) {
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
): Effect.Effect<string, Error, AuthTokenStore | HttpClient.HttpClient> {
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
  exchangeDeviceOAuthCode,
  exchangeOAuthCode,
  getValidAccessToken,
  oauthConfig,
  requestDeviceOAuthCode,
  updateViewerLogin,
};
