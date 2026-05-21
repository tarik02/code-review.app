import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '../lib/trpc';
import {
  forgeKeys,
  providerAccountsQueryOptions,
  providerStatusesQueryOptions,
} from '../queries/forge';
import { normalizeHostInput } from '../lib/forge-links';
import { getCaughtErrorMessage } from '../lib/caught-error';
import type { ForgeProviderKind, ProviderAccount, ProviderAuthStatus } from '../types/forge';

type AuthSessionValue = {
  providerAccounts: ProviderAccount[];
  providerStatuses: Record<string, ProviderAuthStatus>;
  isCheckingAuth: boolean;
  hasReadyProvider: boolean;
  gateStatus: ProviderAuthStatus;
  providerStatusMessage: string | null;
  isSigningIn: boolean;
  signIn(provider: ForgeProviderKind, host: string, clientId: string, clientSecret?: string): void;
  checkAgain(): void;
};

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

function AuthSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const pendingOAuthRef = useRef<{
    provider: ForgeProviderKind;
    host: string;
    accountId: string;
    startedAt: number;
  } | null>(null);
  const handledOAuthCallbackUrlsRef = useRef<Set<string>>(new Set());
  const [pendingOAuthStartedAt, setPendingOAuthStartedAt] = useState<number | null>(null);
  const [pendingDeviceOAuth, setPendingDeviceOAuth] = useState<{
    accountId: string;
    userCode: string;
    verificationUri: string;
    expiresAt: number;
    intervalMs: number;
  } | null>(null);
  const providerAccountsQuery = useQuery(providerAccountsQueryOptions());
  const providerStatusesQuery = useQuery(providerStatusesQueryOptions());
  const providerAccounts = useMemo(
    () => providerAccountsQuery.data ?? [],
    [providerAccountsQuery.data],
  );
  const providerStatuses = useMemo(
    () => providerStatusesQuery.data ?? {},
    [providerStatusesQuery.data],
  );
  const providerStatusList = Object.values(providerStatuses);
  const hasReadyProvider = providerStatusList.some((status) => status.status === 'ready');
  const gateStatus =
    providerStatusList.find((status) => status.status !== 'not_authenticated') ??
    providerStatusList[0] ??
    ({ status: 'not_authenticated', message: null } satisfies ProviderAuthStatus);
  const isCheckingAuth =
    providerAccountsQuery.isPending ||
    providerStatusesQuery.isPending ||
    providerStatusesQuery.isFetching;
  const providerStatusMessage =
    authMessage ??
    gateStatus.message ??
    (providerAccountsQuery.error?.message ||
      providerStatusesQuery.error?.message ||
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

  const refreshAuthQueries = useCallback(async () => {
    const [accounts, statuses] = await Promise.all([
      trpc.auth.listProviderAccounts.query(),
      trpc.auth.getProviderStatuses.query(),
    ]);
    queryClient.setQueryData(forgeKeys.providerAccounts(), accounts);
    queryClient.setQueryData(forgeKeys.providerStatuses(), statuses);
    await queryClient.invalidateQueries({
      queryKey: forgeKeys.accountVisibility(),
    });
  }, [queryClient]);

  const signIn = useCallback(
    async (provider: ForgeProviderKind, host: string, clientId: string, clientSecret = '') => {
      const normalizedHost = normalizeHostInput(
        host || (provider === 'github' ? 'github.com' : 'gitlab.com'),
      );
      setIsSigningIn(true);
      setAuthMessage(null);
      try {
        const result = await trpc.auth.startOAuth.mutate({
          provider,
          host: normalizedHost,
          clientId,
          clientSecret,
        });
        if (result.type === 'device') {
          pendingOAuthRef.current = null;
          setPendingOAuthStartedAt(null);
          setPendingDeviceOAuth({
            accountId: result.accountId,
            userCode: result.userCode,
            verificationUri: result.verificationUri,
            expiresAt: result.expiresAt,
            intervalMs: result.intervalMs,
          });
          setAuthMessage(`Enter code ${result.userCode} in GitHub to finish signing in.`);
          window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer');
          return;
        }

        pendingOAuthRef.current = {
          provider,
          host: normalizedHost,
          accountId: result.accountId,
          startedAt: Date.now(),
        };
        setPendingOAuthStartedAt(pendingOAuthRef.current.startedAt);
        window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer');
      } catch (error) {
        pendingOAuthRef.current = null;
        setPendingOAuthStartedAt(null);
        setAuthMessage(getCaughtErrorMessage(error));
      } finally {
        setIsSigningIn(false);
      }
    },
    [],
  );

  const handleOAuthCallback = useCallback(
    async (url: string) => {
      if (handledOAuthCallbackUrlsRef.current.has(url)) {
        return;
      }

      const pending = pendingOAuthRef.current;
      if (!pending) {
        setAuthMessage('OAuth callback received, but no sign in request is active.');
        return;
      }

      handledOAuthCallbackUrlsRef.current.add(url);

      try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get('code');
        const state = parsed.searchParams.get('state');
        const error = parsed.searchParams.get('error');
        if (error) {
          throw new Error(parsed.searchParams.get('error_description') ?? error);
        }
        if (!code || !state) {
          throw new Error('OAuth callback is missing a code or state.');
        }
        await trpc.auth.completeOAuth.mutate({ code, state });
        await refreshAuthQueries();
        setAuthMessage(null);
        pendingOAuthRef.current = null;
        setPendingOAuthStartedAt(null);
      } catch (error) {
        pendingOAuthRef.current = null;
        setPendingOAuthStartedAt(null);
        setAuthMessage(getCaughtErrorMessage(error));
      }
    },
    [refreshAuthQueries],
  );

  useEffect(() => {
    const subscription = trpc.auth.oauthCallbacks.subscribe(undefined, {
      onData(url) {
        void handleOAuthCallback(url);
      },
      onError(error) {
        setAuthMessage(error.message);
      },
    });

    return () => subscription.unsubscribe();
  }, [handleOAuthCallback]);

  useEffect(() => {
    if (pendingOAuthStartedAt === null) {
      return undefined;
    }
    const oauthStartedAt = pendingOAuthStartedAt;

    let isDisposed = false;

    async function checkLatestOAuthCallback() {
      try {
        const callback = await trpc.auth.latestOAuthCallback.query();
        if (isDisposed || !callback || callback.emittedAt < oauthStartedAt) {
          return;
        }
        await handleOAuthCallback(callback.url);
      } catch (error) {
        if (!isDisposed) {
          setAuthMessage(getCaughtErrorMessage(error));
        }
      }
    }

    void checkLatestOAuthCallback();
    const interval = window.setInterval(() => {
      void checkLatestOAuthCallback();
    }, 1000);

    return () => {
      isDisposed = true;
      window.clearInterval(interval);
    };
  }, [handleOAuthCallback, pendingOAuthStartedAt]);

  useEffect(() => {
    if (!pendingDeviceOAuth) {
      return undefined;
    }
    const deviceOAuth = pendingDeviceOAuth;

    let isDisposed = false;

    async function pollDeviceOAuth() {
      if (Date.now() > deviceOAuth.expiresAt) {
        setPendingDeviceOAuth(null);
        setAuthMessage('OAuth device sign in expired. Start sign in again.');
        return;
      }

      try {
        const result = await trpc.auth.pollDeviceOAuth.mutate({
          accountId: deviceOAuth.accountId,
        });
        if (isDisposed) return;
        if (result.status === 'pending') {
          setPendingDeviceOAuth((current) =>
            current
              ? {
                  ...current,
                  intervalMs: result.intervalMs,
                }
              : current,
          );
          return;
        }

        await refreshAuthQueries();
        if (isDisposed) return;
        setPendingDeviceOAuth(null);
        setAuthMessage(null);
      } catch (error) {
        if (!isDisposed) {
          setPendingDeviceOAuth(null);
          setAuthMessage(getCaughtErrorMessage(error));
        }
      }
    }

    const timeout = window.setTimeout(() => {
      void pollDeviceOAuth();
    }, pendingDeviceOAuth.intervalMs);

    return () => {
      isDisposed = true;
      window.clearTimeout(timeout);
    };
  }, [pendingDeviceOAuth, refreshAuthQueries]);

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

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

function useAuthSession() {
  const value = useContext(AuthSessionContext);
  if (!value) {
    throw new Error('useAuthSession must be used within AuthSessionProvider.');
  }
  return value;
}

export { AuthSessionProvider, useAuthSession };
