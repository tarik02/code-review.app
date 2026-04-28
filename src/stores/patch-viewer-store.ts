import { create } from "zustand";
import type { ReviewCommentSide } from "../types/forge";

const MAX_PATCH_VIEWER_SESSIONS = 20;

type DraftReviewCommentTarget =
  | {
      type: "file";
      path: string;
    }
  | {
      type: "line";
      path: string;
      line: number;
      side: ReviewCommentSide;
      startLine: number | null;
      startSide: ReviewCommentSide | null;
    };

type PatchViewerSessionState = {
  draftCommentTarget: DraftReviewCommentTarget | null;
  draftCommentError: string;
  selectedFilePath: string | null;
  pendingScrollPath: string | null;
};

type PatchViewerStore = {
  sessionsByKey: Record<string, PatchViewerSessionState | undefined>;
  sessionOrder: string[];
  ensureSession: (sessionKey: string | null) => void;
  resetSession: (sessionKey: string | null) => void;
  removeSession: (sessionKey: string | null) => void;
  setDraftCommentTarget: (
    sessionKey: string | null,
    target: DraftReviewCommentTarget | null,
  ) => void;
  setDraftCommentError: (sessionKey: string | null, error: string) => void;
  clearDraftComment: (sessionKey: string | null) => void;
  setSelectedFilePath: (sessionKey: string | null, path: string | null) => void;
  setPendingScrollPath: (
    sessionKey: string | null,
    path: string | null,
  ) => void;
  selectFile: (sessionKey: string | null, path: string) => void;
  resetNavigation: (sessionKey: string | null) => void;
};

function createPatchViewerSessionState(): PatchViewerSessionState {
  return {
    draftCommentTarget: null,
    draftCommentError: "",
    selectedFilePath: null,
    pendingScrollPath: null,
  };
}

const emptyPatchViewerSessionState = createPatchViewerSessionState();

function getPatchViewerSessionState(
  state: Pick<PatchViewerStore, "sessionsByKey">,
  sessionKey: string | null,
) {
  if (!sessionKey) {
    return emptyPatchViewerSessionState;
  }

  return state.sessionsByKey[sessionKey] ?? emptyPatchViewerSessionState;
}

function touchSessionKey(sessionOrder: string[], sessionKey: string) {
  return [
    ...sessionOrder.filter(
      (currentSessionKey) => currentSessionKey !== sessionKey,
    ),
    sessionKey,
  ];
}

function pruneSessions(
  sessionsByKey: PatchViewerStore["sessionsByKey"],
  sessionOrder: string[],
) {
  if (sessionOrder.length <= MAX_PATCH_VIEWER_SESSIONS) {
    return { sessionsByKey, sessionOrder };
  }

  const nextSessionOrder = sessionOrder.slice(-MAX_PATCH_VIEWER_SESSIONS);
  const retainedSessionKeys = new Set(nextSessionOrder);
  const nextSessionsByKey: PatchViewerStore["sessionsByKey"] = {};

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
  update: (
    session: PatchViewerSessionState,
  ) => Partial<PatchViewerSessionState>,
) {
  if (!sessionKey) {
    return state;
  }

  const currentSession =
    state.sessionsByKey[sessionKey] ?? createPatchViewerSessionState();
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

    set((state) =>
      updateSession(state, sessionKey, () => createPatchViewerSessionState()),
    );
  },
  resetSession(sessionKey) {
    if (!sessionKey) {
      return;
    }

    set((state) =>
      updateSession(state, sessionKey, () => createPatchViewerSessionState()),
    );
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
  setDraftCommentTarget(sessionKey, target) {
    set((state) =>
      updateSession(state, sessionKey, () => ({ draftCommentTarget: target })),
    );
  },
  setDraftCommentError(sessionKey, error) {
    set((state) =>
      updateSession(state, sessionKey, () => ({ draftCommentError: error })),
    );
  },
  clearDraftComment(sessionKey) {
    set((state) =>
      updateSession(state, sessionKey, () => ({
        draftCommentTarget: null,
        draftCommentError: "",
      })),
    );
  },
  setSelectedFilePath(sessionKey, path) {
    set((state) =>
      updateSession(state, sessionKey, () => ({ selectedFilePath: path })),
    );
  },
  setPendingScrollPath(sessionKey, path) {
    set((state) =>
      updateSession(state, sessionKey, () => ({ pendingScrollPath: path })),
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
  DraftReviewCommentTarget,
  PatchViewerSessionState,
};
