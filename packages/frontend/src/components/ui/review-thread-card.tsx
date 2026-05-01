import { FloatingPortal, autoUpdate, offset, size, useFloating } from '@floating-ui/react';
import { useQuery } from '@tanstack/react-query';
import { useInView } from 'react-intersection-observer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getReviewThreadRefKey,
  isGlobalReviewThread,
  isReviewEventThread,
  type ReviewComment,
  type ReviewThread,
} from '../../lib/review-threads';
import { getCommentPreviewText } from '../../lib/comment-preview';
import { reviewEditorSettingsQueryOptions } from '../../queries/forge';
import {
  getReviewCommentEditorSessionState,
  type ReviewCommentEditorState,
  useReviewCommentEditorStore,
} from '../../stores/review-comment-editor-store';
import { getPatchViewerSessionState, usePatchViewerStore } from '../../stores/patch-viewer-store';
import { CommentMarkdown } from './comment-markdown';
import {
  ReviewCommentEditor,
  type CommentEditorTarget,
  type ReviewCommentEditorProps,
} from './review-comment-editor';

const INITIAL_FLOATING_EDITOR_HEIGHT = 180;
const COMMENT_DEFER_ROOT_MARGIN = '600px 0px';

type ReviewThreadCardProps = {
  thread: ReviewThread;
  compact?: boolean;
  slim?: boolean;
  defaultCollapsed?: boolean;
  deletingCommentIds?: ReadonlySet<string>;
  patchViewerSessionKey?: string | null;
  resolvingThreadId?: string | null;
  viewerLogin?: string | null;
  editorPortalRootId?: string;
  reviewEditorSessionKey?: string | null;
  onReplyToThread?: (thread: ReviewThread, body: string) => Promise<void>;
  onReplyToThreadNow?: (thread: ReviewThread, body: string) => Promise<void>;
  onSetThreadResolved?: (thread: ReviewThread, isResolved: boolean) => Promise<void>;
  onEditComment?: (comment: ReviewComment, body: string) => Promise<void>;
  onDeleteComment?: (thread: ReviewThread, comment: ReviewComment) => Promise<void>;
  onDeletePendingComment?: (comment: ReviewComment) => Promise<void>;
  onClick?: () => void;
  containerRef?: (node: HTMLDivElement | null) => void;
};

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
    .format(timestamp)
    .toUpperCase();
}

function formatThreadLineLabel(thread: ReviewThread) {
  if (isGlobalReviewThread(thread)) {
    return 'Global comment';
  }

  if (thread.line === null && thread.startLine === null) {
    return 'File comment';
  }

  const startLine = thread.startLine ?? thread.line;
  const endLine = thread.line ?? thread.startLine;

  if (startLine === null || endLine === null) {
    return 'File comment';
  }

  if (startLine === endLine) {
    return `Line ${startLine}`;
  }

  const minLine = Math.min(startLine, endLine);
  const maxLine = Math.max(startLine, endLine);
  return `Lines ${minLine}-${maxLine}`;
}

function formatRelativeTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;

  const diffMs = timestamp - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (Math.abs(diffSeconds) < 60) {
    return formatter.format(diffSeconds, 'second');
  }

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, 'day');
}

function getReviewEventLabel(thread: ReviewThread) {
  switch (thread.eventType) {
    case 'approved':
      return 'approved';
    case 'requested_changes':
      return 'requested changes';
    case 'commented':
      return 'left review comments';
    default:
      return '';
  }
}

function getReviewEventTone(thread: ReviewThread) {
  switch (thread.eventType) {
    case 'approved':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'requested_changes':
      return 'text-amber-700 dark:text-amber-300';
    case 'commented':
      return 'text-sky-700 dark:text-sky-300';
    default:
      return 'text-ink-900';
  }
}

