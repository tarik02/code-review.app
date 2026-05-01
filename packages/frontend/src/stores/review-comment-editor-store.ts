import { create } from 'zustand';
import { normalizePath } from '../lib/review-threads';
import type { PrFileChangeType, ReviewCommentSide } from '../types/forge';

type DraftReviewCommentTarget =
  | {
      type: 'global';
    }
  | {
      type: 'file';
      path: string;
      oldPath: string;
      newPath: string;
      changeType: PrFileChangeType;
    }
  | {
      type: 'line';
      path: string;
      line: number;
      side: ReviewCommentSide;
      oldLine: number | null;
      newLine: number | null;
      startLine: number | null;
      startSide: ReviewCommentSide | null;
      startOldLine: number | null;
      startNewLine: number | null;
    };

type ReviewCommentEditorKind = 'new' | 'reply' | 'edit';

type ReviewCommentEditorCursorPosition = {
  anchorOffset: number;
  anchorPath: number[];
  focusOffset: number;
  focusPath: number[];
};

type ReviewCommentEditorState = {
  id: string;
  kind: ReviewCommentEditorKind;
  body: string;
  cursorPosition?: ReviewCommentEditorCursorPosition | null;
  error: string;
  isSubmitting: boolean;
  target?: DraftReviewCommentTarget;
  threadId?: string;
  commentId?: string;
};

type ReviewCommentEditorSessionState = {
  editorsById: Record<string, ReviewCommentEditorState | undefined>;
  editorOrder: string[];
};

type ReviewCommentEditorStore = {
  sessionsByKey: Record<string, ReviewCommentEditorSessionState | undefined>;
  sessionOrder: string[];
  openNewEditor: (sessionKey: string | null, target: DraftReviewCommentTarget) => void;
  openReplyEditor: (sessionKey: string | null, threadId: string) => void;
  openEditEditor: (
    sessionKey: string | null,
    threadId: string,
    commentId: string,
    initialBody: string,
  ) => void;
  setEditorBody: (sessionKey: string | null, editorId: string, body: string) => void;
  setEditorError: (sessionKey: string | null, editorId: string, error: string) => void;
  setEditorCursorPosition: (
    sessionKey: string | null,
    editorId: string,
    cursorPosition: ReviewCommentEditorCursorPosition | null,
  ) => void;
  setEditorSubmitting: (sessionKey: string | null, editorId: string, isSubmitting: boolean) => void;
  closeEditor: (sessionKey: string | null, editorId: string) => void;
};

const MAX_REVIEW_COMMENT_EDITOR_SESSIONS = 20;

const emptyReviewCommentEditorSessionState: ReviewCommentEditorSessionState = {
  editorsById: {},
  editorOrder: [],
};

function getNewEditorId(target: DraftReviewCommentTarget) {
  if (target.type === 'global') {
    return 'new:global';
  }

  const normalizedPath = normalizePath(target.path);

  if (target.type === 'file') {
    return `new:file:${normalizedPath}`;
  }

  return `new:line:${normalizedPath}:${target.side}:${target.line}:${target.startSide ?? ''}:${target.startLine ?? ''}`;
}

function getReplyEditorId(threadId: string) {
  return `reply:${threadId}`;
}

function getEditEditorId(commentId: string) {
  return `edit:${commentId}`;
}

function getReviewCommentEditorSessionState(
  state: Pick<ReviewCommentEditorStore, 'sessionsByKey'>,
  sessionKey: string | null,
) {
  if (!sessionKey) {
    return emptyReviewCommentEditorSessionState;
  }

  return state.sessionsByKey[sessionKey] ?? emptyReviewCommentEditorSessionState;
}

function getSessionEditors(
  state: Pick<ReviewCommentEditorStore, 'sessionsByKey'>,
  sessionKey: string | null,
) {
  const session = getReviewCommentEditorSessionState(state, sessionKey);
  return session.editorOrder
    .map((editorId) => session.editorsById[editorId])
    .filter((editor): editor is ReviewCommentEditorState => editor != null);
}

function touchSessionKey(sessionOrder: string[], sessionKey: string) {
  return [
    ...sessionOrder.filter((currentSessionKey) => currentSessionKey !== sessionKey),
    sessionKey,
  ];
}

function touchEditorId(editorOrder: string[], editorId: string) {
  return [...editorOrder.filter((currentEditorId) => currentEditorId !== editorId), editorId];
}

function pruneSessions(
  sessionsByKey: ReviewCommentEditorStore['sessionsByKey'],
  sessionOrder: string[],
) {
  if (sessionOrder.length <= MAX_REVIEW_COMMENT_EDITOR_SESSIONS) {
    return { sessionsByKey, sessionOrder };
  }

  const nextSessionOrder = sessionOrder.slice(-MAX_REVIEW_COMMENT_EDITOR_SESSIONS);
  const retainedSessionKeys = new Set(nextSessionOrder);
  const nextSessionsByKey: ReviewCommentEditorStore['sessionsByKey'] = {};

  for (const sessionKey of retainedSessionKeys) {
    nextSessionsByKey[sessionKey] = sessionsByKey[sessionKey];
  }

  return {
    sessionsByKey: nextSessionsByKey,
    sessionOrder: nextSessionOrder,
  };
}

