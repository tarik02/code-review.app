import {
  FloatingPortal,
  autoUpdate,
  offset,
  size,
  useFloating,
} from "@floating-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReviewComment, ReviewThread } from "../../lib/review-threads";
import { reviewEditorSettingsQueryOptions } from "../../queries/forge";
import {
  getReviewCommentEditorSessionState,
  type ReviewCommentEditorState,
  useReviewCommentEditorStore,
} from "../../stores/review-comment-editor-store";
import { CommentMarkdown } from "./comment-markdown";
import {
  ReviewCommentEditor,
  type CommentEditorTarget,
  type ReviewCommentEditorProps,
} from "./review-comment-editor";

const INITIAL_FLOATING_EDITOR_HEIGHT = 180;

type ReviewThreadCardProps = {
  thread: ReviewThread;
  compact?: boolean;
  slim?: boolean;
  viewerLogin?: string | null;
  editorPortalRootId?: string;
  reviewEditorSessionKey?: string | null;
  onReplyToThread?: (thread: ReviewThread, body: string) => Promise<void>;
  onEditComment?: (comment: ReviewComment, body: string) => Promise<void>;
  onClick?: () => void;
  containerRef?: (node: HTMLDivElement | null) => void;
};

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
    .format(timestamp)
    .toUpperCase();
}

function formatThreadLineLabel(thread: ReviewThread) {
  if (thread.line === null && thread.startLine === null) {
    return "File comment";
  }

  const startLine = thread.startLine ?? thread.line;
  const endLine = thread.line ?? thread.startLine;

  if (startLine === null || endLine === null) {
    return "File comment";
  }

  if (startLine === endLine) {
    return `Line ${startLine}`;
  }

  const minLine = Math.min(startLine, endLine);
  const maxLine = Math.max(startLine, endLine);
  return `Lines ${minLine}-${maxLine}`;
}

function getThreadEditorTarget(thread: ReviewThread): CommentEditorTarget {
  if (thread.line === null || thread.side === null) {
    return {
      type: "file",
      path: thread.path,
    };
  }

  return {
    type: "line",
    path: thread.path,
    line: thread.line,
    side: thread.side,
    startLine: thread.startLine,
    startSide: thread.startSide,
  };
}

function CommentAvatar({ comment }: { comment: ReviewComment }) {
  const initials = comment.authorLogin.slice(0, 1).toUpperCase();

  if (!comment.authorAvatarUrl) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[11px] font-semibold text-ink-700">
        {initials}
      </div>
    );
  }

  return (
    <img
      alt={comment.authorLogin}
      className="size-8 shrink-0 rounded-full border border-ink-200 object-cover"
      src={comment.authorAvatarUrl}
    />
  );
}

function FloatingReviewCommentEditor({
  portalRootId,
  ...editorProps
}: ReviewCommentEditorProps & { portalRootId?: string }) {
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const [hasReference, setHasReference] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const { floatingStyles, refs } = useFloating({
    placement: "bottom-start",
    strategy: "absolute",
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(({ rects }) => ({
        mainAxis: -rects.reference.height,
      })),
      size({
        apply({ elements, rects }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
          });

          const nextHeight = Math.ceil(
            elements.floating.getBoundingClientRect().height,
          );
          if (spacerRef.current && nextHeight > 0) {
            spacerRef.current.style.height = `${nextHeight}px`;
          }
        },
      }),
    ],
  });
  const setReference = useCallback(
    (node: HTMLDivElement | null) => {
      spacerRef.current = node;
      refs.setReference(node);
      setHasReference(node !== null);
    },
    [refs],
  );
  const setFloating = useCallback(
    (node: HTMLDivElement | null) => {
      refs.setFloating(node);
    },
    [refs],
  );

  useLayoutEffect(() => {
    setPortalRoot(portalRootId ? document.getElementById(portalRootId) : null);
  }, [portalRootId]);

  const shouldRenderFloating =
    hasReference && (!portalRootId || portalRoot !== null);
  const floatingEditor = shouldRenderFloating ? (
    <div
      ref={setFloating}
      className="pointer-events-auto z-50 font-sans"
      style={floatingStyles}
    >
      <ReviewCommentEditor {...editorProps} />
    </div>
  ) : null;

  return (
    <>
      <div
        ref={setReference}
        style={{ height: INITIAL_FLOATING_EDITOR_HEIGHT }}
      />
      {portalRootId ? (
        <FloatingPortal root={portalRoot}>{floatingEditor}</FloatingPortal>
      ) : (
        <FloatingPortal>{floatingEditor}</FloatingPortal>
      )}
    </>
  );
}

