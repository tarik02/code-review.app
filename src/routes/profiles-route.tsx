import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { getErrorMessage } from "../hooks/use-forge-queries";
import { useAuthSession } from "../app/auth-session";
import { trpc } from "../lib/trpc";
import {
  accountVisibilityQueryOptions,
  forgeKeys,
  providerProfileQueryOptions,
  setAccountVisibility,
} from "../queries/forge";
import type { ForgeProviderKind, ProviderAccount } from "../types/forge";

function providerName(account: ProviderAccount) {
  return account.provider === "github" ? "GitHub" : "GitLab";
}

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

function ProfilesRoute() {
  const queryClient = useQueryClient();
  const {
    providerAccounts,
    providerStatuses,
    providerStatusMessage,
    isSigningIn,
    signIn,
  } = useAuthSession();
  const [provider, setProvider] = useState<ForgeProviderKind>("github");
  const [host, setHost] = useState("github.com");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const accountVisibilityQuery = useQuery(accountVisibilityQueryOptions());
  const knownAccountIds = useMemo(
    () => new Set(providerAccounts.map((account) => account.id)),
    [providerAccounts],
  );
  const enabledAccountIds = useMemo(() => {
    if (!accountVisibilityQuery.data) {
      return providerAccounts.map((account) => account.id);
    }

    return accountVisibilityQuery.data.enabledAccountIds.filter((accountId) =>
      knownAccountIds.has(accountId),
    );
  }, [accountVisibilityQuery.data, knownAccountIds, providerAccounts]);
  const enabledAccountIdSet = useMemo(
    () => new Set(enabledAccountIds),
    [enabledAccountIds],
  );
  const profileQueries = useQueries({
    queries: providerAccounts.map((account) => ({
      ...providerProfileQueryOptions(account.id),
      enabled: providerStatuses[account.id]?.status === "ready",
    })),
  });
  const visibilityMutation = useMutation({
    mutationFn: setAccountVisibility,
    onSuccess: (visibility) => {
      queryClient.setQueryData(
        accountVisibilityQueryOptions().queryKey,
        visibility,
      );
    },
  });
  const signOutMutation = useMutation({
    mutationFn: (accountId: string) =>
      trpc.auth.signOut.mutate({ accountId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: forgeKeys.providerAccounts(),
        }),
        queryClient.invalidateQueries({
          queryKey: forgeKeys.providerStatuses(),
        }),
        queryClient.invalidateQueries({
          queryKey: [...forgeKeys.auth(), "provider-profile"],
        }),
        queryClient.invalidateQueries({
          queryKey: accountVisibilityQueryOptions().queryKey,
        }),
      ]);
    },
  });
  const normalizedHost =
    normalizeHostInput(host) ||
    (provider === "github" ? "github.com" : "gitlab.com");
  const canStartSignIn =
    (clientId.trim().length > 0 || hasDefaultClientId(provider, normalizedHost)) &&
    !isSigningIn;

  useEffect(() => {
    setHost(provider === "github" ? "github.com" : "gitlab.com");
  }, [provider]);

  function toggleAccountVisibility(accountId: string) {
    const nextEnabled = new Set(enabledAccountIds);
    if (nextEnabled.has(accountId)) {
      nextEnabled.delete(accountId);
    } else {
      nextEnabled.add(accountId);
    }

    visibilityMutation.mutate(
      providerAccounts
        .map((account) => account.id)
        .filter((candidateAccountId) => nextEnabled.has(candidateAccountId)),
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-8">
      <div>
        <h2 className="text-xl font-semibold text-ink-900">Profiles</h2>
        <p className="mt-1 text-sm text-ink-500">
          Manage connected GitHub and GitLab accounts.
        </p>
      </div>

      {providerStatusMessage ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          {providerStatusMessage}
        </p>
      ) : null}

      <div className="rounded-md border border-neutral-200 bg-surface p-4 dark:border-neutral-700">
        <h3 className="text-sm font-semibold text-ink-900">Add account</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-[140px_minmax(0,1fr)]">
          <select
            className="rounded-md border border-neutral-200 bg-surface px-3 py-2 text-sm outline-hidden transition dark:border-neutral-700"
            disabled={isSigningIn}
            onChange={(event) =>
              setProvider(event.currentTarget.value as ForgeProviderKind)
            }
            value={provider}
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
          <input
            className="min-w-0 rounded-md border border-neutral-200 bg-surface px-3 py-2 text-sm outline-hidden transition placeholder:text-neutral-400 dark:border-neutral-700"
            disabled={isSigningIn}
            onChange={(event) => setHost(event.currentTarget.value)}
            placeholder={provider === "github" ? "github.com" : "gitlab.com"}
            value={host}
          />
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid min-w-0 gap-2 md:grid-cols-2">
            <input
              className="min-w-0 rounded-md border border-neutral-200 bg-surface px-3 py-2 text-sm outline-hidden transition placeholder:text-neutral-400 dark:border-neutral-700"
              disabled={isSigningIn}
              onChange={(event) => setClientId(event.currentTarget.value)}
              placeholder={
                hasDefaultClientId(provider, normalizedHost)
                  ? "OAuth client ID (optional)"
                  : "OAuth client ID"
              }
              value={clientId}
            />
            <input
              className="min-w-0 rounded-md border border-neutral-200 bg-surface px-3 py-2 text-sm outline-hidden transition placeholder:text-neutral-400 dark:border-neutral-700"
              disabled={isSigningIn}
              onChange={(event) => setClientSecret(event.currentTarget.value)}
              placeholder="OAuth client secret (optional)"
              type="password"
              value={clientSecret}
            />
          </div>
          <button
            className="rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900"
            disabled={!canStartSignIn}
            onClick={() =>
              signIn(provider, normalizedHost, clientId, clientSecret)
            }
            type="button"
          >
            {isSigningIn ? "Opening..." : "Add account"}
          </button>
        </div>
      </div>

      {providerAccounts.length === 0 ? (
        <div className="rounded-md border border-neutral-200 bg-surface p-5 text-sm text-ink-600 dark:border-neutral-700">
          <p>No provider accounts are configured.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-neutral-200 bg-surface dark:border-neutral-700">
          {providerAccounts.map((account, index) => {
            const status = providerStatuses[account.id];
            const profileQuery = profileQueries[index];
            const profileLogin = profileQuery?.data?.login ?? account.viewerLogin;
            const profileError = getErrorMessage(profileQuery?.error);
            const isSigningOut =
              signOutMutation.isPending &&
              signOutMutation.variables === account.id;
            const isReady = status?.status === "ready";
            const isVisible = enabledAccountIdSet.has(account.id);

            return (
              <div
                className="grid gap-3 border-b border-neutral-200 p-4 last:border-b-0 dark:border-neutral-700 md:grid-cols-[minmax(0,1fr)_auto]"
                key={account.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-ink-900">
                      {providerName(account)}
                    </span>
                    <span className="text-sm text-ink-700">
                      {profileLogin ?? account.label}
                    </span>
                    <span className="rounded bg-canvasDark px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
                      {status?.status ?? "checking"}
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs text-ink-500 md:grid-cols-2">
                    <div>
                      <dt className="font-medium text-ink-600">Host</dt>
                      <dd className="mt-0.5 truncate">{account.host}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-ink-600">Client ID</dt>
                      <dd className="mt-0.5 truncate">
                        {account.clientId || "default"}
                      </dd>
                    </div>
                  </dl>
                  {profileError ? (
                    <p className="mt-3 text-xs text-danger-600">
                      Could not refresh profile: {profileError}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col items-start gap-2 md:items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-ink-700">
                    <input
                      checked={isVisible}
                      className="size-4 rounded border-neutral-300 text-ink-900 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!isReady || visibilityMutation.isPending}
                      onChange={() => toggleAccountVisibility(account.id)}
                      type="checkbox"
                    />
                    Visible in main app
                  </label>
                  <button
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-canvasDark disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700"
                    disabled={isSigningOut}
                    onClick={() => signOutMutation.mutate(account.id)}
                    type="button"
                  >
                    {isSigningOut ? "Signing out..." : "Sign out"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {visibilityMutation.error ? (
        <p className="text-sm text-danger-600">
          {getErrorMessage(visibilityMutation.error)}
        </p>
      ) : null}

      {signOutMutation.error ? (
        <p className="text-sm text-danger-600">
          {getErrorMessage(signOutMutation.error)}
        </p>
      ) : null}
    </div>
  );
}

export { ProfilesRoute };
