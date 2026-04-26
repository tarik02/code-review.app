import { Popover } from "@base-ui/react/popover";
import { CheckIcon, ChevronDownIcon } from "@heroicons/react/20/solid";
import type { ProviderAccount, ProviderAuthStatus } from "../../types/forge";

type AccountFilterMenuProps = {
  accounts: ProviderAccount[];
  statuses: Record<string, ProviderAuthStatus>;
  enabledAccountIds: string[];
  isUpdating: boolean;
  onChange(enabledAccountIds: string[]): void;
};

function getAccountLabel(account: ProviderAccount) {
  return `${account.provider === "github" ? "GitHub" : "GitLab"} · ${account.label}`;
}

function getButtonLabel(
  readyAccounts: ProviderAccount[],
  enabledAccountIds: string[],
) {
  const readyAccountIds = new Set(readyAccounts.map((account) => account.id));
  const readyEnabledAccountIds = enabledAccountIds.filter((accountId) =>
    readyAccountIds.has(accountId),
  );

  if (readyEnabledAccountIds.length === 0) return "No accounts";
  if (
    readyAccounts.length > 0 &&
    readyEnabledAccountIds.length === readyAccounts.length
  ) {
    return "All accounts";
  }
  if (readyEnabledAccountIds.length === 1) {
    const account = readyAccounts.find(
      (candidate) => candidate.id === readyEnabledAccountIds[0],
    );
    return account?.label ?? "1 account";
  }
  return `${readyEnabledAccountIds.length} accounts`;
}

function AccountFilterMenu({
  accounts,
  statuses,
  enabledAccountIds,
  isUpdating,
  onChange,
}: AccountFilterMenuProps) {
  const readyAccounts = accounts.filter(
    (account) => statuses[account.id]?.status === "ready",
  );
  const enabledSet = new Set(enabledAccountIds);
  const buttonLabel = getButtonLabel(readyAccounts, enabledAccountIds);

  function toggleAccount(accountId: string) {
    const nextEnabled = new Set(enabledAccountIds);
    if (nextEnabled.has(accountId)) {
      nextEnabled.delete(accountId);
    } else {
      nextEnabled.add(accountId);
    }
    onChange(
      accounts
        .map((account) => account.id)
        .filter((readyAccountId) => nextEnabled.has(readyAccountId)),
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        className="inline-flex max-w-[150px] items-center gap-1 rounded px-2 py-1 text-xs font-medium text-ink-600 transition hover:bg-canvasDark hover:text-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={accounts.length === 0 || isUpdating}
        type="button"
      >
        <span className="min-w-0 truncate">{buttonLabel}</span>
        <ChevronDownIcon className="size-3.5 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup className="z-50 w-72 rounded-md border border-neutral-200 bg-surface p-1 text-sm shadow-lg outline-hidden dark:border-neutral-700">
            {accounts.length === 0 ? (
              <div className="px-2 py-2 text-xs text-ink-500">
                No provider accounts.
              </div>
            ) : null}
            {accounts.map((account) => {
              const status = statuses[account.id];
              const isReady = status?.status === "ready";
              const isEnabled = enabledSet.has(account.id);
              return (
                <button
                  className="flex w-full items-start gap-2 rounded px-2 py-2 text-left transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!isReady || isUpdating}
                  key={account.id}
                  onClick={() => toggleAccount(account.id)}
                  type="button"
                >
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-neutral-300 bg-canvas dark:border-neutral-700">
                    {isReady && isEnabled ? (
                      <CheckIcon className="size-3 text-ink-700" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink-700">
                      {getAccountLabel(account)}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-500">
                      {isReady ? account.host : status?.message ?? "Not ready"}
                    </span>
                  </span>
                </button>
              );
            })}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export { AccountFilterMenu };
export type { AccountFilterMenuProps };
