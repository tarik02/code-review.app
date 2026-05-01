import { create } from 'zustand';
import type { PendingReviewSubmitAction } from '../types/forge';

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

type PatchViewerStore = {
  sessionsByKey: Record<string, PatchViewerSessionState | undefined>;
  sessionOrder: string[];
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
  const nextSession = {
    ...currentSession,
    ...update(currentSession),
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
}));

export { getPatchViewerSessionState, usePatchViewerStore };
export type {
  HunkExpansionDirection,
  HunkExpansionRegion,
  PatchViewerNavigationIntent,
  PatchViewerSessionState,
};
