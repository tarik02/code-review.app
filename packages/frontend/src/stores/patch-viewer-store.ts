import { create } from 'zustand';
import type { FileDiffMetadata } from '@pierre/diffs';
import type { PendingReviewSubmitAction, PrFileContents } from '../types/forge';
import { hydrateProviderFileDiff } from '../lib/provider-diff-expansion';

const MAX_PATCH_VIEWER_SESSIONS = 20;

type HunkExpansionDirection = 'up' | 'down' | 'both';

type HunkExpansionRegion = {
  fromStart: number;
  fromEnd: number;
};

type PatchViewerNavigationIntent =
  | {
      kind: 'file';
      path: string;
    }
  | {
      kind: 'global-comments';
    }
  | {
      kind: 'thread';
      threadKey: string;
      filePath: string | null;
      isGlobal: boolean;
      expandInactiveComments: boolean;
    };

type PatchViewerSessionState = {
  selectedFilePath: string | null;
  pendingScrollPath: string | null;
  scrollTop: number | null;
  pendingReviewSummary: string;
  pendingReviewAction: PendingReviewSubmitAction;
  isPendingReviewTypeSelectOpen: boolean;
  threadExpansionByKey: Record<string, boolean | undefined>;
  highlightedThreadKey: string | null;
  highlightedThreadVersion: number;
  navigationIntent: PatchViewerNavigationIntent | null;
  navigationIntentVersion: number;
  hunkExpansionsByFile: Record<string, Record<string, HunkExpansionRegion | undefined> | undefined>;
};

type ProviderExpansionScrollAnchor = {
  filePath: string;
  hunkIndex: number;
  top: number | null;
};

type ProviderExpansionLoadRequest = {
  anchorTop: number | null;
  expansion: {
    hunkIndex: number;
    direction: HunkExpansionDirection;
    lineCount: number;
  };
  filePath: string;
  loadFileContents: () => Promise<PrFileContents>;
  onError: (error: unknown) => void;
  onSuccess: (result: {
    direction: HunkExpansionDirection;
    filePath: string;
    hunkIndex: number;
    lineCount: number;
  }) => void;
  scopeKey: string;
  sourceFileDiff: FileDiffMetadata;
};

type PatchViewerStore = {
  sessionsByKey: Record<string, PatchViewerSessionState | undefined>;
  sessionOrder: string[];
  providerExpansionScopeKey: string;
  hydratedProviderDiffsByPath: Record<string, FileDiffMetadata | undefined>;
  providerExpansionInFlightByPath: Record<string, boolean | undefined>;
  providerExpansionScrollAnchor: ProviderExpansionScrollAnchor | null;
  ensureSession: (sessionKey: string | null) => void;
  resetSession: (sessionKey: string | null) => void;
  removeSession: (sessionKey: string | null) => void;
  setSelectedFilePath: (sessionKey: string | null, path: string | null) => void;
  setPendingScrollPath: (sessionKey: string | null, path: string | null) => void;
  setScrollTop: (sessionKey: string | null, scrollTop: number | null) => void;
  setPendingReviewSummary: (sessionKey: string | null, summary: string) => void;
  setPendingReviewAction: (sessionKey: string | null, action: PendingReviewSubmitAction) => void;
  setPendingReviewTypeSelectOpen: (sessionKey: string | null, open: boolean) => void;
  resetPendingReviewInput: (sessionKey: string | null) => void;
  setThreadExpanded: (sessionKey: string | null, threadKey: string, expanded: boolean) => void;
  highlightThread: (sessionKey: string | null, threadKey: string | null) => void;
  clearNavigationIntent: (sessionKey: string | null, version: number) => void;
  recordHunkExpansion: (
    sessionKey: string | null,
    filePath: string,
    hunkIndex: number,
    direction: HunkExpansionDirection,
    lineCount: number,
  ) => void;
  requestNavigationIntent: (sessionKey: string | null, intent: PatchViewerNavigationIntent) => void;
  selectFile: (sessionKey: string | null, path: string) => void;
  resetNavigation: (sessionKey: string | null) => void;
  resetProviderExpansion: (scopeKey: string) => void;
  setHydratedProviderDiff: (scopeKey: string, filePath: string, fileDiff: FileDiffMetadata) => void;
  setProviderExpansionInFlight: (scopeKey: string, filePath: string, isInFlight: boolean) => void;
  setProviderExpansionScrollAnchor: (anchor: ProviderExpansionScrollAnchor | null) => void;
  clearProviderExpansionScrollAnchor: (filePath: string) => void;
  loadProviderDiffForExpansion: (request: ProviderExpansionLoadRequest) => Promise<void>;
};

