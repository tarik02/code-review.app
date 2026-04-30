import { create } from 'zustand';
import type { RepoSummary } from '../types/forge';

type MainAppViewState = {
  profileFilterAccountId: string | null;
  repoFilterKey: string | null;
};

type MainAppViewStore = MainAppViewState & {
  clearProfileFilter(): void;
  clearRepoFilter(): void;
  setProfileFilterAccountId(
    accountId: string | null,
    repoAccountIdByKey?: Record<string, string | undefined>,
  ): void;
  setRepoFilter(repo: Pick<RepoSummary, 'providerAccountId' | 'repoKey'> | null): void;
};

function applyProfileFilterChange(
  state: MainAppViewState,
  accountId: string | null,
  repoAccountIdByKey: Record<string, string | undefined> = {},
): MainAppViewState {
  const nextProfileFilterAccountId = accountId?.trim() || null;
  const repoOwnerAccountId = state.repoFilterKey
    ? repoAccountIdByKey[state.repoFilterKey] ?? null
    : null;

  return {
    profileFilterAccountId: nextProfileFilterAccountId,
    repoFilterKey:
      nextProfileFilterAccountId && repoOwnerAccountId !== nextProfileFilterAccountId
        ? null
        : state.repoFilterKey,
  };
}

function applyRepoFilterChange(
  state: MainAppViewState,
  repo: Pick<RepoSummary, 'providerAccountId' | 'repoKey'> | null,
): MainAppViewState {
  if (!repo) {
    return {
      ...state,
      repoFilterKey: null,
    };
  }

  return {
    profileFilterAccountId: repo.providerAccountId,
    repoFilterKey: repo.repoKey,
  };
}

const initialMainAppViewState: MainAppViewState = {
  profileFilterAccountId: null,
  repoFilterKey: null,
};

const useMainAppViewStore = create<MainAppViewStore>()((set) => ({
  ...initialMainAppViewState,
  clearProfileFilter() {
    set(() => ({
      profileFilterAccountId: null,
      repoFilterKey: null,
    }));
  },
  clearRepoFilter() {
    set((state) => ({
      ...state,
      repoFilterKey: null,
    }));
  },
  setProfileFilterAccountId(accountId, repoAccountIdByKey = {}) {
    set((state) => applyProfileFilterChange(state, accountId, repoAccountIdByKey));
  },
  setRepoFilter(repo) {
    set((state) => applyRepoFilterChange(state, repo));
  },
}));

export {
  applyProfileFilterChange,
  applyRepoFilterChange,
  initialMainAppViewState,
  useMainAppViewStore,
};
export type { MainAppViewState, MainAppViewStore };
