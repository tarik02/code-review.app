import { create } from 'zustand';
import { initialMainAppViewState, type MainAppViewState } from './main-app-view-store';
import type { BrowseSearchSnapshot, PullRequestSearchState } from '../types/forge';

type WorkflowSubmitAction = 'comment' | 'approve' | 'request_changes';

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
  openBrowse(): void;
  openContent(): void;
  openWorkflow(): void;
  setBrowseOpen(open: boolean): void;
  setContentOpen(open: boolean): void;
  setWorkflowOpen(open: boolean): void;
  resetBrowseSearch(): void;
  setBrowseDebouncedQuery(query: string): void;
  setBrowseFilters(nextFilters: BrowsePaletteFiltersUpdater): void;
  setBrowsePullRequestState(state: PullRequestSearchState): void;
  setBrowseQuery(query: string): void;
  setContentQuery(query: string): void;
  setWorkflowQuery(query: string): void;
  setWorkflowSubmitAction(action: WorkflowSubmitAction): void;
  setWorkflowSubmitReviewMode(enabled: boolean): void;
  setWorkflowSubmitSummary(summary: string): void;
  failBrowseSearch(accountIds: string[], error: string): void;
  resetBrowseSearchSnapshot(accountIds?: string[]): void;
  setBrowseSearchLoading(accountIds: string[]): void;
  updateBrowseSearchSnapshot(snapshot: BrowseSearchSnapshot): void;
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
  browseSearchSnapshot: createEmptyBrowseSearchSnapshot(),
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

const useCommandPaletteStore = create<CommandPaletteStore>()((set) => ({
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
  },
  openBrowse() {
    set({
      ...withExclusiveOpenState({ browseOpen: true }),
      contentQuery: '',
      workflowQuery: '',
      workflowSubmitAction: 'comment',
      workflowSubmitReviewMode: false,
      workflowSubmitSummary: '',
    });
  },
  openContent() {
    set({
      ...withExclusiveOpenState({ contentOpen: true }),
      workflowQuery: '',
      workflowSubmitAction: 'comment',
      workflowSubmitReviewMode: false,
      workflowSubmitSummary: '',
    });
  },
  openWorkflow() {
    set({
      ...withExclusiveOpenState({ workflowOpen: true }),
      contentQuery: '',
    });
  },
  setBrowseOpen(open) {
    set(open ? withExclusiveOpenState({ browseOpen: true }) : { browseOpen: false });
  },
  setContentOpen(open) {
    set(
      open
        ? withExclusiveOpenState({ contentOpen: true })
        : { contentOpen: false, contentQuery: '' },
    );
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
  },
  resetBrowseSearch() {
    set({
      browseDebouncedQuery: '',
      browseFilters: initialBrowseFilters,
      browsePullRequestState: 'all',
      browseQuery: '',
    });
  },
  setBrowseDebouncedQuery(query) {
    set({ browseDebouncedQuery: query });
  },
  setBrowseFilters(nextFilters) {
    set((state) => ({
      browseFilters:
        typeof nextFilters === 'function' ? nextFilters(state.browseFilters) : nextFilters,
    }));
  },
  setBrowsePullRequestState(state) {
    set({ browsePullRequestState: state });
  },
  setBrowseQuery(query) {
    set({ browseQuery: query });
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
  failBrowseSearch(accountIds, error) {
    set((state) => ({
      browseSearchSnapshot: {
        ...state.browseSearchSnapshot,
        accountIds,
        errors: [...state.browseSearchSnapshot.errors, error],
        loading: false,
        pendingCount: 0,
      },
    }));
  },
  resetBrowseSearchSnapshot(accountIds = []) {
    set({ browseSearchSnapshot: createEmptyBrowseSearchSnapshot(accountIds) });
  },
  setBrowseSearchLoading(accountIds) {
    set((state) => ({
      browseSearchSnapshot: {
        ...state.browseSearchSnapshot,
        accountIds,
        loading: true,
      },
    }));
  },
  updateBrowseSearchSnapshot(snapshot) {
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
  },
}));

export { useCommandPaletteStore };
export type { BrowsePaletteFilters, CommandPaletteStore };
