import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform';
import { hostNameFromHost, normalizeHost } from '../repo-id.ts';
import { Cause, Effect } from 'effect';
import { CacheService } from '../cache.ts';
import { AuthTokenStore } from './token-store.ts';
import {
  DEFAULT_GITHUB_CLIENT_ID,
  DEFAULT_GITLAB_CLIENT_ID,
  DEFAULT_OAUTH_REDIRECT_URI,
} from './constants.ts';
import type { ForgeProviderKind } from '@code-review-app/shared';
import type { StoredAuthToken } from './token-store.ts';

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

type OAuthViewerPayload = {
  login?: unknown;
  username?: unknown;
};

type DeviceOAuthPollResult =
  | { status: 'pending'; intervalMs: number }
  | { status: 'complete'; token: StoredAuthToken };

const REFRESH_SKEW_MS = 60_000;

function redirectUri() {
  return DEFAULT_OAUTH_REDIRECT_URI;
}

function defaultClientId(provider: ForgeProviderKind, host: string) {
  const hostname = hostNameFromHost(host);
  if (provider === 'github' && hostname === 'github.com') {
    return DEFAULT_GITHUB_CLIENT_ID;
  }

  if (provider === 'gitlab' && hostname === 'gitlab.com') {
    return DEFAULT_GITLAB_CLIENT_ID;
  }

  return '';
}

function defaultClientSecret() {
  return '';
}

function resolveClientId(provider: ForgeProviderKind, host: string, clientId: string) {
  const normalizedHost = normalizeHost(host);
  const hostname = hostNameFromHost(normalizedHost);
  const resolvedClientId = clientId.trim() || defaultClientId(provider, normalizedHost);
  if (resolvedClientId) {
    return resolvedClientId;
  }

  if (provider === 'github' && hostname === 'github.com') {
    throw new Error('Client ID is required. Set GITHUB_CLIENT_ID or enter one.');
  }

  if (provider === 'gitlab' && hostname === 'gitlab.com') {
    throw new Error('Client ID is required. Set GITLAB_CLIENT_ID or enter one.');
  }

  throw new Error('Client ID is required for custom provider instances.');
}

function oauthConfig(
  provider: ForgeProviderKind,
  host: string,
  clientId: string,
  clientSecret = '',
): OAuthProviderConfig {
  const normalizedHost = normalizeHost(host);
  const hostname = hostNameFromHost(normalizedHost);
  const resolvedClientId = resolveClientId(provider, normalizedHost, clientId);
  const resolvedClientSecret = clientSecret.trim() || defaultClientSecret();
  if (provider === 'github') {
    return {
      clientId: resolvedClientId,
      clientSecret: resolvedClientSecret || null,
      redirectUri: redirectUri(),
      scopes: ['repo', 'read:org'],
      authorizeUrl:
        hostname === 'github.com'
          ? 'https://github.com/login/oauth/authorize'
          : `${normalizedHost}/login/oauth/authorize`,
      tokenUrl:
        hostname === 'github.com'
          ? 'https://github.com/login/oauth/access_token'
          : `${normalizedHost}/login/oauth/access_token`,
      deviceCodeUrl:
        hostname === 'github.com'
          ? 'https://github.com/login/device/code'
          : `${normalizedHost}/login/device/code`,
    };
  }

  return {
    clientId: resolvedClientId,
    clientSecret: resolvedClientSecret || null,
    redirectUri: redirectUri(),
    scopes: ['api', 'read_repository'],
    authorizeUrl: `${normalizedHost}/oauth/authorize`,
    tokenUrl: `${normalizedHost}/oauth/token`,
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
  return typeof expiresIn === 'number' && Number.isFinite(expiresIn)
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
  viewerLogin: string | null = null,
): StoredAuthToken {
  return {
    id: accountId,
    provider,
    host: normalizeHost(host),
    clientId,
    accessToken: payload.access_token ?? '',
    refreshToken: payload.refresh_token ?? null,
    expiresAt: expiresAt(payload.expires_in),
    scopes: parseScopes(payload.scope, scopes),
    viewerLogin,
    createdAt: Date.now(),
  };
}

function oauthApiBase(provider: ForgeProviderKind, host: string) {
  const normalizedHost = normalizeHost(host);
  if (provider === 'github') {
    return hostNameFromHost(normalizedHost) === 'github.com'
      ? 'https://api.github.com'
      : `${normalizedHost}/api/v3`;
  }

  return `${normalizedHost}/api/v4`;
}

function fetchOAuthViewerLogin(
  provider: ForgeProviderKind,
  host: string,
  accessToken: string,
): Effect.Effect<string, Error, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const request = HttpClientRequest.get(`${oauthApiBase(provider, host)}/user`).pipe(
      HttpClientRequest.accept('application/json'),
      HttpClientRequest.setHeader('User-Agent', 'code-review.app'),
      HttpClientRequest.bearerToken(accessToken),
    );
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError((cause) => new Cause.UnknownException(cause)),
    );
    const payload = yield* response.json.pipe(
      Effect.map((value) => value as OAuthViewerPayload),
      Effect.mapError((cause) => new Cause.UnknownException(cause)),
    );
    const login = provider === 'github' ? payload.login : payload.username;
    if (typeof login !== 'string' || login.trim().length === 0) {
      return yield* Effect.fail(new Error('OAuth viewer login was not returned.'));
    }
    return login.trim();
  });
}

