import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { appearanceBackgroundQueryOptions } from "../../queries/forge";
import type {
  ForgeProviderKind,
  ProviderAccount,
  ProviderAuthStatus,
  ProviderAuthStatusKind,
} from "../../types/forge";
import { AppearanceBackground } from "./appearance-background";
import { TopBar } from "./top-bar";

type AuthGateScreenProps = {
  status: ProviderAuthStatusKind;
  message: string | null;
  isChecking: boolean;
  isSigningIn: boolean;
  accounts: ProviderAccount[];
  statuses: Record<string, ProviderAuthStatus>;
  onSignIn: (
    provider: ForgeProviderKind,
    host: string,
    clientId: string,
    clientSecret?: string,
  ) => void;
  onCheckAgain: () => void;
};

function normalizeHostInput(host: string) {
  return host
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function hasDefaultClientId(provider: ForgeProviderKind, host: string) {
  return (
    (provider === "github" && host === "github.com") ||
    (provider === "gitlab" && host === "gitlab.com")
  );
}

function AuthGateScreen({
  status,
  message,
  isChecking,
  isSigningIn,
  accounts,
  statuses,
  onSignIn,
  onCheckAgain,
}: AuthGateScreenProps) {
  const [provider, setProvider] = useState<ForgeProviderKind>("github");
  const [host, setHost] = useState("github.com");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const backgroundQuery = useQuery(appearanceBackgroundQueryOptions());

  useEffect(() => {
    setHost(provider === "github" ? "github.com" : "gitlab.com");
  }, [provider]);

  const normalizedHost =
    normalizeHostInput(host) || (provider === "github" ? "github.com" : "gitlab.com");
  const canStartSignIn =
    (clientId.trim().length > 0 || hasDefaultClientId(provider, normalizedHost)) &&
    !isChecking &&
    !isSigningIn;
  const title = isChecking
    ? <>Checking provider auth...</>
    : status === "not_authenticated"
      ? <>Sign in to a provider</>
      : <>Couldn't verify provider auth.</>;
  const description = isChecking
    ? <>Hold on while we verify your provider sessions.</>
    : status === "not_authenticated"
      ? <>Connect GitHub or GitLab to load repositories and review threads.</>
      : <>Try again after checking the provider configuration.</>;

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-ink-50">
      <AppearanceBackground
        background={backgroundQuery.data}
        className="absolute inset-0 h-full w-full object-cover"
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent" />

      <TopBar className="relative z-10 cursor-grab app-region-drag" position="left" />

      <div className="relative z-10 flex h-full items-end justify-center">
        <div className="w-full px-6 pb-16 sm:px-10 sm:pb-24">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <h1 className="text-2xl font-semibold text-white sm:text-3xl">{title}</h1>
            <p className="mt-3 text-sm text-white/80 sm:text-base">{description}</p>

            <div className="mt-6 w-full max-w-lg rounded-md border border-white/15 bg-black/40 p-3 text-left">
              <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
                <select
                  className="rounded-md border border-white/20 bg-black/45 px-3 py-2 text-sm text-white outline-hidden"
                  disabled={isChecking || isSigningIn}
                  onChange={(event) =>
                    setProvider(event.currentTarget.value as ForgeProviderKind)
                  }
                  value={provider}
                >
                  <option value="github">GitHub</option>
                  <option value="gitlab">GitLab</option>
                </select>
                <input
                  className="rounded-md border border-white/20 bg-black/45 px-3 py-2 text-sm text-white outline-hidden placeholder:text-white/45"
                  disabled={isChecking || isSigningIn}
                  onChange={(event) => setHost(event.currentTarget.value)}
                  placeholder={provider === "github" ? "github.com" : "gitlab.com"}
                  value={host}
                />
              </div>
              <input
                className="mt-2 w-full rounded-md border border-white/20 bg-black/45 px-3 py-2 text-sm text-white outline-hidden placeholder:text-white/45"
                disabled={isChecking || isSigningIn}
                onChange={(event) => setClientId(event.currentTarget.value)}
                placeholder={
                  hasDefaultClientId(provider, normalizedHost)
                    ? "OAuth client ID (optional)"
                    : "OAuth client ID"
                }
                value={clientId}
              />
              <input
                className="mt-2 w-full rounded-md border border-white/20 bg-black/45 px-3 py-2 text-sm text-white outline-hidden placeholder:text-white/45"
                disabled={isChecking || isSigningIn}
                onChange={(event) => setClientSecret(event.currentTarget.value)}
                placeholder="OAuth client secret (optional)"
                type="password"
                value={clientSecret}
              />
              <button
                className="mt-2 w-full rounded-md bg-white px-3 py-2 text-sm font-medium text-ink-950 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canStartSignIn}
                onClick={() =>
                  onSignIn(provider, normalizedHost, clientId, clientSecret)
                }
                type="button"
              >
                {isSigningIn
                  ? "Opening..."
                  : `Sign in with ${provider === "github" ? "GitHub" : "GitLab"}`}
              </button>
            </div>

            {accounts.length > 0 ? (
              <div className="mt-4 w-full max-w-lg rounded-md border border-white/15 bg-black/35 p-3 text-left">
                <p className="text-xs font-medium uppercase text-white/55">
                  Configured accounts
                </p>
                <div className="mt-2 flex max-h-36 flex-col gap-1 overflow-y-auto">
                  {accounts.map((account) => {
                    const accountStatus = statuses[account.id];
                    return (
                      <div
                        className="flex items-center justify-between gap-3 rounded border border-white/10 px-2 py-1.5 text-xs text-white/75"
                        key={account.id}
                      >
                        <span className="min-w-0 truncate">
                          {account.provider === "github" ? "GitHub" : "GitLab"} ·{" "}
                          {account.label}
                        </span>
                        <span className="shrink-0 text-white/55">
                          {accountStatus?.status ?? "checking"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {message ? (
              <p className="mt-4 max-w-xl text-xs text-white/65">{message}</p>
            ) : null}

            <button
              className="mt-6 inline-flex items-center gap-2 px-1 py-1 text-sm font-medium text-white transition hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isChecking}
              onClick={onCheckAgain}
              type="button"
            >
              <ArrowPathIcon className="size-4" />
              {isChecking ? "Checking..." : "Check again"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { AuthGateScreen };
export type { AuthGateScreenProps };
