import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "../hooks/use-forge-queries";
import { trpc } from "../lib/trpc";
import {
  forgeKeys,
  providerAccountsQueryOptions,
  providerStatusesQueryOptions,
} from "../queries/forge";
import type {
  ForgeProviderKind,
  ProviderAccount,
  ProviderAuthStatus,
} from "../types/forge";

type AuthSessionValue = {
  providerAccounts: ProviderAccount[];
  providerStatuses: Record<string, ProviderAuthStatus>;
  isCheckingAuth: boolean;
  hasReadyProvider: boolean;
  gateStatus: ProviderAuthStatus;
  providerStatusMessage: string | null;
  isSigningIn: boolean;
  signIn(provider: ForgeProviderKind, host: string, clientId: string): void;
  checkAgain(): void;
};

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

function normalizeHostInput(host: string) {
  return host
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function AuthSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const pendingOAuthRef = useRef<{
    provider: ForgeProviderKind;
    host: string;
    accountId: string;
  } | null>(null);
  const providerAccountsQuery = useQuery(providerAccountsQueryOptions());
  const providerStatusesQuery = useQuery(providerStatusesQueryOptions());
  const providerAccounts = providerAccountsQuery.data ?? [];
  const providerStatuses = providerStatusesQuery.data ?? {};
  const providerStatusList = Object.values(providerStatuses);
  const hasReadyProvider = providerStatusList.some(
    (status) => status.status === "ready",
  );
  const gateStatus =
    providerStatusList.find((status) => status.status !== "not_authenticated") ??
    providerStatusList[0] ??
    ({ status: "not_authenticated", message: null } satisfies ProviderAuthStatus);
  const isCheckingAuth =
    providerAccountsQuery.isPending ||
    providerStatusesQuery.isPending ||
    providerStatusesQuery.isFetching;
  const providerStatusMessage =
    authMessage ??
    gateStatus.message ??
    (getErrorMessage(providerAccountsQuery.error) ||
      getErrorMessage(providerStatusesQuery.error) ||
      null);

  const checkAgain = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: forgeKeys.providerAccounts(),
    });
    void queryClient.invalidateQueries({
      queryKey: forgeKeys.providerStatuses(),
    });
    void queryClient.invalidateQueries({
      queryKey: forgeKeys.accountVisibility(),
    });
  }, [queryClient]);

  useEffect(() => {
    if (!providerStatusesQuery.data) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: forgeKeys.providerAccounts(),
    });
  }, [providerStatusesQuery.data, queryClient]);

  const signIn = useCallback(
    async (provider: ForgeProviderKind, host: string, clientId: string) => {
      const normalizedHost =
        normalizeHostInput(host) ||
        (provider === "github" ? "github.com" : "gitlab.com");
      setIsSigningIn(true);
      setAuthMessage(null);
      try {
        const result = await trpc.auth.startOAuth.mutate({
          provider,
          host: normalizedHost,
          clientId,
        });
        pendingOAuthRef.current = {
          provider,
          host: normalizedHost,
          accountId: result.accountId,
        };
        window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
      } catch (error) {
        pendingOAuthRef.current = null;
        setAuthMessage(getErrorMessage(error));
      } finally {
        setIsSigningIn(false);
      }
    },
    [],
  );

  useEffect(() => {
    const subscription = trpc.auth.oauthCallbacks.subscribe(undefined, {
      async onData(url) {
        const pending = pendingOAuthRef.current;
        if (!pending) {
          setAuthMessage("OAuth callback received, but no sign in request is active.");
          return;
        }

        try {
          const parsed = new URL(url);
          const code = parsed.searchParams.get("code");
          const state = parsed.searchParams.get("state");
          const error = parsed.searchParams.get("error");
          if (error) {
            throw new Error(parsed.searchParams.get("error_description") ?? error);
          }
          if (!code || !state) {
            throw new Error("OAuth callback is missing a code or state.");
          }
          await trpc.auth.completeOAuth.mutate({ code, state });
          setAuthMessage(null);
          pendingOAuthRef.current = null;
          await queryClient.invalidateQueries({
            queryKey: forgeKeys.providerAccounts(),
          });
          await queryClient.invalidateQueries({
            queryKey: forgeKeys.providerStatuses(),
          });
          await queryClient.invalidateQueries({
            queryKey: forgeKeys.accountVisibility(),
          });
        } catch (error) {
          setAuthMessage(getErrorMessage(error));
        }
      },
      onError(error) {
        setAuthMessage(getErrorMessage(error));
      },
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  const value = useMemo<AuthSessionValue>(
    () => ({
      providerAccounts,
      providerStatuses,
      isCheckingAuth,
      hasReadyProvider,
      gateStatus,
      providerStatusMessage,
      isSigningIn,
      signIn,
      checkAgain,
    }),
    [
      providerAccounts,
      providerStatuses,
      isCheckingAuth,
      hasReadyProvider,
      gateStatus,
      providerStatusMessage,
      isSigningIn,
      signIn,
      checkAgain,
    ],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

function useAuthSession() {
  const value = useContext(AuthSessionContext);
  if (!value) {
    throw new Error("useAuthSession must be used within AuthSessionProvider.");
  }
  return value;
}

export { AuthSessionProvider, useAuthSession };
