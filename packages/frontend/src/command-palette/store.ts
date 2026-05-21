import { create } from 'zustand';
import { trpc } from '../lib/trpc';
import { initialMainAppViewState, type MainAppViewState } from '../stores/main-app-view-store';
import type { BrowseSearchSnapshot, PullRequestSearchState } from '../types/forge';

const BROWSE_QUERY_DEBOUNCE_MS = 250;

type WorkflowSubmitAction = 'comment' | 'approve' | 'request_changes';
type BrowseSearchSubscription = { unsubscribe(): void };

type BrowsePaletteFilters = MainAppViewState & {
  namespaceFilterPath: string | null;
};

type BrowsePaletteFiltersUpdater =
  | BrowsePaletteFilters
  | ((current: BrowsePaletteFilters) => BrowsePaletteFilters);

type BrowsePaletteSearchState = {
  browseDebouncedQuery: string;
  browseFilters: BrowsePaletteFilters;
  browsePullRequestState: PullRequestSearchState;
  browseQuery: string;
  browseSearchAccountIds: string[];
  browseSearchSnapshot: BrowseSearchSnapshot;
};

type CommandPaletteStore = BrowsePaletteSearchState & {
  browseOpen: boolean;
  contentOpen: boolean;
  contentQuery: string;
  workflowQuery: string;
  workflowOpen: boolean;
  workflowSubmitAction: WorkflowSubmitAction;
  workflowSubmitReviewMode: boolean;
  workflowSubmitSummary: string;
  closeAll(): void;
  openBrowse(accountIds?: string[]): void;
  openContent(): void;
  openWorkflow(): void;
  setBrowseOpen(open: boolean): void;
  setContentOpen(open: boolean): void;
  setWorkflowOpen(open: boolean): void;
  setBrowseDebouncedQuery(query: string): void;
  setBrowseFilters(nextFilters: BrowsePaletteFiltersUpdater): void;
  setBrowsePullRequestState(state: PullRequestSearchState): void;
  setBrowseQuery(query: string): void;
  setContentQuery(query: string): void;
  setWorkflowQuery(query: string): void;
  setWorkflowSubmitAction(action: WorkflowSubmitAction): void;
  setWorkflowSubmitReviewMode(enabled: boolean): void;
  setWorkflowSubmitSummary(summary: string): void;
};

const initialBrowseFilters: BrowsePaletteFilters = {
  ...initialMainAppViewState,
  namespaceFilterPath: null,
};

const initialBrowseSearchState: BrowsePaletteSearchState = {
  browseDebouncedQuery: '',
  browseFilters: initialBrowseFilters,
  browsePullRequestState: 'all',
  browseQuery: '',
  browseSearchAccountIds: [],
  browseSearchSnapshot: createEmptyBrowseSearchSnapshot(),
};

const resetBrowseSearchState = {
  browseDebouncedQuery: '',
  browseFilters: initialBrowseFilters,
  browsePullRequestState: 'all' as const,
  browseQuery: '',
};

function createEmptyBrowseSearchSnapshot(accountIds: string[] = []): BrowseSearchSnapshot {
  return {
    repos: [],
    namespaces: [],
    pullRequests: [],
    accountIds,
    pendingCount: 0,
    completedCount: 0,
    errors: [],
    loading: false,
  };
}

function withExclusiveOpenState(
  next: Partial<Pick<CommandPaletteStore, 'browseOpen' | 'contentOpen' | 'workflowOpen'>>,
) {
  return {
    browseOpen: false,
    contentOpen: false,
    workflowOpen: false,
    ...next,
  };
}

function browseSearchInputKey(state: CommandPaletteStore) {
  return JSON.stringify({
    accountIds: state.browseSearchAccountIds,
    query: state.browseDebouncedQuery,
    states: state.browsePullRequestState,
    profileFilterAccountId: state.browseFilters.profileFilterAccountId,
    repoFilterKey: state.browseFilters.repoFilterKey,
    namespaceFilterPath: state.browseFilters.namespaceFilterPath,
  });
}