function ReviewThreadCard({
  thread,
  compact = false,
  slim = false,
  viewerLogin = null,
  editorPortalRootId,
  reviewEditorSessionKey = null,
  onReplyToThread,
  onEditComment,
  onClick,
  containerRef,
}: ReviewThreadCardProps) {
  const rootComment =
    thread.comments.find((comment) => comment.replyToId === null) ??
    thread.comments[0] ??
    null;
  const editorTarget = getThreadEditorTarget(thread);
  const reviewEditorSession = useReviewCommentEditorStore((state) =>
    getReviewCommentEditorSessionState(state, reviewEditorSessionKey),
  );
  const threadEditors = useMemo(
    () =>
      reviewEditorSession.editorOrder
        .map((editorId) => reviewEditorSession.editorsById[editorId])
        .filter(
          (editor): editor is ReviewCommentEditorState =>
            editor != null && editor.threadId === thread.id,
        ),
    [reviewEditorSession, thread.id],
  );
  const openReplyEditor = useReviewCommentEditorStore(
    (state) => state.openReplyEditor,
  );
  const openEditEditor = useReviewCommentEditorStore(
    (state) => state.openEditEditor,
  );
  const setEditorBody = useReviewCommentEditorStore(
    (state) => state.setEditorBody,
  );
  const setEditorError = useReviewCommentEditorStore(
    (state) => state.setEditorError,
  );
  const setEditorCursorPosition = useReviewCommentEditorStore(
    (state) => state.setEditorCursorPosition,
  );
  const setEditorSubmitting = useReviewCommentEditorStore(
    (state) => state.setEditorSubmitting,
  );
  const closeEditor = useReviewCommentEditorStore(
    (state) => state.closeEditor,
  );
  const canCreateEditor =
    reviewEditorSessionKey != null &&
    (onReplyToThread != null || onEditComment != null);
  const reviewEditorSettingsQuery = useQuery({
    ...reviewEditorSettingsQueryOptions(),
    enabled: canCreateEditor,
  });
  const defaultReviewEditorMode =
    reviewEditorSettingsQuery.data?.defaultMode ?? "rich-text";
  const replyEditor =
    thread.id.length > 0
      ? threadEditors.find((editor) => editor.kind === "reply")
      : undefined;

  if (slim) {
    const threadLine = thread.startLine ?? thread.line;
    const locationLabel =
      threadLine === null
        ? `${thread.path} - File comment`
        : `${thread.path}:${threadLine}`;
    const summaryBody = (rootComment?.body ?? "")
      .replace(/\s+/g, " ")
      .trim();

    const content = (
      <>
        {rootComment ? (
          <CommentAvatar comment={rootComment} />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[11px] font-semibold text-ink-700">
            ?
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="min-w-0 truncate text-sm text-ink-700">
            {summaryBody || "(no comment body)"}
          </p>
          <p className="mt-1 text-xs text-ink-500">{locationLabel}</p>
        </div>
      </>
    );

    const baseClassName =
      "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left";

    return onClick ? (
      <button
        className={`${baseClassName} transition hover:bg-canvasDark focus-visible:bg-surface`}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    ) : (
      <div className={baseClassName}>{content}</div>
    );
  }

  async function handleReplySubmit(editorId: string, body: string) {
    if (!rootComment || !onReplyToThread) {
      return;
    }

    setEditorSubmitting(reviewEditorSessionKey, editorId, true);
    setEditorError(reviewEditorSessionKey, editorId, "");

    try {
      await onReplyToThread(thread, body);
      closeEditor(reviewEditorSessionKey, editorId);
    } catch (error) {
      setEditorError(
        reviewEditorSessionKey,
        editorId,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (
        getReviewCommentEditorSessionState(
          useReviewCommentEditorStore.getState(),
          reviewEditorSessionKey,
        ).editorsById[editorId]
      ) {
        setEditorSubmitting(reviewEditorSessionKey, editorId, false);
      }
    }
  }

  async function handleEditSubmit(
    editorId: string,
    comment: ReviewComment,
    body: string,
  ) {
    if (!onEditComment) {
      return;
    }

    setEditorSubmitting(reviewEditorSessionKey, editorId, true);
    setEditorError(reviewEditorSessionKey, editorId, "");

    try {
      await onEditComment(comment, body);
      closeEditor(reviewEditorSessionKey, editorId);
    } catch (error) {
      setEditorError(
        reviewEditorSessionKey,
        editorId,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (
        getReviewCommentEditorSessionState(
          useReviewCommentEditorStore.getState(),
          reviewEditorSessionKey,
        ).editorsById[editorId]
      ) {
        setEditorSubmitting(reviewEditorSessionKey, editorId, false);
      }
    }
  }

  return (
    <div
      className="rounded-lg border border-ink-200 bg-canvas p-3 text-sm text-ink-800 shadow-xs"
      ref={containerRef}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <span className="font-sans font-medium text-ink-900">
          {formatThreadLineLabel(thread)}
        </span>
        {thread.isResolved ? (
          <span className="rounded-full bg-canvas px-2 py-0.5 font-sans text-ink-700">
            Resolved
          </span>
        ) : null}
        {thread.isOutdated ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-sans text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            Outdated
          </span>
        ) : null}
        <span className="font-sans">{thread.comments.length} comments</span>
      </div>

      <div className="flex flex-col gap-3">
        {thread.comments.map((comment) => {
          const editEditor = threadEditors.find(
            (editor) =>
              editor.kind === "edit" && editor.commentId === comment.id,
          );
          const canEdit =
            viewerLogin != null &&
            viewerLogin === comment.authorLogin &&
            comment.id.length > 0 &&
            thread.id.length > 0 &&
            reviewEditorSessionKey != null &&
            onEditComment != null;

          return (
            <div
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-3"
              key={comment.id}
            >
              <CommentAvatar comment={comment} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <span className="font-sans font-medium text-ink-900">
                    {comment.authorLogin}
                  </span>
                  <span>{formatTimestamp(comment.createdAt)}</span>
                  {!compact && comment.url ? (
                    <a
                      className="text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
                      href={comment.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open
                    </a>
                  ) : null}
                  {canEdit ? (
                    <button
                      className="text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
                      onClick={() => {
                        openEditEditor(
                          reviewEditorSessionKey,
                          thread.id,
                          comment.id,
                          comment.body,
                        );
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                  ) : null}
                </div>
                <div className="mt-1 min-w-0">
                  {editEditor ? (
                    <FloatingReviewCommentEditor
                      portalRootId={editorPortalRootId}
                      cursorPosition={editEditor.cursorPosition}
                      defaultMode={defaultReviewEditorMode}
                      error={editEditor.error}
                      initialValue={comment.body}
                      isPending={editEditor.isSubmitting}
                      provider={thread.provider}
                      submitLabel="Save"
                      target={editorTarget}
                      value={editEditor.body}
                      onCancel={() =>
                        closeEditor(reviewEditorSessionKey, editEditor.id)
                      }
                      onChange={(body) =>
                        setEditorBody(
                          reviewEditorSessionKey,
                          editEditor.id,
                          body,
                        )
                      }
                      onCursorPositionChange={(cursorPosition) =>
                        setEditorCursorPosition(
                          reviewEditorSessionKey,
                          editEditor.id,
                          cursorPosition ?? null,
                        )
                      }
                      onSubmit={(body) =>
                        handleEditSubmit(editEditor.id, comment, body)
                      }
                    />
                  ) : (
                    <CommentMarkdown body={comment.body} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {rootComment &&
      onReplyToThread &&
      thread.id.length > 0 &&
      reviewEditorSessionKey != null ? (
        <div className="mt-3 border-t border-ink-200 pt-3">
          {replyEditor ? (
            <FloatingReviewCommentEditor
              portalRootId={editorPortalRootId}
              cursorPosition={replyEditor.cursorPosition}
              defaultMode={defaultReviewEditorMode}
              error={replyEditor.error}
              isPending={replyEditor.isSubmitting}
              provider={thread.provider}
              submitLabel="Reply"
              target={editorTarget}
              value={replyEditor.body}
              onCancel={() =>
                closeEditor(reviewEditorSessionKey, replyEditor.id)
              }
              onChange={(body) =>
                setEditorBody(reviewEditorSessionKey, replyEditor.id, body)
              }
              onCursorPositionChange={(cursorPosition) =>
                setEditorCursorPosition(
                  reviewEditorSessionKey,
                  replyEditor.id,
                  cursorPosition ?? null,
                )
              }
              onSubmit={(body) => handleReplySubmit(replyEditor.id, body)}
              placeholder="Reply to this thread"
            />
          ) : (
            <button
              className="font-sans text-xs font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
              onClick={() => {
                openReplyEditor(reviewEditorSessionKey, thread.id);
              }}
              type="button"
            >
              Reply
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export { ReviewThreadCard };
export type { ReviewThreadCardProps };