function updateSession(
  state: ReviewCommentEditorStore,
  sessionKey: string | null,
  update: (session: ReviewCommentEditorSessionState) => ReviewCommentEditorSessionState,
) {
  if (!sessionKey) {
    return state;
  }

  const currentSession = state.sessionsByKey[sessionKey] ?? emptyReviewCommentEditorSessionState;
  const nextSession = update(currentSession);
  if (nextSession === currentSession) {
    return state;
  }

  const nextSessionOrder = touchSessionKey(state.sessionOrder, sessionKey);

  return pruneSessions(
    {
      ...state.sessionsByKey,
      [sessionKey]: nextSession,
    },
    nextSessionOrder,
  );
}

function updateEditor(
  session: ReviewCommentEditorSessionState,
  editorId: string,
  update: (editor: ReviewCommentEditorState) => Partial<ReviewCommentEditorState>,
) {
  const editor = session.editorsById[editorId];
  if (!editor) {
    return session;
  }

  const editorUpdate = update(editor);
  if (Object.keys(editorUpdate).length === 0) {
    return session;
  }

  return {
    ...session,
    editorsById: {
      ...session.editorsById,
      [editorId]: {
        ...editor,
        ...editorUpdate,
      },
    },
  };
}

function areCursorPositionsEqual(
  first: ReviewCommentEditorCursorPosition | null | undefined,
  second: ReviewCommentEditorCursorPosition | null | undefined,
) {
  if (first === second) {
    return true;
  }

  if (!first || !second) {
    return false;
  }

  return (
    first.anchorOffset === second.anchorOffset &&
    first.focusOffset === second.focusOffset &&
    first.anchorPath.length === second.anchorPath.length &&
    first.focusPath.length === second.focusPath.length &&
    first.anchorPath.every((value, index) => value === second.anchorPath[index]) &&
    first.focusPath.every((value, index) => value === second.focusPath[index])
  );
}

const useReviewCommentEditorStore = create<ReviewCommentEditorStore>()((set) => ({
  sessionsByKey: {},
  sessionOrder: [],
  openNewEditor(sessionKey, target) {
    set((state) =>
      updateSession(state, sessionKey, (session) => {
        const id = getNewEditorId(target);
        const currentEditor = session.editorsById[id];

        return {
          editorsById: {
            ...session.editorsById,
            [id]: currentEditor ?? {
              id,
              kind: 'new',
              body: '',
              error: '',
              isSubmitting: false,
              target,
            },
          },
          editorOrder: touchEditorId(session.editorOrder, id),
        };
      }),
    );
  },
  openReplyEditor(sessionKey, threadId) {
    set((state) =>
      updateSession(state, sessionKey, (session) => {
        const id = getReplyEditorId(threadId);
        const currentEditor = session.editorsById[id];

        return {
          editorsById: {
            ...session.editorsById,
            [id]: currentEditor ?? {
              id,
              kind: 'reply',
              body: '',
              error: '',
              isSubmitting: false,
              threadId,
            },
          },
          editorOrder: touchEditorId(session.editorOrder, id),
        };
      }),
    );
  },
  openEditEditor(sessionKey, threadId, commentId, initialBody) {
    set((state) =>
      updateSession(state, sessionKey, (session) => {
        const id = getEditEditorId(commentId);
        const currentEditor = session.editorsById[id];

        return {
          editorsById: {
            ...session.editorsById,
            [id]: currentEditor ?? {
              id,
              kind: 'edit',
              body: initialBody,
              error: '',
              isSubmitting: false,
              threadId,
              commentId,
            },
          },
          editorOrder: touchEditorId(session.editorOrder, id),
        };
      }),
    );
  },
  setEditorBody(sessionKey, editorId, body) {
    set((state) =>
      updateSession(state, sessionKey, (session) =>
        updateEditor(session, editorId, () => ({ body })),
      ),
    );
  },
  setEditorError(sessionKey, editorId, error) {
    set((state) =>
      updateSession(state, sessionKey, (session) =>
        updateEditor(session, editorId, () => ({ error })),
      ),
    );
  },
  setEditorCursorPosition(sessionKey, editorId, cursorPosition) {
    set((state) =>
      updateSession(state, sessionKey, (session) =>
        updateEditor(session, editorId, (editor) =>
          areCursorPositionsEqual(editor.cursorPosition, cursorPosition) ? {} : { cursorPosition },
        ),
      ),
    );
  },
  setEditorSubmitting(sessionKey, editorId, isSubmitting) {
    set((state) =>
      updateSession(state, sessionKey, (session) =>
        updateEditor(session, editorId, () => ({ isSubmitting })),
      ),
    );
  },
  closeEditor(sessionKey, editorId) {
    set((state) =>
      updateSession(state, sessionKey, (session) => {
        const nextEditorsById = { ...session.editorsById };
        delete nextEditorsById[editorId];

        return {
          editorsById: nextEditorsById,
          editorOrder: session.editorOrder.filter(
            (currentEditorId) => currentEditorId !== editorId,
          ),
        };
      }),
    );
  },
}));

export {
  getEditEditorId,
  getNewEditorId,
  getReplyEditorId,
  getReviewCommentEditorSessionState,
  getSessionEditors,
  useReviewCommentEditorStore,
};
export type {
  DraftReviewCommentTarget,
  ReviewCommentEditorCursorPosition,
  ReviewCommentEditorKind,
  ReviewCommentEditorSessionState,
  ReviewCommentEditorState,
  ReviewCommentEditorStore,
};