function resolveOAuthAccountId(
  requestedAccountId: string,
  provider: ForgeProviderKind,
  host: string,
  viewerLogin: string,
): Effect.Effect<string, Error, AuthTokenStore | CacheService> {
  return Effect.gen(function* () {
    const normalizedHost = normalizeHost(host);
    const tokenStore = yield* AuthTokenStore;
    const accounts = yield* tokenStore.listAccounts();
    const existingAccount = accounts.find(
      (account) =>
        account.provider === provider &&
        normalizeHost(account.host) === normalizedHost &&
        account.viewerLogin === viewerLogin,
    );
    if (existingAccount) {
      return existingAccount.id;
    }

    const cache = yield* CacheService;
    const cachedProfile = yield* cache.readProviderProfileByLogin(
      provider,
      normalizedHost,
      viewerLogin,
    );
    return cachedProfile?.accountId ?? requestedAccountId;
  });
}

function oauthFormJson<A>(
  url: string,
  body: URLSearchParams,
): Effect.Effect<A, Error, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept('application/json'),
      HttpClientRequest.setHeader('User-Agent', 'code-review.app'),
      HttpClientRequest.bodyText(body.toString(), 'application/x-www-form-urlencoded'),
    );
    const client = yield* HttpClient.HttpClient;
    const response = yield* client
      .execute(request)
      .pipe(Effect.mapError((cause) => new Cause.UnknownException(cause)));
    return yield* response.json.pipe(
      Effect.map((payload) => payload as A),
      Effect.mapError((cause) => new Cause.UnknownException(cause)),
    );
  });
}

function requestDeviceOAuthCode(
  provider: ForgeProviderKind,
  host: string,
  clientId: string,
): Effect.Effect<
  {
    clientId: string;
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    intervalMs: number;
  },
  Error,
  HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const config = yield* Effect.try({
      try: () => oauthConfig(provider, host, clientId),
      catch: (cause) => new Cause.UnknownException(cause),
    });
    if (!config.deviceCodeUrl) {
      return yield* Effect.fail(new Error('Device authorization is only supported for GitHub.'));
    }

    const body = new URLSearchParams({
      client_id: config.clientId,
      scope: config.scopes.join(' '),
    });
    const payload = yield* oauthFormJson<OAuthDeviceCodeResponse>(config.deviceCodeUrl, body);
    if (payload.error || !payload.device_code || !payload.user_code || !payload.verification_uri) {
      return yield* Effect.fail(
        new Error(
          payload.error_description ?? payload.error ?? 'OAuth device authorization failed.',
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
): Effect.Effect<StoredAuthToken, Error, AuthTokenStore | CacheService | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const tokenStore = yield* AuthTokenStore;
    const config = yield* Effect.try({
      try: () => oauthConfig(provider, host, clientId, clientSecret),
      catch: (cause) => new Cause.UnknownException(cause),
    });
    const body = new URLSearchParams({
      client_id: config.clientId,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    });
    if (config.clientSecret) {
      body.set('client_secret', config.clientSecret);
    }

    const payload = yield* oauthFormJson<OAuthTokenResponse>(config.tokenUrl, body);
    if (payload.error || !payload.access_token) {
      return yield* Effect.fail(
        new Error(payload.error_description ?? payload.error ?? 'OAuth token exchange failed.'),
      );
    }

    const viewerLogin = yield* fetchOAuthViewerLogin(provider, host, payload.access_token);
    const resolvedAccountId = yield* resolveOAuthAccountId(
      accountId,
      provider,
      host,
      viewerLogin,
    );
    const token = tokenFromPayload(
      resolvedAccountId,
      provider,
      host,
      config.clientId,
      config.scopes,
      payload,
      viewerLogin,
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
  AuthTokenStore | CacheService | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const tokenStore = yield* AuthTokenStore;
    const config = yield* Effect.try({
      try: () => oauthConfig(provider, host, clientId),
      catch: (cause) => new Cause.UnknownException(cause),
    });
    const body = new URLSearchParams({
      client_id: config.clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    const payload = yield* oauthFormJson<OAuthTokenResponse>(config.tokenUrl, body);

    if (payload.error === 'authorization_pending') {
      return {
        status: 'pending',
        intervalMs: Math.max(1, payload.interval ?? 5) * 1000,
      } satisfies DeviceOAuthPollResult;
    }
    if (payload.error === 'slow_down') {
      return {
        status: 'pending',
        intervalMs: Math.max(1, payload.interval ?? 10) * 1000,
      } satisfies DeviceOAuthPollResult;
    }
    if (payload.error || !payload.access_token) {
      return yield* Effect.fail(
        new Error(
          payload.error_description ?? payload.error ?? 'OAuth device token exchange failed.',
        ),
      );
    }

    const viewerLogin = yield* fetchOAuthViewerLogin(provider, host, payload.access_token);
    const resolvedAccountId = yield* resolveOAuthAccountId(
      accountId,
      provider,
      host,
      viewerLogin,
    );
    const token = tokenFromPayload(
      resolvedAccountId,
      provider,
      host,
      config.clientId,
      config.scopes,
      payload,
      viewerLogin,
    );
    yield* tokenStore.save(token);
    return { status: 'complete', token } satisfies DeviceOAuthPollResult;
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
      catch: (cause) => new Cause.UnknownException(cause),
    });
    const body = new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'refresh_token',
      redirect_uri: config.redirectUri,
      refresh_token: token.refreshToken,
    });

    const payload = yield* oauthFormJson<OAuthTokenResponse>(config.tokenUrl, body);
    if (payload.error || !payload.access_token) {
      return yield* Effect.fail(
        new Error(payload.error_description ?? payload.error ?? 'OAuth token refresh failed.'),
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
      return yield* Effect.fail(new Error('Provider account is not signed in.'));
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