function createPatchViewerSessionState(): PatchViewerSessionState {
  return {
    selectedFilePath: null,
    pendingScrollPath: null,
    scrollTop: null,
    pendingReviewSummary: '',
    pendingReviewAction: 'comment',
    isPendingReviewTypeSelectOpen: false,
    threadExpansionByKey: {},
    highlightedThreadKey: null,
    highlightedThreadVersion: 0,
    navigationIntent: null,
    navigationIntentVersion: 0,
    hunkExpansionsByFile: {},
  };
}

const emptyPatchViewerSessionState = createPatchViewerSessionState();

function getPatchViewerSessionState(
  state: Pick<PatchViewerStore, 'sessionsByKey'>,
  sessionKey: string | null,
) {
  if (!sessionKey) {
    return emptyPatchViewerSessionState;
  }

  return state.sessionsByKey[sessionKey] ?? emptyPatchViewerSessionState;
}

function touchSessionKey(sessionOrder: string[], sessionKey: string) {
  return [
    ...sessionOrder.filter((currentSessionKey) => currentSessionKey !== sessionKey),
    sessionKey,
  ];
}

function pruneSessions(sessionsByKey: PatchViewerStore['sessionsByKey'], sessionOrder: string[]) {
  if (sessionOrder.length <= MAX_PATCH_VIEWER_SESSIONS) {
    return { sessionsByKey, sessionOrder };
  }

  const nextSessionOrder = sessionOrder.slice(-MAX_PATCH_VIEWER_SESSIONS);
  const retainedSessionKeys = new Set(nextSessionOrder);
  const nextSessionsByKey: PatchViewerStore['sessionsByKey'] = {};

  for (const sessionKey of retainedSessionKeys) {
    nextSessionsByKey[sessionKey] = sessionsByKey[sessionKey];
  }

  return {
    sessionsByKey: nextSessionsByKey,
    sessionOrder: nextSessionOrder,
  };
}

function updateSession(
  state: PatchViewerStore,
  sessionKey: string | null,
  update: (session: PatchViewerSessionState) => Partial<PatchViewerSessionState>,
) {
  if (!sessionKey) {
    return state;
  }

  const currentSession = state.sessionsByKey[sessionKey] ?? createPatchViewerSessionState();
  const sessionUpdate = update(currentSession);
  const updateEntries = Object.entries(sessionUpdate) as Array<
    [keyof PatchViewerSessionState, PatchViewerSessionState[keyof PatchViewerSessionState]]
  >;
  if (updateEntries.every(([key, value]) => currentSession[key] === value)) {
    return state;
  }

  const nextSession = {
    ...currentSession,
    ...sessionUpdate,
  };
  const nextSessionOrder = touchSessionKey(state.sessionOrder, sessionKey);

  return pruneSessions(
    {
      ...state.sessionsByKey,
      [sessionKey]: nextSession,
    },
    nextSessionOrder,
  );
}