function getThreadEditorTarget(thread: ReviewThread): CommentEditorTarget {
  if (isGlobalReviewThread(thread)) {
    return {
      type: 'global',
    };
  }

  if (thread.line === null || thread.side === null) {
    return {
      type: 'file',
      path: thread.path,
    };
  }

  return {
    type: 'line',
    path: thread.path,
    line: thread.line,
    side: thread.side,
    startLine: thread.startLine,
    startSide: thread.startSide,
  };
}

function CommentAvatar({
  comment,
  size = 'md',
}: {
  comment: ReviewComment;
  size?: 'sm' | 'md';
}) {
  const initials = comment.authorLogin.slice(0, 1).toUpperCase();
  const avatarClassName =
    size === 'sm'
      ? 'size-6 text-[10px]'
      : 'size-8 text-[11px]';
  const imageClassName =
    size === 'sm'
      ? 'size-6 rounded-full border border-ink-200 object-cover'
      : 'size-8 rounded-full border border-ink-200 object-cover';

  if (!comment.authorAvatarUrl) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full bg-ink-200 font-semibold text-ink-700 ${avatarClassName}`}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      alt={comment.authorLogin}
      className={`shrink-0 ${imageClassName}`}
      src={comment.authorAvatarUrl}
    />
  );
}

function FloatingReviewCommentEditor({
  portalRootId,
  ...editorProps
}: ReviewCommentEditorProps & { portalRootId?: string }) {
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const floatingNodeRef = useRef<HTMLDivElement | null>(null);
  const [hasReference, setHasReference] = useState(false);
  const portalRoot =
    portalRootId && typeof document !== 'undefined' ? document.getElementById(portalRootId) : null;
  const { floatingStyles, refs } = useFloating({
    placement: 'bottom-start',
    strategy: 'absolute',
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
        },
      }),
    ],
  });
  useEffect(() => {
    const floatingNode = floatingNodeRef.current;
    if (!floatingNode || typeof ResizeObserver === 'undefined') {
      return;
    }

    const syncSpacerHeight = () => {
      if (!spacerRef.current) {
        return;
      }

      const nextHeight = Math.ceil(floatingNode.getBoundingClientRect().height);
      if (nextHeight > 0) {
        spacerRef.current.style.height = `${nextHeight}px`;
      }
    };

    syncSpacerHeight();
    const observer = new ResizeObserver(syncSpacerHeight);
    observer.observe(floatingNode);
    return () => observer.disconnect();
  }, [hasReference]);

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
      floatingNodeRef.current = node;
      refs.setFloating(node);
    },
    [refs],
  );

  const shouldRenderFloating = hasReference && (!portalRootId || portalRoot !== null);
  const floatingEditor = shouldRenderFloating ? (
    <div ref={setFloating} className="pointer-events-auto z-50 font-sans" style={floatingStyles}>
      <ReviewCommentEditor {...editorProps} />
    </div>
  ) : null;

  return (
    <>
      <div ref={setReference} style={{ height: INITIAL_FLOATING_EDITOR_HEIGHT }} />
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
  defaultCollapsed = false,
  deletingCommentIds = new Set<string>(),
  patchViewerSessionKey = null,
  resolvingThreadId = null,
  viewerLogin = null,
  editorPortalRootId,
  reviewEditorSessionKey = null,
  onReplyToThread,
  onReplyToThreadNow,
  onSetThreadResolved,
  onEditComment,
  onDeleteComment,
  onDeletePendingComment,
  onClick,
  containerRef,
}: ReviewThreadCardProps) {
  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const lastHandledHighlightVersionRef = useRef<number | null>(null);
  const [hasBeenNearViewport, setHasBeenNearViewport] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );
  const rootComment =
    thread.comments.find((comment) => comment.replyToId === null) ?? thread.comments[0] ?? null;
  const isReviewEvent = isReviewEventThread(thread);
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
  const openReplyEditor = useReviewCommentEditorStore((state) => state.openReplyEditor);
  const openEditEditor = useReviewCommentEditorStore((state) => state.openEditEditor);
  const setEditorBody = useReviewCommentEditorStore((state) => state.setEditorBody);
  const setEditorError = useReviewCommentEditorStore((state) => state.setEditorError);
  const setEditorCursorPosition = useReviewCommentEditorStore(
    (state) => state.setEditorCursorPosition,
  );
  const setEditorSubmitting = useReviewCommentEditorStore((state) => state.setEditorSubmitting);
  const closeEditor = useReviewCommentEditorStore((state) => state.closeEditor);
  const patchViewerSession = usePatchViewerStore((state) =>
    getPatchViewerSessionState(state, patchViewerSessionKey),
  );
  const setThreadExpanded = usePatchViewerStore((state) => state.setThreadExpanded);
  const canCreateEditor =
    reviewEditorSessionKey != null && (onReplyToThread != null || onEditComment != null);
  const reviewEditorSettingsQuery = useQuery({
    ...reviewEditorSettingsQueryOptions(),
    enabled: canCreateEditor,
  });
  const defaultReviewEditorMode = reviewEditorSettingsQuery.data?.defaultMode ?? 'rich-text';
  const replyEditor =
    thread.id.length > 0 ? threadEditors.find((editor) => editor.kind === 'reply') : undefined;
  const isResolvePending = resolvingThreadId === thread.id;
  const threadRefKey = getReviewThreadRefKey(thread);
  const isExpandedOverride = patchViewerSession.threadExpansionByKey[threadRefKey];
  const highlightVersion = patchViewerSession.highlightedThreadVersion;
  const isCollapsed = defaultCollapsed ? isExpandedOverride !== true : isExpandedOverride === false;
  const hasActiveEditor =
    replyEditor !== undefined || threadEditors.some((editor) => editor.kind === 'edit');
  const shouldObserveExpandedContent = !slim && !isCollapsed && !hasBeenNearViewport;
  const { ref: inViewRef } = useInView({
    root: null,
    rootMargin: COMMENT_DEFER_ROOT_MARGIN,
    threshold: 0,
    triggerOnce: true,
    skip: !shouldObserveExpandedContent,
    initialInView: typeof IntersectionObserver === 'undefined',
    onChange: (nextInView: boolean) => {
      if (nextInView) {
        setHasBeenNearViewport(true);
      }
    },
  });
  const canToggleResolved =
    thread.canResolve !== false &&
    !isReviewEvent &&
    !thread.isPending &&
    thread.id.length > 0 &&
    onSetThreadResolved != null &&
    !isResolvePending;

  const setContainerNode = useCallback(
    (node: HTMLDivElement | null) => {
      containerNodeRef.current = node;
      inViewRef(node);
      containerRef?.(node);
    },
    [containerRef, inViewRef],
  );

  useEffect(() => {
    if (lastHandledHighlightVersionRef.current === null) {
      lastHandledHighlightVersionRef.current = highlightVersion;
      return;
    }

    if (highlightVersion === lastHandledHighlightVersionRef.current) {
      return;
    }

    lastHandledHighlightVersionRef.current = highlightVersion;

    if (patchViewerSession.highlightedThreadKey !== threadRefKey) {
      return;
    }

    const node = containerNodeRef.current;
    if (!node) {
      return;
    }
    const highlightClasses = [
      'border-amber-300',
      'bg-amber-50',
      'shadow-sm',
      'ring-2',
      'ring-amber-200/70',
      'dark:border-amber-700',
      'dark:bg-amber-950/30',
      'dark:ring-amber-800/50',
    ];
    const cleanup = () => {
      node.classList.remove(...highlightClasses);
    };

    cleanup();
    window.requestAnimationFrame(() => {
      node.classList.add(...highlightClasses);
    });

    const timeoutId = window.setTimeout(() => {
      cleanup();
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
      cleanup();
    };
  }, [patchViewerSession.highlightedThreadKey, highlightVersion, threadRefKey]);

  const shouldRenderExpandedContent =
    hasBeenNearViewport ||
    hasActiveEditor ||
    isResolvePending ||
    patchViewerSession.highlightedThreadKey === threadRefKey;

  if (slim) {
    const threadLine = thread.startLine ?? thread.line;
    const locationLabel = isGlobalReviewThread(thread)
      ? 'Global comment'
      : threadLine === null
        ? `${thread.path} - File comment`
        : `${thread.path}:${threadLine}`;
    const summaryBody = getCommentPreviewText(rootComment?.body ?? '');
    const eventLabel = getReviewEventLabel(thread);
    const actorName = rootComment?.authorName ?? rootComment?.authorLogin ?? 'Someone';
    const eventTime = rootComment ? formatRelativeTimestamp(rootComment.createdAt) : '';

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
          {isReviewEvent ? (
            <>
              <p className="min-w-0 truncate text-sm text-ink-700">
                {actorName} {eventLabel}
              </p>
              <p className="mt-1 text-xs text-ink-500">{eventTime}</p>
            </>
          ) : (
            <>
              <p className="min-w-0 truncate text-sm text-ink-700">
                {summaryBody || '(no comment body)'}
              </p>
              <p className="mt-1 text-xs text-ink-500">{locationLabel}</p>
            </>
          )}
        </div>
      </>
    );

    const baseClassName = 'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left';

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

  if (isCollapsed) {
    const summaryBody = getCommentPreviewText(rootComment?.body ?? '');
    const eventLabel = getReviewEventLabel(thread);
    const actorName = rootComment?.authorName ?? rootComment?.authorLogin ?? 'Someone';

    return (
      <div
        className={`rounded-lg px-3 py-2 text-sm shadow-xs transition-[background-color,border-color,box-shadow] duration-700 ease-out ${
          isReviewEvent
            ? getReviewEventTone(thread)
            : 'border border-ink-200 bg-canvas text-ink-800'
        }`}
        ref={setContainerNode}
      >
        <div className="flex items-center gap-3">
          <button
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs text-ink-500"
            onClick={() => setThreadExpanded(patchViewerSessionKey, threadRefKey, true)}
            type="button"
          >
            {isReviewEvent ? (
              <>
                <span className="shrink-0 font-sans font-medium text-current">
                  {actorName} {eventLabel}
                </span>
                <span className="min-w-0 truncate text-current/70">
                  {rootComment ? formatRelativeTimestamp(rootComment.createdAt) : ''}
                </span>
              </>
            ) : (
              <>
                <span className="shrink-0 font-sans font-medium text-ink-900">
                  {formatThreadLineLabel(thread)}
                </span>
                {thread.isResolved ? (
                  <span className="shrink-0 rounded-full bg-canvasDark px-2 py-0.5 font-sans text-ink-700">
                    Resolved
                  </span>
                ) : null}
                {thread.isOutdated ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-sans text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    Outdated
                  </span>
                ) : null}
                <span className="min-w-0 truncate text-ink-600">
                  {summaryBody || '(no comment body)'}
                </span>
              </>
            )}
          </button>
          <button
            className="shrink-0 font-sans text-xs font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
            onClick={() => setThreadExpanded(patchViewerSessionKey, threadRefKey, true)}
            type="button"
          >
            Expand
          </button>
        </div>
      </div>
    );
  }

  async function handleReplySubmit(
    editorId: string,
    body: string,
    submit: (thread: ReviewThread, body: string) => Promise<void>,
  ) {
    if (!rootComment || !onReplyToThread) {
      return;
    }

    setEditorSubmitting(reviewEditorSessionKey, editorId, true);
    setEditorError(reviewEditorSessionKey, editorId, '');

    try {
      await submit(thread, body);
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

  async function handleEditSubmit(editorId: string, comment: ReviewComment, body: string) {
    if (!onEditComment) {
      return;
    }

    setEditorSubmitting(reviewEditorSessionKey, editorId, true);
    setEditorError(reviewEditorSessionKey, editorId, '');

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

  if (isReviewEvent && rootComment) {
    const actorName = rootComment.authorName ?? rootComment.authorLogin ?? 'Someone';
    const eventLabel = getReviewEventLabel(thread);

    return (
      <div
        className="px-1 py-1 text-sm text-ink-800 transition-opacity duration-700 ease-out"
        ref={setContainerNode}
      >
        <div className="flex items-center gap-3">
          <CommentAvatar comment={rootComment} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-sans font-medium text-ink-900">{actorName}</span>
              <span className={`font-sans ${getReviewEventTone(thread)}`}>{eventLabel}</span>
              <span className="text-xs text-ink-500">
                {formatRelativeTimestamp(rootComment.createdAt)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border p-3 text-sm shadow-xs transition-[opacity,background-color,border-color,box-shadow] duration-700 ease-out ${
        isResolvePending ? 'opacity-60' : 'opacity-100'
      } border-ink-200 bg-canvas text-ink-800`}
      ref={setContainerNode}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {isReviewEvent ? (
            <>
              <span className="font-sans font-medium text-current">
                {(rootComment?.authorName ?? rootComment?.authorLogin ?? 'Someone')}{' '}
                {getReviewEventLabel(thread)}
              </span>
              {rootComment ? (
                <span className="font-sans text-current/70">
                  {formatRelativeTimestamp(rootComment.createdAt)}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <span className="font-sans font-medium text-ink-900">
                {formatThreadLineLabel(thread)}
              </span>
              {thread.isResolved ? (
                <span className="rounded-full bg-canvasDark px-2 py-0.5 font-sans text-ink-700">
                  Resolved
                </span>
              ) : null}
              {thread.isOutdated ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-sans text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  Outdated
                </span>
              ) : null}
              {thread.isPending ? (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 font-sans text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                  Pending
                </span>
              ) : null}
              <span className="font-sans">{thread.comments.length} comments</span>
              {isResolvePending ? <span className="font-sans">Updating...</span> : null}
              {canToggleResolved ? (
                <button
                  className="font-sans text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
                  onClick={() => {
                    if (onSetThreadResolved) {
                      void onSetThreadResolved(thread, !thread.isResolved).catch((error) => {
                        console.error('failed to update thread resolution', {
                          threadId: thread.id,
                          nextResolved: !thread.isResolved,
                          error,
                        });
                      });
                    }
                  }}
                  disabled={isResolvePending}
                  type="button"
                >
                  {thread.isResolved ? 'Unresolve' : 'Resolve'}
                </button>
              ) : null}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {defaultCollapsed && !isReviewEvent && (thread.isResolved || thread.isOutdated) ? (
            <button
              className="font-sans text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
              onClick={() => setThreadExpanded(patchViewerSessionKey, threadRefKey, false)}
              disabled={isResolvePending}
              type="button"
            >
              Collapse
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {shouldRenderExpandedContent ? (
          thread.comments.map((comment) => {
            const editEditor = threadEditors.find(
              (editor) => editor.kind === 'edit' && editor.commentId === comment.id,
            );
            const isDeleting = deletingCommentIds.has(comment.id);
            const canEdit =
              !isReviewEvent &&
              (comment.isPending || (viewerLogin != null && viewerLogin === comment.authorLogin)) &&
              comment.id.length > 0 &&
              thread.id.length > 0 &&
              reviewEditorSessionKey != null &&
              onEditComment != null &&
              !isDeleting;
            const canDeletePending =
              !isReviewEvent && comment.isPending && onDeletePendingComment != null && !isDeleting;
            const canDeletePublished =
              !isReviewEvent &&
              !comment.isPending &&
              viewerLogin != null &&
              viewerLogin === comment.authorLogin &&
              comment.id.length > 0 &&
              onDeleteComment != null &&
              !isDeleting;

            return (
              <div
                className={`grid grid-cols-[auto_minmax(0,1fr)] gap-3 transition-opacity ${
                  isDeleting ? 'opacity-50' : 'opacity-100'
                }`}
                key={comment.id}
              >
                <CommentAvatar comment={comment} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                    <span className="font-sans font-medium text-ink-900">
                      {comment.authorLogin}
                    </span>
                    <span>{formatTimestamp(comment.createdAt)}</span>
                    {comment.isPending ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 font-sans text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                        Pending
                      </span>
                    ) : null}
                    {isDeleting ? <span className="text-ink-500">Deleting...</span> : null}
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
                    {canDeletePending ? (
                      <button
                        className="text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
                        onClick={() => {
                          if (onDeletePendingComment) {
                            void onDeletePendingComment(comment).catch((error) => {
                              console.error('failed to discard pending review comment', {
                                commentId: comment.id,
                                threadId: thread.id,
                                error,
                              });
                            });
                          }
                        }}
                        disabled={isDeleting}
                        type="button"
                      >
                        Discard
                      </button>
                    ) : null}
                    {canDeletePublished ? (
                      <button
                        className="text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
                        onClick={() => {
                          if (onDeleteComment) {
                            void onDeleteComment(thread, comment).catch((error) => {
                              console.error('failed to delete review comment', {
                                commentId: comment.id,
                                threadId: thread.id,
                                error,
                              });
                            });
                          }
                        }}
                        disabled={isDeleting}
                        type="button"
                      >
                        Delete
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
                        onCancel={() => closeEditor(reviewEditorSessionKey, editEditor.id)}
                        onChange={(body) =>
                          setEditorBody(reviewEditorSessionKey, editEditor.id, body)
                        }
                        onCursorPositionChange={(cursorPosition) =>
                          setEditorCursorPosition(
                            reviewEditorSessionKey,
                            editEditor.id,
                            cursorPosition ?? null,
                          )
                        }
                        onSubmit={(body) => handleEditSubmit(editEditor.id, comment, body)}
                      />
                    ) : (
                      <CommentMarkdown body={comment.body} filePath={thread.path || undefined} />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-md border border-dashed border-ink-200 bg-surface px-3 py-2 text-xs text-ink-500">
            Rendering comments when visible...
          </div>
        )}
      </div>

      {rootComment &&
      !isReviewEvent &&
      onReplyToThread &&
      !thread.isPending &&
      thread.id.length > 0 &&
      reviewEditorSessionKey != null &&
      shouldRenderExpandedContent ? (
        <div className="mt-3 border-t border-ink-200 pt-3">
          {replyEditor ? (
            <FloatingReviewCommentEditor
              portalRootId={editorPortalRootId}
              cursorPosition={replyEditor.cursorPosition}
              defaultMode={defaultReviewEditorMode}
              error={replyEditor.error}
              isPending={replyEditor.isSubmitting}
              provider={thread.provider}
              secondarySubmitLabel={onReplyToThreadNow ? 'Add comment now' : undefined}
              submitLabel="Reply"
              target={editorTarget}
              value={replyEditor.body}
              onCancel={() => closeEditor(reviewEditorSessionKey, replyEditor.id)}
              onChange={(body) => setEditorBody(reviewEditorSessionKey, replyEditor.id, body)}
              onCursorPositionChange={(cursorPosition) =>
                setEditorCursorPosition(
                  reviewEditorSessionKey,
                  replyEditor.id,
                  cursorPosition ?? null,
                )
              }
              onSecondarySubmit={
                onReplyToThreadNow
                  ? (body) => handleReplySubmit(replyEditor.id, body, onReplyToThreadNow)
                  : undefined
              }
              onSubmit={(body) => handleReplySubmit(replyEditor.id, body, onReplyToThread)}
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
