import { Link } from "@tanstack/react-router";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "../hooks/use-forge-queries";
import { useAuthSession } from "../app/auth-session";
import { trpc } from "../lib/trpc";
import {
  accountVisibilityQueryOptions,
  forgeKeys,
  providerProfileQueryOptions,
} from "../queries/forge";
import type { ProviderAccount } from "../types/forge";

function providerName(account: ProviderAccount) {
  return account.provider === "github" ? "GitHub" : "GitLab";
}

function ProfilesRoute() {
  const queryClient = useQueryClient();
  const { providerAccounts, providerStatuses } = useAuthSession();
  const profileQueries = useQueries({
    queries: providerAccounts.map((account) => ({
      ...providerProfileQueryOptions(account.id),
      enabled: providerStatuses[account.id]?.status === "ready",
    })),
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-8">
      <div>
        <h2 className="text-xl font-semibold text-ink-900">Profiles</h2>
        <p className="mt-1 text-sm text-ink-500">
          Manage connected GitHub and GitLab accounts.
        </p>
      </div>

      {providerAccounts.length === 0 ? (
        <div className="rounded-md border border-neutral-200 bg-surface p-5 text-sm text-ink-600 dark:border-neutral-700">
          <p>No provider accounts are configured.</p>
          <Link
            className="mt-3 inline-flex rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-ink-800 dark:bg-ink-200 dark:text-ink-900"
            to="/"
          >
            Back to main
          </Link>
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

                <div className="flex items-start justify-end">
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

      {signOutMutation.error ? (
        <p className="text-sm text-danger-600">
          {getErrorMessage(signOutMutation.error)}
        </p>
      ) : null}
    </div>
  );
}

export { ProfilesRoute };