const usePatchViewerStore = create<PatchViewerStore>()((set, get) => ({
  sessionsByKey: {},
  sessionOrder: [],
  providerExpansionScopeKey: '',
  hydratedProviderDiffsByPath: {},
  providerExpansionInFlightByPath: {},
  providerExpansionScrollAnchor: null,
  ensureSession(sessionKey) {
    if (!sessionKey || get().sessionsByKey[sessionKey]) {
      return;
    }

    set((state) => updateSession(state, sessionKey, () => createPatchViewerSessionState()));
  },
  resetSession(sessionKey) {
    if (!sessionKey) {
      return;
    }

    set((state) => updateSession(state, sessionKey, () => createPatchViewerSessionState()));
  },
  removeSession(sessionKey) {
    if (!sessionKey) {
      return;
    }

    set((state) => {
      const nextSessionsByKey = { ...state.sessionsByKey };
      delete nextSessionsByKey[sessionKey];

      return {
        sessionsByKey: nextSessionsByKey,
        sessionOrder: state.sessionOrder.filter(
          (currentSessionKey) => currentSessionKey !== sessionKey,
        ),
      };
    });
  },
  setSelectedFilePath(sessionKey, path) {
    set((state) => updateSession(state, sessionKey, () => ({ selectedFilePath: path })));
  },
  setPendingScrollPath(sessionKey, path) {
    set((state) => updateSession(state, sessionKey, () => ({ pendingScrollPath: path })));
  },
  setScrollTop(sessionKey, scrollTop) {
    set((state) => updateSession(state, sessionKey, () => ({ scrollTop })));
  },
  setPendingReviewSummary(sessionKey, summary) {
    set((state) => updateSession(state, sessionKey, () => ({ pendingReviewSummary: summary })));
  },
  setPendingReviewAction(sessionKey, action) {
    set((state) => updateSession(state, sessionKey, () => ({ pendingReviewAction: action })));
  },
  setPendingReviewTypeSelectOpen(sessionKey, open) {
    set((state) =>
      updateSession(state, sessionKey, () => ({ isPendingReviewTypeSelectOpen: open })),
    );
  },
  resetPendingReviewInput(sessionKey) {
    set((state) =>
      updateSession(state, sessionKey, () => ({
        pendingReviewSummary: '',
        isPendingReviewTypeSelectOpen: false,
      })),
    );
  },
  setThreadExpanded(sessionKey, threadKey, expanded) {
    set((state) =>
      updateSession(state, sessionKey, (session) => ({
        threadExpansionByKey: {
          ...session.threadExpansionByKey,
          [threadKey]: expanded,
        },
      })),
    );
  },
  highlightThread(sessionKey, threadKey) {
    set((state) =>
      updateSession(state, sessionKey, (session) => ({
        highlightedThreadKey: threadKey,
        highlightedThreadVersion: session.highlightedThreadVersion + 1,
      })),
    );
  },
  clearNavigationIntent(sessionKey, version) {
    set((state) =>
      updateSession(state, sessionKey, (session) =>
        session.navigationIntentVersion !== version
          ? {}
          : {
              navigationIntent: null,
            },
      ),
    );
  },
  recordHunkExpansion(sessionKey, filePath, hunkIndex, direction, lineCount) {
    set((state) =>
      updateSession(state, sessionKey, (session) => {
        const currentFileExpansions = session.hunkExpansionsByFile[filePath] ?? {};
        const currentRegion = currentFileExpansions[hunkIndex] ?? {
          fromStart: 0,
          fromEnd: 0,
        };
        const nextRegion = { ...currentRegion };

        if (direction === 'up' || direction === 'both') {
          nextRegion.fromStart += lineCount;
        }

        if (direction === 'down' || direction === 'both') {
          nextRegion.fromEnd += lineCount;
        }

        return {
          hunkExpansionsByFile: {
            ...session.hunkExpansionsByFile,
            [filePath]: {
              ...currentFileExpansions,
              [hunkIndex]: nextRegion,
            },
          },
        };
      }),
    );
  },
  requestNavigationIntent(sessionKey, intent) {
    set((state) =>
      updateSession(state, sessionKey, (session) => ({
        navigationIntent: intent,
        navigationIntentVersion: session.navigationIntentVersion + 1,
      })),
    );
  },
  selectFile(sessionKey, path) {
    set((state) =>
      updateSession(state, sessionKey, () => ({
        selectedFilePath: path,
        pendingScrollPath: path,
      })),
    );
  },
  resetNavigation(sessionKey) {
    set((state) =>
      updateSession(state, sessionKey, () => ({
        selectedFilePath: null,
        pendingScrollPath: null,
      })),
    );
  },
  resetProviderExpansion(scopeKey) {
    set((state) =>
      state.providerExpansionScopeKey === scopeKey
        ? state
        : {
            providerExpansionScopeKey: scopeKey,
            hydratedProviderDiffsByPath: {},
            providerExpansionInFlightByPath: {},
            providerExpansionScrollAnchor: null,
          },
    );
  },
  setHydratedProviderDiff(scopeKey, filePath, fileDiff) {
    set((state) => {
      const isCurrentScope = state.providerExpansionScopeKey === scopeKey;
      const currentDiffs = isCurrentScope ? state.hydratedProviderDiffsByPath : {};

      return {
        providerExpansionScopeKey: scopeKey,
        hydratedProviderDiffsByPath: {
          ...currentDiffs,
          [filePath]: fileDiff,
        },
        providerExpansionInFlightByPath: isCurrentScope
          ? state.providerExpansionInFlightByPath
          : {},
        providerExpansionScrollAnchor: isCurrentScope ? state.providerExpansionScrollAnchor : null,
      };
    });
  },
  setProviderExpansionInFlight(scopeKey, filePath, isInFlight) {
    set((state) => {
      const isCurrentScope = state.providerExpansionScopeKey === scopeKey;
      const currentInFlight = isCurrentScope ? state.providerExpansionInFlightByPath : {};

      if (Boolean(currentInFlight[filePath]) === isInFlight) {
        return isCurrentScope
          ? state
          : {
              providerExpansionScopeKey: scopeKey,
              hydratedProviderDiffsByPath: {},
              providerExpansionInFlightByPath: {},
              providerExpansionScrollAnchor: null,
            };
      }

      if (isInFlight) {
        return {
          providerExpansionScopeKey: scopeKey,
          hydratedProviderDiffsByPath: isCurrentScope ? state.hydratedProviderDiffsByPath : {},
          providerExpansionInFlightByPath: {
            ...currentInFlight,
            [filePath]: true,
          },
          providerExpansionScrollAnchor: isCurrentScope
            ? state.providerExpansionScrollAnchor
            : null,
        };
      }

      const nextInFlight = { ...currentInFlight };
      delete nextInFlight[filePath];
      return {
        providerExpansionScopeKey: scopeKey,
        hydratedProviderDiffsByPath: isCurrentScope ? state.hydratedProviderDiffsByPath : {},
        providerExpansionInFlightByPath: nextInFlight,
        providerExpansionScrollAnchor: isCurrentScope ? state.providerExpansionScrollAnchor : null,
      };
    });
  },
  setProviderExpansionScrollAnchor(anchor) {
    set({ providerExpansionScrollAnchor: anchor });
  },
  clearProviderExpansionScrollAnchor(filePath) {
    set((state) =>
      state.providerExpansionScrollAnchor?.filePath === filePath
        ? { providerExpansionScrollAnchor: null }
        : state,
    );
  },
  async loadProviderDiffForExpansion(request) {
    const state = get();
    if (
      state.providerExpansionScopeKey === request.scopeKey &&
      state.providerExpansionInFlightByPath[request.filePath]
    ) {
      return;
    }

    get().setProviderExpansionInFlight(request.scopeKey, request.filePath, true);
    get().setProviderExpansionScrollAnchor({
      filePath: request.filePath,
      hunkIndex: Math.min(request.expansion.hunkIndex, request.sourceFileDiff.hunks.length),
      top: request.anchorTop,
    });

    try {
      const fileContents = await request.loadFileContents();
      if (get().providerExpansionScopeKey !== request.scopeKey) {
        return;
      }

      const hydratedFileDiff = hydrateProviderFileDiff(request.sourceFileDiff, fileContents);
      const hunkIndex = Math.min(request.expansion.hunkIndex, hydratedFileDiff.hunks.length);
      get().setHydratedProviderDiff(request.scopeKey, request.filePath, hydratedFileDiff);
      request.onSuccess({
        direction: request.expansion.direction,
        filePath: request.filePath,
        hunkIndex,
        lineCount: request.expansion.lineCount,
      });
    } catch (error) {
      if (get().providerExpansionScopeKey === request.scopeKey) {
        get().clearProviderExpansionScrollAnchor(request.filePath);
        request.onError(error);
      }
    } finally {
      if (get().providerExpansionScopeKey === request.scopeKey) {
        get().setProviderExpansionInFlight(request.scopeKey, request.filePath, false);
      }
    }
  },
}));

export { getPatchViewerSessionState, usePatchViewerStore };
export type {
  HunkExpansionDirection,
  HunkExpansionRegion,
  PatchViewerNavigationIntent,
  PatchViewerSessionState,
  ProviderExpansionLoadRequest,
  ProviderExpansionScrollAnchor,
};
