import { createHash, randomBytes } from "node:crypto";
import { HttpClient } from "@effect/platform";
import { Effect } from "effect";
import { normalizeHost } from "../repo-id.ts";
import {
  exchangeDeviceOAuthCode,
  exchangeOAuthCode,
  oauthConfig,
  requestDeviceOAuthCode,
} from "./provider-auth.ts";
import type { AuthTokenStore } from "./token-store.ts";
import type { ForgeProviderKind } from "@code-review-app/shared";

type OAuthSession = {
  accountId: string;
  provider: ForgeProviderKind;
  host: string;
  clientId: string;
  clientSecret: string;
  codeVerifier: string;
  createdAt: number;
};

type DeviceOAuthSession = {
  accountId: string;
  provider: "github";
  host: string;
  clientId: string;
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
  createdAt: number;
};

type StartOAuthResult =
  | {
      type: "device";
      authorizationUrl: string;
      accountId: string;
      userCode: string;
      verificationUri: string;
      expiresAt: number;
      intervalMs: number;
    }
  | {
      type: "browser";
      authorizationUrl: string;
      accountId: string;
      state: string;
    };

const sessions = new Map<string, OAuthSession>();
const deviceSessions = new Map<string, DeviceOAuthSession>();
const SESSION_TTL_MS = 10 * 60 * 1000;

function base64Url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createCodeVerifier() {
  return base64Url(randomBytes(48));
}

function createCodeChallenge(codeVerifier: string) {
  return base64Url(createHash("sha256").update(codeVerifier).digest());
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [state, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(state);
    }
  }
  for (const [accountId, session] of deviceSessions) {
    if (session.expiresAt <= now) {
      deviceSessions.delete(accountId);
    }
  }
}

function startOAuth(
  provider: ForgeProviderKind,
  host: string,
  clientId: string,
  clientSecret = "",
): Effect.Effect<StartOAuthResult, Error, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    pruneExpiredSessions();
    const normalizedHost = normalizeHost(host);
    const accountId = base64Url(randomBytes(18));
    const config = yield* Effect.try({
      try: () => oauthConfig(provider, normalizedHost, clientId, clientSecret),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    });

    if (provider === "github" && !config.clientSecret) {
      const deviceCode = yield* requestDeviceOAuthCode(provider, normalizedHost, config.clientId);
      const expiresAt = Date.now() + deviceCode.expiresIn * 1000;
      deviceSessions.set(accountId, {
        accountId,
        provider,
        host: normalizedHost,
        clientId: deviceCode.clientId,
        deviceCode: deviceCode.deviceCode,
        intervalMs: deviceCode.intervalMs,
        expiresAt,
        createdAt: Date.now(),
      });

      return {
        type: "device" as const,
        authorizationUrl: deviceCode.verificationUri,
        accountId,
        userCode: deviceCode.userCode,
        verificationUri: deviceCode.verificationUri,
        expiresAt,
        intervalMs: deviceCode.intervalMs,
      };
    }

    const state = base64Url(randomBytes(32));
    const codeVerifier = createCodeVerifier();
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", createCodeChallenge(codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");

    sessions.set(state, {
      accountId,
      provider,
      host: normalizedHost,
      clientId: config.clientId,
      clientSecret: config.clientSecret ?? "",
      codeVerifier,
      createdAt: Date.now(),
    });

    return {
      type: "browser" as const,
      authorizationUrl: url.toString(),
      accountId,
      state,
    };
  });
}

function pollDeviceOAuth(
  accountId: string,
): Effect.Effect<
  { status: "pending"; intervalMs: number } | { status: "complete"; accountId: string },
  Error,
  AuthTokenStore | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    pruneExpiredSessions();
    const session = deviceSessions.get(accountId);
    if (!session) {
      return yield* Effect.fail(new Error("OAuth device sign in expired or was not started."));
    }

    const result = yield* exchangeDeviceOAuthCode(
      session.accountId,
      session.provider,
      session.host,
      session.clientId,
      session.deviceCode,
    );
    if (result.status === "pending") {
      deviceSessions.set(accountId, {
        ...session,
        intervalMs: result.intervalMs,
      });
      return result;
    }

    deviceSessions.delete(accountId);
    return { status: "complete", accountId };
  });
}

function completeOAuth(
  code: string,
  state: string,
): Effect.Effect<OAuthSession, Error, AuthTokenStore | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    pruneExpiredSessions();
    const session = sessions.get(state);
    sessions.delete(state);
    if (!session) {
      return yield* Effect.fail(new Error("OAuth sign in expired or has an invalid state."));
    }
    yield* exchangeOAuthCode(
      session.accountId,
      session.provider,
      session.host,
      session.clientId,
      session.clientSecret,
      code,
      session.codeVerifier,
    );
    return session;
  });
}

export { completeOAuth, pollDeviceOAuth, startOAuth };
