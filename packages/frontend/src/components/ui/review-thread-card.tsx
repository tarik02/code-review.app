import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { FloatingPortal, autoUpdate, offset, size, useFloating } from '@floating-ui/react';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  type LucideIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ReplyIcon,
  Trash2Icon,
} from 'lucide-react';
import { useInView } from 'react-intersection-observer';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  getReviewThreadRefKey,
  isGlobalReviewThread,
  isReviewEventThread,
  type ReviewComment,
  type ReviewThread,
} from '../../lib/review-threads';
import { getCommentPreviewText } from '../../lib/comment-preview';
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
import { Button, buttonVariants } from './button';

const INITIAL_FLOATING_EDITOR_HEIGHT = 180;
const COMMENT_DEFER_ROOT_MARGIN = '600px 0px';
const COMMENT_ACTION_CLASS_NAME = 'font-sans text-ink-600 hover:bg-transparent hover:text-ink-900';
const COMMENT_ACTION_MENU_ITEM_CLASS =
  'flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-700 outline-hidden select-none transition-colors data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-canvasDark data-highlighted:text-ink-900';

type CommentAction = {
  disabled?: boolean;
  icon: LucideIcon;
  key: string;
  label: string;
} & (
  | {
      kind: 'button';
      onSelect: () => void;
    }
  | {
      href: string;
      kind: 'link';
    }
);

