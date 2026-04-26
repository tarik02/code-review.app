import { createHash, randomBytes } from "node:crypto";
import { normalizeHost } from "../repo-id";
import { exchangeOAuthCode, oauthConfig } from "./provider-auth";
import type { ForgeProviderKind } from "../../shared/types";

type OAuthSession = {
  accountId: string;
  provider: ForgeProviderKind;
  host: string;
  clientId: string;
  codeVerifier: string;
  createdAt: number;
};

const sessions = new Map<string, OAuthSession>();
const SESSION_TTL_MS = 10 * 60 * 1000;

function base64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
}

function startOAuth(provider: ForgeProviderKind, host: string, clientId: string) {
  pruneExpiredSessions();
  const normalizedHost = normalizeHost(host);
  const accountId = base64Url(randomBytes(18));
  const config = oauthConfig(provider, normalizedHost, clientId);
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
    codeVerifier,
    createdAt: Date.now(),
  });

  return {
    authorizationUrl: url.toString(),
    accountId,
    state,
  };
}

async function completeOAuth(
  code: string,
  state: string,
) {
  pruneExpiredSessions();
  const session = sessions.get(state);
  sessions.delete(state);
  if (!session) {
    throw new Error("OAuth sign in expired or has an invalid state.");
  }
  await exchangeOAuthCode(
    session.accountId,
    session.provider,
    session.host,
    session.clientId,
    code,
    session.codeVerifier,
  );
  return session;
}

export { completeOAuth, startOAuth };
