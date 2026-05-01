import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthSession } from '../app/auth-session';
import { accountVisibilityQueryOptions } from '../queries/forge';

function useEnabledProviderAccounts() {
  const { providerAccounts, providerStatuses } = useAuthSession();
  const accountVisibilityQuery = useQuery(accountVisibilityQueryOptions());

  const readyProviderAccounts = useMemo(
    () => providerAccounts.filter((account) => providerStatuses[account.id]?.status === 'ready'),
    [providerAccounts, providerStatuses],
  );
  const readyAccountIds = useMemo(
    () => new Set(readyProviderAccounts.map((account) => account.id)),
    [readyProviderAccounts],
  );
  const knownAccountIds = useMemo(
    () => new Set(providerAccounts.map((account) => account.id)),
    [providerAccounts],
  );
  const persistedEnabledAccountIds = useMemo(() => {
    if (!accountVisibilityQuery.data) {
      return providerAccounts.map((account) => account.id);
    }

    return accountVisibilityQuery.data.enabledAccountIds.filter((accountId) =>
      knownAccountIds.has(accountId),
    );
  }, [accountVisibilityQuery.data, knownAccountIds, providerAccounts]);
  const enabledAccountIds = useMemo(
    () => persistedEnabledAccountIds.filter((accountId) => readyAccountIds.has(accountId)),
    [persistedEnabledAccountIds, readyAccountIds],
  );
  const enabledAccountIdSet = useMemo(() => new Set(enabledAccountIds), [enabledAccountIds]);
  const enabledProviderAccounts = useMemo(
    () => readyProviderAccounts.filter((account) => enabledAccountIdSet.has(account.id)),
    [enabledAccountIdSet, readyProviderAccounts],
  );

  return {
    enabledAccountIds,
    enabledAccountIdSet,
    enabledProviderAccounts,
    readyProviderAccounts,
  };
}

export { useEnabledProviderAccounts };