type ReviewThreadCardProps = {
  thread: ReviewThread;
  compact?: boolean;
  slim?: boolean;
  defaultCollapsed?: boolean;
  defaultReviewEditorMode?: ReviewCommentEditorProps['defaultMode'];
  floatingReviewEditorControls?: boolean;
  deletingCommentIds?: ReadonlySet<string>;
  patchViewerSessionKey?: string | null;
  resolvingThreadId?: string | null;
  viewerLogin?: string | null;
  editorPortalRoot?: HTMLElement | null;
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

function CommentInitialAvatar({ authorLogin, size }: { authorLogin: string; size: 'sm' | 'md' }) {
  const initials = authorLogin.slice(0, 1).toUpperCase();
  const avatarClassName = size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-[11px]';

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-ink-200 font-semibold text-ink-700 ${avatarClassName}`}
    >
      {initials}
    </div>
  );
}

function CommentAvatar({ comment, size = 'md' }: { comment: ReviewComment; size?: 'sm' | 'md' }) {
  const imageClassName =
    size === 'sm'
      ? 'size-6 rounded-full border border-ink-200 object-cover'
      : 'size-8 rounded-full border border-ink-200 object-cover';

  if (!comment.authorAvatarUrl) {
    return <CommentInitialAvatar authorLogin={comment.authorLogin} size={size} />;
  }

  return (
    <img
      alt={comment.authorLogin}
      className={`shrink-0 ${imageClassName}`}
      src={comment.authorAvatarUrl}
    />
  );
}

function CommentRowShell({
  actions,
  avatar,
  children,
  isDimmed = false,
  isReply = false,
  metadata,
}: {
  actions?: readonly CommentAction[];
  avatar: ReactNode;
  children: ReactNode;
  isDimmed?: boolean;
  isReply?: boolean;
  metadata: ReactNode;
}) {
  const hasActions = actions != null && actions.length > 0;

  return (
    <div
      className={`grid grid-cols-[auto_minmax(0,1fr)] gap-3 [container-type:inline-size] transition-opacity ${
        isDimmed ? 'opacity-50' : 'opacity-100'
      } ${isReply ? 'ml-5' : ''}`}
    >
      {avatar}
      <div className="min-w-0 overflow-hidden">
        <div className="flex min-w-0 items-center justify-between gap-2 overflow-hidden text-xs text-ink-500">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap">
            {metadata}
          </div>
          {hasActions ? (
            <>
              <div className="hidden shrink-0 items-center gap-1.5 [@container(min-width:560px)]:flex">
                {actions.map((action) => (
                  <CommentInlineAction action={action} key={action.key} />
                ))}
              </div>
              <div className="flex shrink-0 [@container(min-width:560px)]:hidden">
                <CommentActionsMenu actions={actions} />
              </div>
            </>
          ) : null}
        </div>
        <div className="mt-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}

function CommentInlineAction({ action }: { action: CommentAction }) {
  if (action.kind === 'link') {
    return <CommentActionLink href={action.href} icon={action.icon} label={action.label} />;
  }

  return (
    <CommentActionButton disabled={action.disabled} icon={action.icon} onClick={action.onSelect}>
      {action.label}
    </CommentActionButton>
  );
}

function CommentActionsMenu({ actions }: { actions: readonly CommentAction[] }) {
  return (
    <MenuPrimitive.Root modal={false}>
      <MenuPrimitive.Trigger
        render={
          <Button
            aria-label="Comment actions"
            className="text-ink-500 hover:bg-canvasDark hover:text-ink-900"
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <MoreHorizontalIcon className="size-3.5" />
          </Button>
        }
      />
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner align="end" className="isolate z-50" side="bottom" sideOffset={6}>
          <MenuPrimitive.Popup className="relative isolate z-50 min-w-44 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            {actions.map((action) => {
              const Icon = action.icon;

              if (action.kind === 'link') {
                return (
                  <MenuPrimitive.LinkItem
                    className={COMMENT_ACTION_MENU_ITEM_CLASS}
                    closeOnClick
                    href={action.href}
                    key={action.key}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <Icon className="size-4 text-ink-500" />
                    <span>{action.label}</span>
                  </MenuPrimitive.LinkItem>
                );
              }

              return (
                <MenuPrimitive.Item
                  className={COMMENT_ACTION_MENU_ITEM_CLASS}
                  disabled={action.disabled}
                  key={action.key}
                  onClick={action.onSelect}
                >
                  <Icon className="size-4 text-ink-500" />
                  <span>{action.label}</span>
                </MenuPrimitive.Item>
              );
            })}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

function CommentActionButton({
  children,
  disabled,
  icon: Icon,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <Button
      className={COMMENT_ACTION_CLASS_NAME}
      disabled={disabled}
      onClick={onClick}
      size="inline"
      type="button"
      variant="ghost"
    >
      <Icon data-icon="inline-start" />
      {children}
    </Button>
  );
}

function CommentActionLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <a
      className={buttonVariants({
        variant: 'ghost',
        size: 'inline',
        className: COMMENT_ACTION_CLASS_NAME,
      })}
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <Icon data-icon="inline-start" />
      {label}
    </a>
  );
}

function FloatingReviewCommentEditor({
  portalRoot,
  draftMetadata,
  ...editorProps
}: ReviewCommentEditorProps & {
  portalRoot?: HTMLElement | null;
  draftMetadata?: {
    authorLogin: string;
    label: string;
    avatarSize: 'sm' | 'md';
    onDiscard?: () => void;
  };
}) {
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const floatingNodeRef = useRef<HTMLDivElement | null>(null);
  const [hasReference, setHasReference] = useState(false);
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

  const shouldRenderFloating = hasReference && portalRoot !== null;
  const floatingEditor = shouldRenderFloating ? (
    <div ref={setFloating} className="pointer-events-auto z-50 font-sans" style={floatingStyles}>
      {draftMetadata ? (
        <CommentRowShell
          actions={
            draftMetadata.onDiscard
              ? [
                  {
                    icon: Trash2Icon,
                    key: 'delete-draft',
                    kind: 'button',
                    label: 'Delete',
                    onSelect: draftMetadata.onDiscard,
                  },
                ]
              : undefined
          }
          avatar={
            <CommentInitialAvatar
              authorLogin={draftMetadata.authorLogin}
              size={draftMetadata.avatarSize}
            />
          }
          isReply
          metadata={
            <>
              <span className="shrink-0 font-sans font-medium text-ink-900">
                {draftMetadata.authorLogin}
              </span>
              <span className="min-w-0 truncate font-sans font-medium text-ink-900">
                {draftMetadata.label}
              </span>
              <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 font-sans text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                Draft
              </span>
            </>
          }
        >
          <ReviewCommentEditor {...editorProps} />
        </CommentRowShell>
      ) : (
        <ReviewCommentEditor {...editorProps} />
      )}
    </div>
  ) : null;

  return (
    <>
      <div ref={setReference} style={{ height: INITIAL_FLOATING_EDITOR_HEIGHT }} />
      {portalRoot === undefined ? (
        <FloatingPortal>{floatingEditor}</FloatingPortal>
      ) : (
        <FloatingPortal root={portalRoot}>{floatingEditor}</FloatingPortal>
      )}
    </>
  );
}

function SlimReviewThreadCard({ thread, onClick }: { thread: ReviewThread; onClick?: () => void }) {
  const rootComment =
    thread.comments.find((comment) => comment.replyToId === null) ?? thread.comments[0] ?? null;
  const isReviewEvent = isReviewEventThread(thread);
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

function ReviewThreadCard(props: ReviewThreadCardProps) {
  if (props.slim) {
    return <SlimReviewThreadCard thread={props.thread} onClick={props.onClick} />;
  }

  return <ReviewThreadCardFull {...props} />;
}

function ReviewThreadCardFull({
  thread,
  compact = false,
  defaultCollapsed = false,
  defaultReviewEditorMode = 'rich-text',
  floatingReviewEditorControls = false,
  deletingCommentIds = new Set<string>(),
  patchViewerSessionKey = null,
  resolvingThreadId = null,
  viewerLogin = null,
  editorPortalRoot,
  reviewEditorSessionKey = null,
  onReplyToThread,
  onReplyToThreadNow,
  onSetThreadResolved,
  onEditComment,
  onDeleteComment,
  onDeletePendingComment,
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
  const threadRefKey = getReviewThreadRefKey(thread);
  const threadEditors = useReviewCommentEditorStore(
    useShallow((state) => {
      const reviewEditorSession = getReviewCommentEditorSessionState(state, reviewEditorSessionKey);
      return reviewEditorSession.editorOrder
        .map((editorId) => reviewEditorSession.editorsById[editorId])
        .filter(
          (editor): editor is ReviewCommentEditorState =>
            editor != null && editor.threadId === thread.id,
        );
    }),
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
  const isExpandedOverride = usePatchViewerStore(
    (state) =>
      getPatchViewerSessionState(state, patchViewerSessionKey).threadExpansionByKey[threadRefKey],
  );
  const highlightVersion = usePatchViewerStore((state) => {
    const session = getPatchViewerSessionState(state, patchViewerSessionKey);
    return session.highlightedThreadKey === threadRefKey ? session.highlightedThreadVersion : 0;
  });
  const setThreadExpanded = usePatchViewerStore((state) => state.setThreadExpanded);
  const replyEditor =
    thread.id.length > 0 ? threadEditors.find((editor) => editor.kind === 'reply') : undefined;
  const isResolvePending = resolvingThreadId === thread.id;
  const isCollapsed = defaultCollapsed ? isExpandedOverride !== true : isExpandedOverride === false;
  const hasActiveEditor =
    replyEditor !== undefined || threadEditors.some((editor) => editor.kind === 'edit');
  const shouldObserveExpandedContent = !isCollapsed && !hasBeenNearViewport;
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
    if (highlightVersion === 0) {
      return;
    }

    if (lastHandledHighlightVersionRef.current === null) {
      lastHandledHighlightVersionRef.current = highlightVersion;
    } else {
      if (highlightVersion === lastHandledHighlightVersionRef.current) {
        return;
      }

      lastHandledHighlightVersionRef.current = highlightVersion;
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
  }, [highlightVersion]);

  const shouldRenderExpandedContent =
    hasBeenNearViewport || hasActiveEditor || isResolvePending || highlightVersion > 0;
  const canReplyToThread =
    rootComment != null &&
    !isReviewEvent &&
    onReplyToThread != null &&
    !thread.isPending &&
    thread.id.length > 0 &&
    reviewEditorSessionKey != null &&
    shouldRenderExpandedContent;

  if (isCollapsed) {
    const summaryBody = getCommentPreviewText(rootComment?.body ?? '');
    const eventLabel = getReviewEventLabel(thread);
    const actorName = rootComment?.authorName ?? rootComment?.authorLogin ?? 'Someone';
    const expandAction: CommentAction = {
      icon: ChevronDownIcon,
      key: 'expand',
      kind: 'button',
      label: 'Expand',
      onSelect: () => setThreadExpanded(patchViewerSessionKey, threadRefKey, true),
    };

    return (
      <div
        className={`rounded-lg px-3 py-2 text-sm shadow-xs transition-[background-color,border-color,box-shadow] duration-700 ease-out ${
          isReviewEvent
            ? getReviewEventTone(thread)
            : 'border border-ink-200 bg-canvas text-ink-800'
        }`}
        ref={setContainerNode}
      >
        <div className="flex items-center gap-3 overflow-hidden [container-type:inline-size]">
          <button
            className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap text-left text-xs text-ink-500"
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
          <div className="hidden shrink-0 [@container(min-width:560px)]:block">
            <CommentInlineAction action={expandAction} />
          </div>
          <div className="flex shrink-0 [@container(min-width:560px)]:hidden">
            <CommentActionsMenu actions={[expandAction]} />
          </div>
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
        new Error('Reply failed.', { cause: error }).message,
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
        new Error('Comment update failed.', { cause: error }).message,
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
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap text-sm">
              <span className="shrink-0 font-sans font-medium text-ink-900">{actorName}</span>
              <span className={`min-w-0 truncate font-sans ${getReviewEventTone(thread)}`}>
                {eventLabel}
              </span>
              <span className="shrink-0 text-xs text-ink-500">
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
      <div className="flex flex-col gap-3">
        {shouldRenderExpandedContent ? (
          thread.comments.map((comment) => {
            const isLeadComment = rootComment?.id === comment.id;
            const isReplyComment = comment.replyToId !== null;
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
            const actions: CommentAction[] = [];

            if (canEdit) {
              actions.push({
                icon: PencilIcon,
                key: 'edit',
                kind: 'button',
                label: 'Edit',
                onSelect: () => {
                  openEditEditor(reviewEditorSessionKey, thread.id, comment.id, comment.body);
                },
              });
            }

            if (canDeletePending) {
              actions.push({
                disabled: isDeleting,
                icon: Trash2Icon,
                key: 'discard',
                kind: 'button',
                label: 'Discard',
                onSelect: () => {
                  if (onDeletePendingComment) {
                    void onDeletePendingComment(comment).catch((error) => {
                      console.error('failed to discard pending review comment', {
                        commentId: comment.id,
                        threadId: thread.id,
                        error,
                      });
                    });
                  }
                },
              });
            }

            if (canDeletePublished) {
              actions.push({
                disabled: isDeleting,
                icon: Trash2Icon,
                key: 'delete',
                kind: 'button',
                label: 'Delete',
                onSelect: () => {
                  if (onDeleteComment) {
                    void onDeleteComment(thread, comment).catch((error) => {
                      console.error('failed to delete review comment', {
                        commentId: comment.id,
                        threadId: thread.id,
                        error,
                      });
                    });
                  }
                },
              });
            }

            if (isLeadComment && canToggleResolved) {
              actions.push({
                disabled: isResolvePending,
                icon: CheckIcon,
                key: 'resolve',
                kind: 'button',
                label: thread.isResolved ? 'Unresolve' : 'Resolve',
                onSelect: () => {
                  if (onSetThreadResolved) {
                    void onSetThreadResolved(thread, !thread.isResolved).catch((error) => {
                      console.error('failed to update thread resolution', {
                        threadId: thread.id,
                        nextResolved: !thread.isResolved,
                        error,
                      });
                    });
                  }
                },
              });
            }

            if (isLeadComment && !isReviewEvent && thread.id.length > 0) {
              actions.push({
                disabled: isResolvePending,
                icon: ChevronUpIcon,
                key: 'collapse',
                kind: 'button',
                label: 'Collapse',
                onSelect: () => setThreadExpanded(patchViewerSessionKey, threadRefKey, false),
              });
            }

            if (!compact && comment.url) {
              actions.push({
                href: comment.url,
                icon: ExternalLinkIcon,
                key: 'open',
                kind: 'link',
                label: 'Open',
              });
            }

            return (
              <CommentRowShell
                actions={actions}
                avatar={<CommentAvatar comment={comment} size={isReplyComment ? 'sm' : 'md'} />}
                isDimmed={isDeleting}
                isReply={isReplyComment}
                key={comment.id}
                metadata={
                  <>
                    <span className="shrink-0 font-sans font-medium text-ink-900">
                      {comment.authorLogin}
                    </span>
                    <span className="shrink-0">{formatTimestamp(comment.createdAt)}</span>
                    {isLeadComment ? (
                      <span className="min-w-0 truncate font-sans font-medium text-ink-900">
                        {formatThreadLineLabel(thread)}
                      </span>
                    ) : null}
                    {isLeadComment && thread.isResolved ? (
                      <span className="shrink-0 rounded-full bg-canvasDark px-2 py-0.5 font-sans text-ink-700">
                        Resolved
                      </span>
                    ) : null}
                    {isLeadComment && thread.isOutdated ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-sans text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        Outdated
                      </span>
                    ) : null}
                    {(isLeadComment && thread.isPending) || comment.isPending ? (
                      <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 font-sans text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                        Pending
                      </span>
                    ) : null}
                    {isLeadComment ? (
                      <span className="shrink-0 font-sans">
                        {thread.comments.length}{' '}
                        {thread.comments.length === 1 ? 'comment' : 'comments'}
                      </span>
                    ) : null}
                    {isResolvePending ? (
                      <span className="shrink-0 font-sans">Updating...</span>
                    ) : null}
                    {isDeleting ? <span className="shrink-0 text-ink-500">Deleting...</span> : null}
                  </>
                }
              >
                {editEditor ? (
                  <FloatingReviewCommentEditor
                    portalRoot={editorPortalRoot}
                    cursorPosition={editEditor.cursorPosition}
                    defaultMode={defaultReviewEditorMode}
                    floatingControls={floatingReviewEditorControls}
                    error={editEditor.error}
                    initialValue={comment.body}
                    isPending={editEditor.isSubmitting}
                    provider={thread.provider}
                    submitLabel="Save"
                    target={editorTarget}
                    value={editEditor.body}
                    onCancel={() => closeEditor(reviewEditorSessionKey, editEditor.id)}
                    onChange={(body) => setEditorBody(reviewEditorSessionKey, editEditor.id, body)}
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
              </CommentRowShell>
            );
          })
        ) : (
          <div className="rounded-md border border-dashed border-ink-200 bg-surface px-3 py-2 text-xs text-ink-500">
            Rendering comments when visible...
          </div>
        )}
      </div>

      {canReplyToThread && replyEditor ? (
        <div className="mt-2">
          <FloatingReviewCommentEditor
            portalRoot={editorPortalRoot}
            cursorPosition={replyEditor.cursorPosition}
            defaultMode={defaultReviewEditorMode}
            draftMetadata={{
              authorLogin: viewerLogin ?? 'You',
              label: 'Reply',
              avatarSize: 'sm',
              onDiscard: () => closeEditor(reviewEditorSessionKey, replyEditor.id),
            }}
            floatingControls={floatingReviewEditorControls}
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
        </div>
      ) : null}
      {canReplyToThread && replyEditor == null ? (
        <div className="mt-2 flex justify-end">
          <CommentActionButton
            icon={ReplyIcon}
            onClick={() => {
              openReplyEditor(reviewEditorSessionKey, thread.id);
            }}
          >
            Reply
          </CommentActionButton>
        </div>
      ) : null}
    </div>
  );
}

export { ReviewThreadCard };
export type { ReviewThreadCardProps };