const useCommandPaletteStore = create<CommandPaletteStore>()((set, get) => {
  let browseSearchSubscription: BrowseSearchSubscription | null = null;
  let browseSearchKey = '';
  let browseSearchDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

  function clearBrowseSearchDebounce() {
    if (browseSearchDebounceTimeout) {
      clearTimeout(browseSearchDebounceTimeout);
      browseSearchDebounceTimeout = null;
    }
  }

  function unsubscribeBrowseSearch() {
    browseSearchSubscription?.unsubscribe();
    browseSearchSubscription = null;
    browseSearchKey = '';
  }

  function failBrowseSearch(accountIds: string[], error: string) {
    set((state) => ({
      browseSearchSnapshot: {
        ...state.browseSearchSnapshot,
        accountIds,
        errors: [...state.browseSearchSnapshot.errors, error],
        loading: false,
        pendingCount: 0,
      },
    }));
  }

  function resetBrowseSearchSnapshot(accountIds: string[] = []) {
    set({ browseSearchSnapshot: createEmptyBrowseSearchSnapshot(accountIds) });
  }

  function setBrowseSearchLoading(accountIds: string[]) {
    set((state) => ({
      browseSearchSnapshot: {
        ...state.browseSearchSnapshot,
        accountIds,
        loading: true,
      },
    }));
  }

  function updateBrowseSearchSnapshot(snapshot: BrowseSearchSnapshot) {
    set((state) => {
      if (snapshot.loading && snapshot.completedCount === 0) {
        return {
          browseSearchSnapshot: {
            ...snapshot,
            repos: state.browseSearchSnapshot.repos,
            namespaces: state.browseSearchSnapshot.namespaces,
            pullRequests: state.browseSearchSnapshot.pullRequests,
          },
        };
      }

      return { browseSearchSnapshot: snapshot };
    });
  }

  function startBrowseSearch() {
    const state = get();
    const accountIds = state.browseSearchAccountIds;

    if (!state.browseOpen || accountIds.length === 0) {
      unsubscribeBrowseSearch();
      resetBrowseSearchSnapshot(accountIds);
      return;
    }

    const nextKey = browseSearchInputKey(state);
    if (nextKey === browseSearchKey) {
      return;
    }

    unsubscribeBrowseSearch();
    browseSearchKey = nextKey;
    setBrowseSearchLoading(accountIds);
    browseSearchSubscription = trpc.browse.search.subscribe(
      {
        accountIds,
        query: state.browseDebouncedQuery,
        states: state.browsePullRequestState,
        profileFilterAccountId: state.browseFilters.profileFilterAccountId,
        repoFilterKey: state.browseFilters.repoFilterKey,
        namespaceFilterPath: state.browseFilters.namespaceFilterPath,
        repoLimit: 100,
        namespaceLimit: 20,
        pullRequestLimit: 12,
      },
      {
        onData: updateBrowseSearchSnapshot,
        onError: (error) => {
          failBrowseSearch(accountIds, error.message);
        },
      },
    );
  }

  function scheduleBrowseSearchDebounce() {
    clearBrowseSearchDebounce();
    const state = get();
    if (!state.browseOpen) {
      startBrowseSearch();
      return;
    }

    browseSearchDebounceTimeout = setTimeout(() => {
      set({ browseDebouncedQuery: get().browseQuery });
      startBrowseSearch();
    }, BROWSE_QUERY_DEBOUNCE_MS);
  }

  return {
    ...initialBrowseSearchState,
    browseOpen: false,
    contentOpen: false,
    contentQuery: '',
    workflowQuery: '',
    workflowOpen: false,
    workflowSubmitAction: 'comment',
    workflowSubmitReviewMode: false,
    workflowSubmitSummary: '',
    closeAll() {
      set({
        ...withExclusiveOpenState({}),
        contentQuery: '',
        workflowQuery: '',
        workflowSubmitAction: 'comment',
        workflowSubmitReviewMode: false,
        workflowSubmitSummary: '',
      });
      startBrowseSearch();
    },
    openBrowse(accountIds) {
      set({
        ...withExclusiveOpenState({ browseOpen: true }),
        ...(accountIds ? { browseSearchAccountIds: accountIds } : {}),
        contentQuery: '',
        workflowQuery: '',
        workflowSubmitAction: 'comment',
        workflowSubmitReviewMode: false,
        workflowSubmitSummary: '',
      });
      startBrowseSearch();
    },
    openContent() {
      set({
        ...withExclusiveOpenState({ contentOpen: true }),
        workflowQuery: '',
        workflowSubmitAction: 'comment',
        workflowSubmitReviewMode: false,
        workflowSubmitSummary: '',
      });
      startBrowseSearch();
    },
    openWorkflow() {
      set({
        ...withExclusiveOpenState({ workflowOpen: true }),
        contentQuery: '',
      });
      startBrowseSearch();
    },
    setBrowseOpen(open) {
      if (open) {
        set(withExclusiveOpenState({ browseOpen: true }));
        startBrowseSearch();
        return;
      }

      clearBrowseSearchDebounce();
      set({
        browseOpen: false,
        ...resetBrowseSearchState,
      });
      startBrowseSearch();
    },
    setContentOpen(open) {
      set(
        open
          ? withExclusiveOpenState({ contentOpen: true })
          : { contentOpen: false, contentQuery: '' },
      );
      if (open) {
        startBrowseSearch();
      }
    },
    setWorkflowOpen(open) {
      set(
        open
          ? withExclusiveOpenState({ workflowOpen: true })
          : {
              workflowOpen: false,
              workflowQuery: '',
              workflowSubmitAction: 'comment',
              workflowSubmitReviewMode: false,
              workflowSubmitSummary: '',
            },
      );
      if (open) {
        startBrowseSearch();
      }
    },
    setBrowseDebouncedQuery(query) {
      clearBrowseSearchDebounce();
      set({ browseDebouncedQuery: query });
      startBrowseSearch();
    },
    setBrowseFilters(nextFilters) {
      set((state) => ({
        browseFilters:
          typeof nextFilters === 'function' ? nextFilters(state.browseFilters) : nextFilters,
      }));
      startBrowseSearch();
    },
    setBrowsePullRequestState(state) {
      set({ browsePullRequestState: state });
      startBrowseSearch();
    },
    setBrowseQuery(query) {
      set({ browseQuery: query });
      scheduleBrowseSearchDebounce();
    },
    setContentQuery(query) {
      set({ contentQuery: query });
    },
    setWorkflowQuery(query) {
      set({ workflowQuery: query });
    },
    setWorkflowSubmitAction(action) {
      set({ workflowSubmitAction: action });
    },
    setWorkflowSubmitReviewMode(enabled) {
      set({
        workflowSubmitReviewMode: enabled,
        workflowSubmitSummary: '',
      });
    },
    setWorkflowSubmitSummary(summary) {
      set({ workflowSubmitSummary: summary });
    },
  };
});

export { useCommandPaletteStore };
export type { BrowsePaletteFilters, CommandPaletteStore };
