'use no memo';

import { autoUpdate, FloatingPortal, offset, size, useFloating } from '@floating-ui/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, UIEvent } from 'react';
import { createPortal } from 'react-dom';
import type {
  DiffLineAnnotation,
  AnnotationSide,
  ExpansionDirections,
  FileDiff as PierreFileDiffInstance,
  FileDiffMetadata,
  HunkExpansionRegion,
  SelectedLineRange,
  VirtualFileMetrics,
  VirtualizerConfig,
} from '@pierre/diffs';
import { useQuery } from '@tanstack/react-query';
import type { GitStatusEntry } from '@pierre/trees';
import { FileDiff, VirtualizerContext } from '@pierre/diffs/react';
import { ChangedFilesTree } from './changed-files-tree';
import { AppearanceBackground } from './appearance-background';
import { PatchScrollVirtualizer } from './patch-scroll-virtualizer';
import { PullRequestApprovalSummary } from './pull-request-approval-summary';
import { PullRequestQualitySummary } from './pull-request-quality-summary';
import { ReviewCommentEditor, type CommentEditorMode } from './review-comment-editor';
import { ReviewThreadCard } from './review-thread-card';
import { ScrollArea } from './scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { TopBar, TOP_BAR_MACOS_HEIGHT, TOP_BAR_WCO_HEIGHT } from './top-bar';
import {
  usePullRequestApprovalMutations,
  usePullRequestReviewCommentMutations,
} from '../../hooks/use-forge-queries';
import { useDiffNavigator } from '../../hooks/use-diff-navigator';
import { cx } from '../../lib/cx';
import {
  appearanceBackgroundQueryOptions,
  pullRequestFileContentsQueryOptions,
  reviewEditorSettingsQueryOptions,
} from '../../queries/forge';
import {
  getGlobalReviewThreads,
  getFileReviewThreadsForPath,
  getReviewThreadCreatedAt,
  getReviewThreadRefKey,
  isActiveReviewThread,
  isFileReviewThread,
  isGlobalReviewThread,
  normalizePath,
  type FileReviewThreads,
  type ReviewComment,
  type ReviewThread,
  type ReviewThreadAnnotation,
} from '../../lib/review-threads';
import {
  getFileQualityFindings,
  type FileQualityFindings,
  type QualityFindingAnnotation,
} from '../../lib/pull-request-quality';
import type {
  FileStatsEntry,
  ForgeProviderKind,
  PrFileChangeType,
  PrFileContents,
  PendingReviewState,
  PendingReviewSubmitAction,
  PullRequestApprovalState,
  PullRequestQualityFinding,
  PullRequestQualityReport,
  RepoIdentity,
  ReviewCommentSide,
  SelectedPullRequest,
} from '../../types/forge';
import { providerFromProviderId, repoIdentityKey } from '../../lib/repo-identity';
import { getPatchViewerSessionState, usePatchViewerStore } from '../../stores/patch-viewer-store';
import {
  getReviewCommentEditorSessionState,
  useReviewCommentEditorStore,
  type DraftReviewCommentTarget,
  type ReviewCommentEditorState,
} from '../../stores/review-comment-editor-store';

const VIRTUALIZER_CONFIG: Partial<VirtualizerConfig> = {
  overscrollSize: 1200,
  resizeDebugging: false,
};

const VIRTUAL_FILE_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 32,
  fileGap: 8,
};

const DIFF_FONT_STYLE = {
  '--diffs-font-family':
    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  '--diffs-header-font-family':
    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as CSSProperties;

const DIFF_EXPANSION_LINE_COUNT = 20;
const DIFF_COLLAPSED_CONTEXT_THRESHOLD = 0;
const SCROLL_RESTORE_MAX_ATTEMPTS = 60;
const INITIAL_FLOATING_EDITOR_HEIGHT = 180;

type HunkExpansionOwner = {
  expandHunk(
    hunkIndex: number,
    direction: ExpansionDirections,
    expansionLineCountOverride?: number,
  ): void;
  hunksRenderer?: {
    getExpandedHunk?(hunkIndex: number): HunkExpansionRegion;
  };
};

type SelectedPatch = RepoIdentity & {
  number: number;
  headSha: string;
  fileDiffs: FileDiffMetadata[];
};

type DraftReviewCommentAnnotation = {
  kind: 'draft';
  editorId: string;
  portalRootId: string;
};

type ReviewThreadLineAnnotation = ReviewThreadAnnotation & {
  defaultCollapsed?: boolean;
  portalRootId?: string;
};

type QualityFindingLineAnnotation = QualityFindingAnnotation & {
  kind: 'quality';
};

type PatchLineAnnotation =
  | ReviewThreadLineAnnotation
  | QualityFindingLineAnnotation
  | DraftReviewCommentAnnotation;

type PatchViewerMainProps = {
  selectedPrKey: string | null;
  selectedPr: SelectedPullRequest | null;
  selectedPatch: SelectedPatch | null;
  selectedBaseSha: string | null;
  isGitDiffMode: boolean;
  isPatchLoading: boolean;
  patchError: string;
  approvalState: PullRequestApprovalState | null;
  isApprovalStateLoading: boolean;
  approvalStateError: string;
  changedFiles: string[];
  isChangedFilesLoading: boolean;
  changedFilesError: string;
  globalReviewThreads: ReviewThread[];
  reviewThreadsByFile: Map<string, FileReviewThreads>;
  reviewThreads: ReviewThread[];
  isReviewThreadsLoading: boolean;
  reviewThreadsError: string;
  pendingReview: PendingReviewState;
  isPendingReviewLoading: boolean;
  pendingReviewError: string;
  qualityReport: PullRequestQualityReport | null;
  isQualityReportLoading: boolean;
  qualityReportError: string;
  qualityFindingsByFile: Map<string, FileQualityFindings>;
  displayedQualityInlineCount: number;
  displayedQualityFileCount: number;
  unmappedQualityFindings: PullRequestQualityFinding[];
  parsedPatch: {
    fileDiffs: FileDiffMetadata[];
    parseError: string;
  };
  fileStats: Map<string, FileStatsEntry> | null;
  gitStatus: GitStatusEntry[] | undefined;
  isDark: boolean;
};

type PatchFileDiffItemContextValue = {
  defaultReviewEditorMode: CommentEditorMode;
  deletingCommentIds: ReadonlySet<string>;
  patchViewerSessionKey: string | null;
  resolvingThreadId: string | null;
  diffNavigator: ReturnType<typeof useDiffNavigator>['diff'];
  isInactiveFileCommentsExpanded: (filePath: string) => boolean;
  parsedFileDiffs: FileDiffMetadata[];
  registerFileCommentsSection: (filePath: string, node: HTMLDivElement | null) => void;
  registerThreadAnchor: (thread: ReviewThread, node: HTMLDivElement | null) => void;
  reviewEditorSessionKey: string | null;
  qualityFindingsByFile: Map<string, FileQualityFindings>;
  reviewThreadsByFile: Map<string, FileReviewThreads>;
  scrollToFileCommentsSection: (filePath: string) => void;
  selectedBaseSha: string | null;
  selectedPatch: SelectedPatch;
  selectedProvider: ForgeProviderKind;
  setInactiveFileCommentsExpanded: (filePath: string, expanded: boolean) => void;
  viewerLogin: string | null;
  handleDeletePendingComment: (comment: ReviewComment) => Promise<void>;
  handleDeleteComment: (thread: ReviewThread, comment: ReviewComment) => Promise<void>;
  handleEditComment: (comment: ReviewComment, body: string) => Promise<void>;
  handleFileDiffPostRender: (
    node: HTMLElement,
    instance: PierreFileDiffInstance<PatchLineAnnotation>,
    fileDiff: FileDiffMetadata,
    normalizedFilePath: string,
  ) => void;
  handleReplyToThread: (thread: ReviewThread, body: string) => Promise<void>;
  handleReplyToThreadNow: (thread: ReviewThread, body: string) => Promise<void>;
  handleSetThreadResolved: (thread: ReviewThread, isResolved: boolean) => Promise<void>;
  handleSubmitDraftComment: (editorId: string, body: string) => Promise<void>;
  handleSubmitDraftCommentNow: (editorId: string, body: string) => Promise<void>;
};

const PatchFileDiffItemContext = createContext<PatchFileDiffItemContextValue | null>(null);

function usePatchFileDiffItemContext() {
  const context = useContext(PatchFileDiffItemContext);
  if (!context) {
    throw new Error('PatchFileDiffItem must be rendered inside PatchViewerMain');
  }

  return context;
}

function toGithubSide(side: SelectedLineRange['side']): ReviewCommentSide {
  return side === 'deletions' ? 'LEFT' : 'RIGHT';
}

function toSelectionSide(side: ReviewCommentSide | null | undefined): AnnotationSide {
  return side === 'LEFT' ? 'deletions' : 'additions';
}

function createFileDraftTarget(
  fileDiff: FileDiffMetadata,
): Extract<DraftReviewCommentTarget, { type: 'file' }> {
  const changeType = fileDiff.type as PrFileChangeType;

  if (changeType === 'new') {
    return {
      type: 'file',
      path: fileDiff.name,
      oldPath: '',
      newPath: fileDiff.name,
      changeType,
    };
  }

  if (changeType === 'deleted') {
    return {
      type: 'file',
      path: fileDiff.name,
      oldPath: fileDiff.prevName ?? fileDiff.name,
      newPath: '',
      changeType,
    };
  }

  return {
    type: 'file',
    path: fileDiff.name,
    oldPath: fileDiff.prevName ?? fileDiff.name,
    newPath: fileDiff.name,
    changeType,
  };
}

function getFileDiffLineCounts(fileDiff: FileDiffMetadata) {
  let additions = 0;
  let deletions = 0;

  for (const hunk of fileDiff.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }

  return { additions, deletions };
}

function getFileChangeTypePresentation(changeType: PrFileChangeType): {
  iconClassName: string;
  label: string;
} {
  switch (changeType) {
    case 'new':
      return {
        iconClassName: 'text-emerald-600 dark:text-emerald-400',
        label: 'Added file',
      };
    case 'deleted':
      return {
        iconClassName: 'text-red-600 dark:text-red-400',
        label: 'Deleted file',
      };
    case 'rename-pure':
      return {
        iconClassName: 'text-sky-600 dark:text-sky-400',
        label: 'Renamed file',
      };
    case 'rename-changed':
      return {
        iconClassName: 'text-amber-600 dark:text-amber-400',
        label: 'Renamed and changed file',
      };
    case 'change':
    default:
      return {
        iconClassName: 'text-ink-500 dark:text-ink-400',
        label: 'Modified file',
      };
  }
}

function PierreChangeTypeIcon({
  changeType,
  className,
}: {
  changeType: PrFileChangeType;
  className?: string;
}) {
  switch (changeType) {
    case 'new':
      return (
        <svg aria-hidden className={className} fill="currentColor" viewBox="0 0 16 16">
          <path d="M8 4a.75.75 0 0 1 .75.75v2.5h2.5a.75.75 0 0 1 0 1.5h-2.5v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5A.75.75 0 0 1 8 4" />
          <path d="M1.788 4.296c.196-.88.478-1.381.802-1.706s.826-.606 1.706-.802C5.194 1.588 6.387 1.5 8 1.5s2.806.088 3.704.288c.88.196 1.381.478 1.706.802s.607.826.802 1.706c.2.898.288 2.091.288 3.704s-.088 2.806-.288 3.704c-.195.88-.478 1.381-.802 1.706s-.826.607-1.706.802c-.898.2-2.091.288-3.704.288s-2.806-.088-3.704-.288c-.88-.195-1.381-.478-1.706-.802s-.606-.826-.802-1.706C1.588 10.806 1.5 9.613 1.5 8s.088-2.806.288-3.704M8 0C1.412 0 0 1.412 0 8s1.412 8 8 8 8-1.412 8-8-1.412-8-8-8" />
        </svg>
      );
    case 'deleted':
      return (
        <svg aria-hidden className={className} fill="currentColor" viewBox="0 0 16 16">
          <path d="M4 8a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 8" />
          <path d="M1.788 4.296c.196-.88.478-1.381.802-1.706s.826-.606 1.706-.802C5.194 1.588 6.387 1.5 8 1.5s2.806.088 3.704.288c.88.196 1.381.478 1.706.802s.607.826.802 1.706c.2.898.288 2.091.288 3.704s-.088 2.806-.288 3.704c-.195.88-.478 1.381-.802 1.706s-.826.607-1.706.802c-.898.2-2.091.288-3.704.288s-2.806-.088-3.704-.288c-.88-.195-1.381-.478-1.706-.802s-.606-.826-.802-1.706C1.588 10.806 1.5 9.613 1.5 8s.088-2.806.288-3.704M8 0C1.412 0 0 1.412 0 8s1.412 8 8 8 8-1.412 8-8-1.412-8-8-8" />
        </svg>
      );
    case 'rename-pure':
    case 'rename-changed':
      return (
        <svg aria-hidden className={className} fill="currentColor" viewBox="0 0 16 16">
          <path d="M1.788 4.296c.196-.88.478-1.381.802-1.706s.826-.606 1.706-.802C5.194 1.588 6.387 1.5 8 1.5s2.806.088 3.704.288c.88.196 1.381.478 1.706.802s.607.826.802 1.706c.2.898.288 2.091.288 3.704s-.088 2.806-.288 3.704c-.195.88-.478 1.381-.802 1.706s-.826.607-1.706.802c-.898.2-2.091.288-3.704.288s-2.806-.088-3.704-.288c-.88-.195-1.381-.478-1.706-.802s-.606-.826-.802-1.706C1.588 10.806 1.5 9.613 1.5 8s.088-2.806.288-3.704M8 0C1.412 0 0 1.412 0 8s1.412 8 8 8 8-1.412 8-8-1.412-8-8-8" />
          <path d="M8.495 4.695a.75.75 0 0 0-.05 1.06L10.486 8l-2.041 2.246a.75.75 0 0 0 1.11 1.008l2.5-2.75a.75.75 0 0 0 0-1.008l-2.5-2.75a.75.75 0 0 0-1.06-.051m-4 0a.75.75 0 0 0-.05 1.06l2.044 2.248-1.796 1.995a.75.75 0 0 0 1.114 1.004l2.25-2.5a.75.75 0 0 0-.002-1.007l-2.5-2.75a.75.75 0 0 0-1.06-.05" />
        </svg>
      );
    case 'change':
    default:
      return (
        <svg aria-hidden className={className} fill="currentColor" viewBox="0 0 16 16">
          <path d="M1.5 8c0 1.613.088 2.806.288 3.704.196.88.478 1.381.802 1.706s.826.607 1.706.802c.898.2 2.091.288 3.704.288s2.806-.088 3.704-.288c.88-.195 1.381-.478 1.706-.802s.607-.826.802-1.706c.2-.898.288-2.091.288-3.704s-.088-2.806-.288-3.704c-.195-.88-.478-1.381-.802-1.706s-.826-.606-1.706-.802C10.806 1.588 9.613 1.5 8 1.5s-2.806.088-3.704.288c-.88.196-1.381.478-1.706.802s-.606.826-.802 1.706C1.588 5.194 1.5 6.387 1.5 8M0 8c0-6.588 1.412-8 8-8s8 1.412 8 8-1.412 8-8 8-8-1.412-8-8m8 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6" />
        </svg>
      );
  }
}

function PierreRenameArrowIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} fill="currentColor" viewBox="0 0 16 16">
      <path d="M8.47 4.22a.75.75 0 0 0 0 1.06l1.97 1.97H3.75a.75.75 0 0 0 0 1.5h6.69l-1.97 1.97a.75.75 0 1 0 1.06 1.06l3.25-3.25a.75.75 0 0 0 0-1.06L9.53 4.22a.75.75 0 0 0-1.06 0" />
    </svg>
  );
}

function scheduleNextFrame(callback: () => void) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    const frameId = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frameId);
  }

  const timeoutId = setTimeout(callback, 0);
  return () => clearTimeout(timeoutId);
}

function normalizeDiffLineText(content: string) {
  return content.replace(/[\r\n]+$/g, '');
}

function splitFileContentLines(content: string) {
  if (content.length === 0) {
    return [];
  }

  const lines = content.split(/\r\n|\n|\r/);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function getDiffLineContent(fileDiff: FileDiffMetadata, side: ReviewCommentSide, line: number) {
  const isAdditionSide = side === 'RIGHT';
  const lines = isAdditionSide ? fileDiff.additionLines : fileDiff.deletionLines;

  for (const hunk of fileDiff.hunks) {
    const startLine = isAdditionSide ? hunk.additionStart : hunk.deletionStart;
    const lineCount = isAdditionSide ? hunk.additionCount : hunk.deletionCount;
    const lineIndex = isAdditionSide ? hunk.additionLineIndex : hunk.deletionLineIndex;

    if (line >= startLine && line < startLine + lineCount) {
      return normalizeDiffLineText(lines[lineIndex + line - startLine] ?? '');
    }
  }

  return null;
}

function getFullFileLineContent(
  fileContents: PrFileContents | null | undefined,
  side: ReviewCommentSide,
  line: number,
) {
  const fullFileLines = getFullFileSuggestionLines(fileContents, side);
  return fullFileLines?.[line - 1]?.content ?? null;
}

function getDraftSelectedText(
  fileDiffs: FileDiffMetadata[],
  target: DraftReviewCommentTarget | null,
  fileContents?: PrFileContents | null,
) {
  if (!target || target.type !== 'line') {
    return '';
  }

  if (target.startSide && target.startSide !== target.side) {
    return '';
  }

  const fileDiff = fileDiffs.find(
    (candidate) => normalizePath(candidate.name) === normalizePath(target.path),
  );
  if (!fileDiff) {
    return '';
  }

  const startLine = Math.min(target.startLine ?? target.line, target.line);
  const endLine = Math.max(target.startLine ?? target.line, target.line);
  const selectedLines: string[] = [];

  for (let line = startLine; line <= endLine; line += 1) {
    const lineContent =
      getFullFileLineContent(fileContents, target.side, line) ??
      getDiffLineContent(fileDiff, target.side, line);
    if (lineContent === null) {
      return '';
    }

    selectedLines.push(lineContent);
  }

  return selectedLines.join('\n');
}

function createSuggestionSourceLine(content: string, line: number, side: ReviewCommentSide) {
  return {
    content: normalizeDiffLineText(content),
    line,
    newLine: side === 'RIGHT' ? line : null,
    oldLine: side === 'LEFT' ? line : null,
  };
}

function getFullFileSuggestionLines(
  fileContents: PrFileContents | null | undefined,
  side: ReviewCommentSide,
) {
  if (!fileContents) {
    return null;
  }

  const sourceContent = side === 'RIGHT' ? fileContents.newContent : fileContents.oldContent;
  const lines = splitFileContentLines(sourceContent);
  if (lines.length === 0) {
    return null;
  }

  return lines.map((content, index) => createSuggestionSourceLine(content, index + 1, side));
}

function getPatchSuggestionLines(fileDiff: FileDiffMetadata, side: ReviewCommentSide) {
  const isAdditionSide = side === 'RIGHT';
  const sourceLines = isAdditionSide ? fileDiff.additionLines : fileDiff.deletionLines;

  if (!fileDiff.isPartial) {
    return sourceLines.map((content, index) =>
      createSuggestionSourceLine(content, index + 1, side),
    );
  }

  const linesByNumber = new Map<number, ReturnType<typeof createSuggestionSourceLine>>();

  for (const hunk of fileDiff.hunks) {
    const startLine = isAdditionSide ? hunk.additionStart : hunk.deletionStart;
    const lineCount = isAdditionSide ? hunk.additionCount : hunk.deletionCount;
    const lineIndex = isAdditionSide ? hunk.additionLineIndex : hunk.deletionLineIndex;

    for (let index = 0; index < lineCount; index += 1) {
      const line = startLine + index;
      linesByNumber.set(
        line,
        createSuggestionSourceLine(sourceLines[lineIndex + index] ?? '', line, side),
      );
    }
  }

  return Array.from(linesByNumber.values()).sort((a, b) => a.line - b.line);
}

function getDraftSuggestionContext(
  fileDiffs: FileDiffMetadata[],
  target: DraftReviewCommentTarget | null,
  fileContents?: PrFileContents | null,
) {
  if (!target || target.type !== 'line') {
    return null;
  }

  if (target.startSide && target.startSide !== target.side) {
    return null;
  }

  const fileDiff = fileDiffs.find(
    (candidate) => normalizePath(candidate.name) === normalizePath(target.path),
  );
  if (!fileDiff) {
    return null;
  }

  const fullFileLines = getFullFileSuggestionLines(fileContents, target.side);
  const patchLines = getPatchSuggestionLines(fileDiff, target.side);
  const lines = fullFileLines?.some((line) => line.line === target.line)
    ? fullFileLines
    : patchLines;

  if (!lines.some((line) => line.line === target.line)) {
    return null;
  }

  return { lines };
}

function getFileContentsInput(
  selectedPatch: SelectedPatch | null,
  selectedBaseSha: string | null,
  fileDiffs: FileDiffMetadata[],
  target: DraftReviewCommentTarget | null,
) {
  if (!selectedPatch || !target || target.type !== 'line') {
    return null;
  }

  const fileDiff = fileDiffs.find(
    (candidate) => normalizePath(candidate.name) === normalizePath(target.path),
  );
  if (!fileDiff) {
    return null;
  }

  return {
    providerId: selectedPatch.providerId,
    repoKey: selectedPatch.repoKey,
    number: selectedPatch.number,
    oldPath: fileDiff.prevName ?? fileDiff.name,
    newPath: fileDiff.name,
    baseSha: selectedBaseSha,
    headSha: selectedPatch.headSha,
    changeType: fileDiff.type as PrFileChangeType,
  };
}

type FloatingLineDraftEditorProps = {
  cursorPosition: ReviewCommentEditorState['cursorPosition'];
  defaultMode: CommentEditorMode;
  error: string;
  isPending: boolean;
  provider: ForgeProviderKind;
  portalRootId: string;
  selectedText: string;
  suggestionContext: ReturnType<typeof getDraftSuggestionContext>;
  target: DraftReviewCommentTarget | null;
  value: string;
  onCancel: () => void;
  onChange: (body: string) => void;
  onCursorPositionChange: (cursorPosition: ReviewCommentEditorState['cursorPosition']) => void;
  onSubmit: (body: string) => Promise<void>;
  onSubmitNow: (body: string) => Promise<void>;
};

function FloatingLineDraftEditor({
  cursorPosition,
  defaultMode,
  error,
  isPending,
  provider,
  portalRootId,
  selectedText,
  suggestionContext,
  target,
  value,
  onCancel,
  onChange,
  onCursorPositionChange,
  onSubmit,
  onSubmitNow,
}: FloatingLineDraftEditorProps) {
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const floatingNodeRef = useRef<HTMLDivElement | null>(null);
  const [hasReference, setHasReference] = useState(false);
  const portalRoot = typeof document !== 'undefined' ? document.getElementById(portalRootId) : null;
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

  return (
    <>
      <div ref={setReference} style={{ height: INITIAL_FLOATING_EDITOR_HEIGHT }} />
      <FloatingPortal root={portalRoot}>
        {hasReference && portalRoot ? (
          <div
            ref={setFloating}
            className="pointer-events-auto z-50 px-3 py-2 font-sans"
            style={floatingStyles}
          >
            <ReviewCommentEditor
              cursorPosition={cursorPosition}
              defaultMode={defaultMode}
              error={error}
              isPending={isPending}
              provider={provider}
              selectedText={selectedText}
              suggestionContext={suggestionContext}
              secondarySubmitLabel="Add comment now"
              submitLabel="Add review comment"
              target={target}
              value={value}
              onCancel={onCancel}
              onChange={onChange}
              onCursorPositionChange={onCursorPositionChange}
              onSecondarySubmit={onSubmitNow}
              onSubmit={onSubmit}
            />
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

type FloatingLineDraftEditorForTargetProps = {
  defaultMode: CommentEditorMode;
  editor: ReviewCommentEditorState;
  fileDiffs: FileDiffMetadata[];
  portalRootId: string;
  provider: ForgeProviderKind;
  selectedBaseSha: string | null;
  selectedPatch: SelectedPatch | null;
  onCancel: () => void;
  onChange: (body: string) => void;
  onCursorPositionChange: (cursorPosition: ReviewCommentEditorState['cursorPosition']) => void;
  onSubmit: (body: string) => Promise<void>;
  onSubmitNow: (body: string) => Promise<void>;
};

function FloatingLineDraftEditorForTarget({
  defaultMode,
  editor,
  fileDiffs,
  portalRootId,
  provider,
  selectedBaseSha,
  selectedPatch,
  onCancel,
  onChange,
  onCursorPositionChange,
  onSubmit,
  onSubmitNow,
}: FloatingLineDraftEditorForTargetProps) {
  const target = editor.target ?? null;
  const fileContentsInput = useMemo(
    () => getFileContentsInput(selectedPatch, selectedBaseSha, fileDiffs, target),
    [fileDiffs, selectedBaseSha, selectedPatch, target],
  );
  const fileContentsQuery = useQuery({
    ...pullRequestFileContentsQueryOptions(
      fileContentsInput ?? {
        providerId: '__idle__',
        repoKey: '__idle__',
        number: 0,
        oldPath: '',
        newPath: '',
        baseSha: null,
        headSha: '__idle__',
        changeType: 'change',
      },
    ),
    enabled: fileContentsInput !== null,
  });
  const selectedText = useMemo(
    () => getDraftSelectedText(fileDiffs, target, fileContentsQuery.data),
    [fileContentsQuery.data, fileDiffs, target],
  );
  const suggestionContext = useMemo(
    () => getDraftSuggestionContext(fileDiffs, target, fileContentsQuery.data),
    [fileContentsQuery.data, fileDiffs, target],
  );

  return (
    <FloatingLineDraftEditor
      cursorPosition={editor.cursorPosition}
      defaultMode={defaultMode}
      error={editor.error}
      isPending={editor.isSubmitting}
      portalRootId={portalRootId}
      provider={provider}
      selectedText={selectedText}
      suggestionContext={suggestionContext}
      target={target}
      value={editor.body}
      onCancel={onCancel}
      onChange={onChange}
      onCursorPositionChange={onCursorPositionChange}
      onSubmit={onSubmit}
      onSubmitNow={onSubmitNow}
    />
  );
}

function getMissingExpansion(desired: number, current: number) {
  if (desired === Number.POSITIVE_INFINITY) {
    return current === Number.POSITIVE_INFINITY ? 0 : Number.POSITIVE_INFINITY;
  }

  return Math.max(desired - current, 0);
}

function getCurrentHunkExpansion(instance: HunkExpansionOwner, hunkIndex: number) {
  return (
    instance.hunksRenderer?.getExpandedHunk?.(hunkIndex) ?? {
      fromStart: 0,
      fromEnd: 0,
    }
  );
}

function replayHunkExpansions(
  fileDiff: FileDiffMetadata,
  instance: HunkExpansionOwner,
  fileExpansions: Record<string, HunkExpansionRegion | undefined> | undefined,
) {
  if (!fileExpansions || fileDiff.isPartial) {
    return;
  }

  for (const [hunkIndexKey, desiredRegion] of Object.entries(fileExpansions)) {
    if (!desiredRegion) continue;

    const hunkIndex = Number.parseInt(hunkIndexKey, 10);
    if (!Number.isInteger(hunkIndex) || hunkIndex < 0 || hunkIndex > fileDiff.hunks.length) {
      continue;
    }

    const currentRegion = getCurrentHunkExpansion(instance, hunkIndex);
    const upExpansion = getMissingExpansion(desiredRegion.fromStart, currentRegion.fromStart);
    const downExpansion = getMissingExpansion(desiredRegion.fromEnd, currentRegion.fromEnd);

    if (upExpansion > 0 && downExpansion > 0 && upExpansion === downExpansion) {
      instance.expandHunk(hunkIndex, 'both', upExpansion);
      continue;
    }

    if (upExpansion > 0) {
      instance.expandHunk(hunkIndex, 'up', upExpansion);
    }

    const nextRegion = getCurrentHunkExpansion(instance, hunkIndex);
    const nextDownExpansion = getMissingExpansion(desiredRegion.fromEnd, nextRegion.fromEnd);

    if (nextDownExpansion > 0) {
      instance.expandHunk(hunkIndex, 'down', nextDownExpansion);
    }
  }
}

function getExpansionClick(event: MouseEvent): {
  hunkIndex: number;
  direction: ExpansionDirections;
  lineCount: number;
} | null {
  let direction: ExpansionDirections = 'both';
  let hunkIndex: number | null = null;
  let isExpansionClick = false;
  let expandAll = event.shiftKey;

  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;

    if (target.hasAttribute('data-expand-button') || target.hasAttribute('data-unmodified-lines')) {
      isExpansionClick = true;
      expandAll ||= target.hasAttribute('data-expand-all-button');

      if (target.hasAttribute('data-expand-up')) {
        direction = 'up';
      } else if (target.hasAttribute('data-expand-down')) {
        direction = 'down';
      } else {
        direction = 'both';
      }
    }

    const expandIndex = target.getAttribute('data-expand-index');
    if (expandIndex !== null && hunkIndex === null) {
      const parsedIndex = Number.parseInt(expandIndex, 10);
      if (!Number.isNaN(parsedIndex)) {
        hunkIndex = parsedIndex;
      }
    }
  }

  if (!isExpansionClick || hunkIndex === null) {
    return null;
  }

  return {
    hunkIndex,
    direction,
    lineCount: expandAll ? Number.POSITIVE_INFINITY : DIFF_EXPANSION_LINE_COUNT,
  };
}

type ReviewThreadsPanelProps = {
  threads: ReviewThread[];
  isLoading: boolean;
  error: string;
  hasSelection: boolean;
  onSelectThread: (thread: ReviewThread) => void;
};

function compareThreadLineAnnotations(
  left: DiffLineAnnotation<ReviewThreadLineAnnotation>,
  right: DiffLineAnnotation<ReviewThreadLineAnnotation>,
) {
  const lineDifference = left.lineNumber - right.lineNumber;
  if (lineDifference !== 0) {
    return lineDifference;
  }

  return (
    getReviewThreadCreatedAt(left.metadata.thread) - getReviewThreadCreatedAt(right.metadata.thread)
  );
}

function getPendingCommentId(comment: ReviewComment) {
  const match = comment.id.match(/^pending-comment:(.+)$/);
  if (!match) return null;
  return match[1] ?? null;
}

type GlobalCommentsSectionProps = {
  threads: ReviewThread[];
  isLoading: boolean;
  defaultReviewEditorMode: CommentEditorMode;
  deletingCommentIds: ReadonlySet<string>;
  patchViewerSessionKey: string | null;
  resolvingThreadId: string | null;
  provider: ForgeProviderKind;
  portalRootId: string;
  reviewEditorSessionKey: string | null;
  viewerLogin: string | null;
  registerSection: (node: HTMLDivElement | null) => void;
  registerThreadAnchor: (thread: ReviewThread, node: HTMLDivElement | null) => void;
  onDeleteComment: (thread: ReviewThread, comment: ReviewComment) => Promise<void>;
  onEditComment: (comment: ReviewComment, body: string) => Promise<void>;
  onDeletePendingComment: (comment: ReviewComment) => Promise<void>;
  onOpenNewComment: () => void;
  onReplyToThread: (thread: ReviewThread, body: string) => Promise<void>;
  onReplyToThreadNow: (thread: ReviewThread, body: string) => Promise<void>;
  onSetThreadResolved: (thread: ReviewThread, isResolved: boolean) => Promise<void>;
  onSubmitDraftComment: (editorId: string, body: string) => Promise<void>;
  onSubmitDraftCommentNow: (editorId: string, body: string) => Promise<void>;
};

function GlobalCommentsSection({
  threads,
  isLoading,
  defaultReviewEditorMode,
  deletingCommentIds,
  patchViewerSessionKey,
  resolvingThreadId,
  provider,
  portalRootId,
  reviewEditorSessionKey,
  viewerLogin,
  registerSection,
  registerThreadAnchor,
  onDeleteComment,
  onEditComment,
  onDeletePendingComment,
  onOpenNewComment,
  onReplyToThread,
  onReplyToThreadNow,
  onSetThreadResolved,
  onSubmitDraftComment,
  onSubmitDraftCommentNow,
}: GlobalCommentsSectionProps) {
  const reviewEditorSession = useReviewCommentEditorStore((state) =>
    getReviewCommentEditorSessionState(state, reviewEditorSessionKey),
  );
  const setEditorBody = useReviewCommentEditorStore((state) => state.setEditorBody);
  const setEditorCursorPosition = useReviewCommentEditorStore(
    (state) => state.setEditorCursorPosition,
  );
  const closeEditor = useReviewCommentEditorStore((state) => state.closeEditor);
  const globalDraftEditors = useMemo(
    () =>
      reviewEditorSession.editorOrder
        .map((editorId) => reviewEditorSession.editorsById[editorId])
        .filter(
          (
            editor,
          ): editor is ReviewCommentEditorState & {
            target: Extract<DraftReviewCommentTarget, { type: 'global' }>;
          } => editor != null && editor.kind === 'new' && editor.target?.type === 'global',
        ),
    [reviewEditorSession],
  );
  const hasComments = threads.length > 0;
  const hasOpenDraft = globalDraftEditors.length > 0;

  return (
    <div
      className="relative border-b border-ink-200 bg-white px-4 py-4 dark:bg-surface"
      ref={registerSection}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium text-ink-900">Global comments</h2>
          <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink-700">
            {threads.length}
          </span>
        </div>
        <button
          className="text-sm font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
          onClick={onOpenNewComment}
          type="button"
        >
          Comment
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {isLoading && !hasComments && !hasOpenDraft ? (
          <div className="text-sm text-ink-500">Loading global comments...</div>
        ) : null}

        {!isLoading && !hasComments && !hasOpenDraft ? (
          <div className="rounded-lg border border-dashed border-ink-200 bg-canvas px-4 py-5 text-sm text-ink-500">
            No global comments yet. Start the conversation before the diff.
          </div>
        ) : null}

        {threads.map((thread) => (
          <ReviewThreadCard
            key={getReviewThreadRefKey(thread)}
            containerRef={(node) => registerThreadAnchor(thread, node)}
            defaultCollapsed={thread.isResolved || thread.isOutdated}
            deletingCommentIds={deletingCommentIds}
            patchViewerSessionKey={patchViewerSessionKey}
            resolvingThreadId={resolvingThreadId}
            onDeleteComment={onDeleteComment}
            onEditComment={onEditComment}
            onDeletePendingComment={onDeletePendingComment}
            onReplyToThread={onReplyToThread}
            onReplyToThreadNow={onReplyToThreadNow}
            onSetThreadResolved={onSetThreadResolved}
            editorPortalRootId={portalRootId}
            reviewEditorSessionKey={reviewEditorSessionKey}
            thread={thread}
            viewerLogin={viewerLogin}
          />
        ))}
        {globalDraftEditors.map((editor) => (
          <FloatingLineDraftEditor
            key={editor.id}
            cursorPosition={editor.cursorPosition}
            defaultMode={defaultReviewEditorMode}
            error={editor.error}
            isPending={editor.isSubmitting}
            portalRootId={portalRootId}
            provider={provider}
            selectedText=""
            suggestionContext={null}
            target={editor.target}
            value={editor.body}
            onCancel={() => closeEditor(reviewEditorSessionKey, editor.id)}
            onChange={(body) => setEditorBody(reviewEditorSessionKey, editor.id, body)}
            onCursorPositionChange={(cursorPosition) =>
              setEditorCursorPosition(reviewEditorSessionKey, editor.id, cursorPosition ?? null)
            }
            onSubmit={(body) => onSubmitDraftComment(editor.id, body)}
            onSubmitNow={(body) => onSubmitDraftCommentNow(editor.id, body)}
          />
        ))}
      </div>
      <div id={portalRootId} className="pointer-events-none absolute inset-0 z-[4]" />
    </div>
  );
}

function ReviewThreadsPanel({
  threads,
  isLoading,
  error,
  hasSelection,
  onSelectThread,
}: ReviewThreadsPanelProps) {
  const globalThreads = getGlobalReviewThreads(threads);
  const pendingGlobalThreads = globalThreads.filter((thread) => thread.isPending);
  const activeGlobalThreads = globalThreads.filter(
    (thread) => !thread.isPending && isActiveReviewThread(thread),
  );
  const inactiveGlobalThreads = globalThreads.filter((thread) => !isActiveReviewThread(thread));
  const nonGlobalThreads = threads.filter((thread) => !isGlobalReviewThread(thread));
  const pendingThreads = nonGlobalThreads.filter((thread) => thread.isPending);
  const activeThreads = nonGlobalThreads.filter(
    (thread) => !thread.isPending && isActiveReviewThread(thread),
  );
  const resolvedThreads = [
    ...nonGlobalThreads.filter(
      (thread) => !thread.isPending && (thread.isResolved || thread.isOutdated),
    ),
    ...inactiveGlobalThreads,
  ];
  const allPendingThreads = [...pendingGlobalThreads, ...pendingThreads];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 py-3 text-xs text-ink-500 flex items-center gap-2">
        <p className="text-sm font-medium text-ink-500">Comments</p>
      </div>

      <ScrollArea
        className="min-h-0 flex-1"
        contentClassName="min-h-full px-2 pb-2"
        orientation="vertical"
        viewportClassName="bg-surface"
      >
        {!hasSelection ? (
          <div className="flex items-center justify-center py-6 text-center text-sm text-ink-500">
            Select a pull request to load comments.
          </div>
        ) : null}

        {hasSelection && isLoading ? (
          <div className="flex items-center justify-center py-6 text-center text-sm text-ink-500">
            Loading comments...
          </div>
        ) : null}

        {hasSelection && !isLoading && error ? (
          <div className="flex items-center justify-center py-6 text-center text-sm text-danger-600">
            {error}
          </div>
        ) : null}

        {hasSelection && !isLoading && !error && threads.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-center text-sm text-ink-500">
            No comments on this PR.
          </div>
        ) : null}

        {hasSelection &&
        !isLoading &&
        !error &&
        threads.length > 0 &&
        allPendingThreads.length === 0 &&
        activeThreads.length === 0 &&
        activeGlobalThreads.length === 0 ? (
          <div className="mb-3 rounded-lg px-3  text-sm text-emerald-800  dark:text-emerald-300">
            No active comments. You&apos;re in the clear!
          </div>
        ) : null}

        {activeGlobalThreads.length > 0 ? (
          <div className="mb-3">
            <div className="sticky top-0 z-10 mb-2 bg-surface px-1 py-1 text-xs font-medium tracking-wide text-ink-500">
              Global
              <span className="ml-2 text-ink-400">{activeGlobalThreads.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {activeGlobalThreads.map((thread) => (
                <ReviewThreadCard
                  key={getReviewThreadRefKey(thread)}
                  slim
                  thread={thread}
                  onClick={() => onSelectThread(thread)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {allPendingThreads.length > 0 ? (
          <div className="mb-3">
            <div className="sticky top-0 z-10 mb-2 bg-surface px-1 py-1 text-xs font-medium tracking-wide text-ink-500">
              Pending
              <span className="ml-2 text-ink-400">{allPendingThreads.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {allPendingThreads.map((thread) => (
                <ReviewThreadCard
                  key={getReviewThreadRefKey(thread)}
                  slim
                  thread={thread}
                  onClick={() => onSelectThread(thread)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {activeThreads.length > 0 ? (
          <div className="mb-3">
            <div className="sticky top-0 z-10 mb-2 bg-surface px-1 py-1 text-xs font-medium tracking-wide text-ink-500">
              Active
              <span className="ml-2 text-ink-400">{activeThreads.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {activeThreads.map((thread) => (
                <ReviewThreadCard
                  key={getReviewThreadRefKey(thread)}
                  slim
                  thread={thread}
                  onClick={() => onSelectThread(thread)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {resolvedThreads.length > 0 ? (
          <div>
            <div className="sticky top-0 z-10 mb-2 bg-surface px-1 py-1 text-xs font-medium tracking-wide text-ink-500">
              Inactive
              <span className="ml-2 text-ink-400">{resolvedThreads.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {resolvedThreads.map((thread) => (
                <ReviewThreadCard
                  key={getReviewThreadRefKey(thread)}
                  slim
                  thread={thread}
                  onClick={() => onSelectThread(thread)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </ScrollArea>
    </div>
  );
}

function PendingReviewBar({
  count,
  error,
  isLoading,
  isPublishing,
  isDiscarding,
  provider,
  onPublish,
  onDiscard,
}: {
  count: number;
  error: string;
  isLoading: boolean;
  isPublishing: boolean;
  isDiscarding: boolean;
  provider: ForgeProviderKind;
  onPublish: (action: PendingReviewSubmitAction, summary: string) => void;
  onDiscard: () => void;
}) {
  const [action, setAction] = useState<PendingReviewSubmitAction>('comment');
  const [summary, setSummary] = useState('');
  const [isReviewTypeSelectOpen, setReviewTypeSelectOpen] = useState(false);

  const isGitLab = provider === 'gitlab';
  const submitReviewTypeOptions: Array<{ value: PendingReviewSubmitAction; label: string }> = [
    { value: 'comment', label: 'Comment' },
    { value: 'approve', label: 'Approve' },
    { value: 'request_changes', label: 'Request changes' },
  ];

  function publishReview() {
    onPublish(action, summary);
  }

  if (count === 0 && !error) {
    return null;
  }

  return (
    <div className="group pointer-events-auto flex w-[min(44rem,calc(100vw-3rem))] flex-col gap-0 overflow-hidden rounded-lg border border-ink-200 bg-canvas/95 text-sm shadow-lg backdrop-blur transition-all duration-150 ease-out">
      {isGitLab ? (
        <div
          className={cx(
            'grid max-h-0 grid-rows-[0fr] border-b border-transparent px-3 opacity-0 transition-all duration-150 ease-out group-focus-within:max-h-64 group-focus-within:grid-rows-[1fr] group-focus-within:border-ink-200 group-focus-within:pb-3 group-focus-within:pt-3 group-focus-within:opacity-100 group-hover:max-h-64 group-hover:grid-rows-[1fr] group-hover:border-ink-200 group-hover:pb-3 group-hover:pt-3 group-hover:opacity-100',
            isReviewTypeSelectOpen &&
              'max-h-64 grid-rows-[1fr] border-ink-200 pb-3 pt-3 opacity-100',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-600">Review type</span>
                <Select
                  disabled={isPublishing || isDiscarding}
                  items={submitReviewTypeOptions}
                  open={isReviewTypeSelectOpen}
                  value={action}
                  onOpenChange={(open) => setReviewTypeSelectOpen(open)}
                  onValueChange={(value) => setAction(value as PendingReviewSubmitAction)}
                >
                  <SelectTrigger className="w-full bg-canvas text-ink-900" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {submitReviewTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-600">Notes</span>
                <textarea
                  className="min-h-20 resize-y rounded-md border border-ink-200 bg-canvas px-2 py-1.5 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:border-ink-400"
                  disabled={isPublishing || isDiscarding}
                  placeholder="Add notes"
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="font-medium text-ink-900">
            {count} pending review {count === 1 ? 'comment' : 'comments'}
          </span>
          {isLoading ? <span className="text-xs text-ink-500">Refreshing...</span> : null}
          {error ? <span className="text-xs text-danger-600">{error}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-ink-200 bg-surface px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-canvasDark disabled:opacity-60"
            disabled={count === 0 || isPublishing || isDiscarding}
            onClick={onDiscard}
            type="button"
          >
            {isDiscarding ? 'Discarding...' : 'Discard'}
          </button>
          <button
            className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-neutral-200"
            disabled={count === 0 || isPublishing || isDiscarding}
            onClick={publishReview}
            type="button"
          >
            {isPublishing ? 'Submitting...' : 'Submit review'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PatchFileDiffItem({
  fileDiff,
  fileIndex,
}: {
  fileDiff: FileDiffMetadata;
  fileIndex: number;
}) {
  const {
    defaultReviewEditorMode,
    deletingCommentIds,
    patchViewerSessionKey,
    resolvingThreadId,
    diffNavigator,
    isInactiveFileCommentsExpanded,
    parsedFileDiffs,
    qualityFindingsByFile,
    registerFileCommentsSection,
    registerThreadAnchor,
    reviewEditorSessionKey,
    reviewThreadsByFile,
    scrollToFileCommentsSection,
    selectedBaseSha,
    selectedPatch,
    selectedProvider,
    setInactiveFileCommentsExpanded,
    viewerLogin,
    handleDeleteComment,
    handleSetThreadResolved,
    handleEditComment,
    handleDeletePendingComment,
    handleFileDiffPostRender,
    handleReplyToThread,
    handleReplyToThreadNow,
    handleSubmitDraftComment,
    handleSubmitDraftCommentNow,
  } = usePatchFileDiffItemContext();
  const reviewEditorSession = useReviewCommentEditorStore((state) =>
    getReviewCommentEditorSessionState(state, reviewEditorSessionKey),
  );
  const openNewEditor = useReviewCommentEditorStore((state) => state.openNewEditor);
  const setEditorBody = useReviewCommentEditorStore((state) => state.setEditorBody);
  const setEditorCursorPosition = useReviewCommentEditorStore(
    (state) => state.setEditorCursorPosition,
  );
  const closeEditor = useReviewCommentEditorStore((state) => state.closeEditor);
  const newCommentEditors = useMemo(
    () =>
      reviewEditorSession.editorOrder
        .map((editorId) => reviewEditorSession.editorsById[editorId])
        .filter(
          (editor): editor is ReviewCommentEditorState =>
            editor != null && editor.kind === 'new' && editor.target != null,
        ),
    [reviewEditorSession],
  );
  const fileReviewThreads = getFileReviewThreadsForPath(reviewThreadsByFile, fileDiff.name);
  const fileQualityFindings = getFileQualityFindings(qualityFindingsByFile, fileDiff.name);
  const normalizedFilePath = normalizePath(fileDiff.name);
  const inactiveFileCommentsExpanded = isInactiveFileCommentsExpanded(normalizedFilePath);
  const lineDraftPortalRootId = `line-draft-editor-root-${selectedPatch.number}-${fileIndex}`;
  const fileCommentsSlotName = `file-comments-${selectedPatch.number}-${fileIndex}`;
  const [fileCommentsPortalHost, setFileCommentsPortalHost] = useState<HTMLDivElement | null>(null);
  const fileCommentsPortalHostRef = useRef<HTMLDivElement | null>(null);
  const lineThreadAnnotations: DiffLineAnnotation<PatchLineAnnotation>[] = [
    ...fileReviewThreads.activeLineAnnotations.map((annotation) => ({
      ...annotation,
      metadata: {
        ...annotation.metadata,
        portalRootId: lineDraftPortalRootId,
      },
    })),
    ...fileReviewThreads.inactiveLineAnnotations.map((annotation) => ({
      ...annotation,
      metadata: {
        ...annotation.metadata,
        defaultCollapsed: true,
        portalRootId: lineDraftPortalRootId,
      },
    })),
  ].sort(compareThreadLineAnnotations);
  const lineQualityAnnotations: DiffLineAnnotation<PatchLineAnnotation>[] =
    fileQualityFindings.inlineAnnotations.map((annotation) => ({
      ...annotation,
      metadata: {
        ...annotation.metadata,
        kind: 'quality' as const,
      },
    }));
  const lineDraftEditors = newCommentEditors.filter(
    (
      editor,
    ): editor is ReviewCommentEditorState & {
      target: Extract<DraftReviewCommentTarget, { type: 'line' }>;
    } => editor.target?.type === 'line' && normalizePath(editor.target.path) === normalizedFilePath,
  );
  const fileDraftEditors = newCommentEditors.filter(
    (
      editor,
    ): editor is ReviewCommentEditorState & {
      target: Extract<DraftReviewCommentTarget, { type: 'file' }>;
    } => editor.target?.type === 'file' && normalizePath(editor.target.path) === normalizedFilePath,
  );
  const latestLineDraft = lineDraftEditors.at(-1);
  const lineDraft: Extract<DraftReviewCommentTarget, { type: 'line' }> | null =
    latestLineDraft?.target ?? null;
  const lineAnnotations: DiffLineAnnotation<PatchLineAnnotation>[] =
    lineDraftEditors.length > 0
      ? [
          ...lineThreadAnnotations,
          ...lineQualityAnnotations,
          ...lineDraftEditors.map((editor) => ({
            side: toSelectionSide(editor.target.side),
            lineNumber: editor.target.line,
            metadata: {
              kind: 'draft' as const,
              editorId: editor.id,
              portalRootId: lineDraftPortalRootId,
            },
          })),
        ]
      : [...lineThreadAnnotations, ...lineQualityAnnotations];
  const selectedLines: SelectedLineRange | null = lineDraft
    ? {
        start: lineDraft.startLine ?? lineDraft.line,
        side: toSelectionSide(lineDraft.startSide ?? lineDraft.side),
        end: lineDraft.line,
        endSide: toSelectionSide(lineDraft.side),
      }
    : null;
  const shouldRenderFileCommentsInHeader =
    fileReviewThreads.fileThreadCount > 0 ||
    fileDraftEditors.length > 0 ||
    fileQualityFindings.fileFindings.length > 0;
  const { additions, deletions } = getFileDiffLineCounts(fileDiff);
  const changeType = fileDiff.type as PrFileChangeType;
  const { iconClassName: fileChangeIconClassName, label: fileChangeLabel } =
    getFileChangeTypePresentation(changeType);

  function openFileCommentDraft() {
    openNewEditor(reviewEditorSessionKey, createFileDraftTarget(fileDiff));
    scrollToFileCommentsSection(normalizedFilePath);
  }

  function openLineCommentDraft(range: SelectedLineRange) {
    const startSide = range.side ?? range.endSide;
    const endSide = range.endSide ?? range.side;
    if (!startSide || !endSide) {
      return;
    }

    const startsFirst = range.start <= range.end;
    const startLine = startsFirst ? range.start : range.end;
    const startGithubSide = toGithubSide(startsFirst ? startSide : endSide);
    const endLine = startsFirst ? range.end : range.start;
    const endGithubSide = toGithubSide(startsFirst ? endSide : startSide);

    openNewEditor(reviewEditorSessionKey, {
      type: 'line',
      path: fileDiff.name,
      line: endLine,
      side: endGithubSide,
      startLine: startLine !== endLine ? startLine : null,
      startSide: startLine !== endLine ? startGithubSide : null,
    });
  }

  function renderReviewThreadSummary() {
    const hasDraft = newCommentEditors.some(
      (editor) =>
        editor.target?.type === 'file' && normalizePath(editor.target.path) === normalizedFilePath,
    );

    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
        {fileReviewThreads.totalCount > 0 ? (
          <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-700">
            {fileReviewThreads.totalCount} threads
          </span>
        ) : null}
        {fileReviewThreads.totalCount > 0 ? (
          <span
            className={cx(
              'rounded-full px-2 py-0.5',
              fileReviewThreads.unresolvedCount > 0
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
            )}
          >
            {fileReviewThreads.unresolvedCount > 0
              ? `${fileReviewThreads.unresolvedCount} open`
              : 'All resolved'}
          </span>
        ) : null}
        {hasDraft ? (
          <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-700">Draft open</span>
        ) : null}
        {fileReviewThreads.fileThreadCount > 0 ? (
          <span className="text-ink-500">{fileReviewThreads.fileThreadCount} file comments</span>
        ) : null}
        {fileQualityFindings.totalCount > 0 ? (
          <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-700">
            {fileQualityFindings.totalCount} findings
          </span>
        ) : null}
        <button
          className="font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
          onClick={openFileCommentDraft}
          type="button"
        >
          File comment
        </button>
      </div>
    );
  }

  function renderFileCommentsContent() {
    if (!shouldRenderFileCommentsInHeader) {
      return null;
    }

    return (
      <div
        className="mt-3 flex flex-col gap-3 border-t border-ink-200 pt-3"
        ref={(node) => registerFileCommentsSection(normalizedFilePath, node)}
      >
        {fileDraftEditors.map((editor) => (
          <FloatingLineDraftEditor
            key={editor.id}
            cursorPosition={editor.cursorPosition}
            defaultMode={defaultReviewEditorMode}
            error={editor.error}
            isPending={editor.isSubmitting}
            portalRootId={lineDraftPortalRootId}
            provider={selectedProvider}
            selectedText=""
            suggestionContext={null}
            target={editor.target}
            value={editor.body}
            onCancel={() => closeEditor(reviewEditorSessionKey, editor.id)}
            onChange={(body) => setEditorBody(reviewEditorSessionKey, editor.id, body)}
            onCursorPositionChange={(cursorPosition) =>
              setEditorCursorPosition(reviewEditorSessionKey, editor.id, cursorPosition ?? null)
            }
            onSubmit={(body) => handleSubmitDraftComment(editor.id, body)}
            onSubmitNow={(body) => handleSubmitDraftCommentNow(editor.id, body)}
          />
        ))}
        {fileQualityFindings.fileFindings.length > 0 ? (
          <div className="flex flex-col gap-2">
            {fileQualityFindings.fileFindings.map((finding) => (
              <div
                className="rounded-lg border border-ink-200 bg-canvas px-3 py-2"
                key={finding.id}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-ink-900">{finding.title}</span>
                  <span className="text-ink-500">{finding.sourceName}</span>
                  {finding.line !== null ? (
                    <span className="text-ink-500">L{finding.line}</span>
                  ) : null}
                  {finding.externalUrl ? (
                    <a
                      className="font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
                      href={finding.externalUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open
                    </a>
                  ) : null}
                </div>
                {finding.message ? (
                  <p className="mt-1 text-xs text-ink-600">{finding.message}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {fileReviewThreads.activeFileThreads.map((thread) => (
          <ReviewThreadCard
            key={getReviewThreadRefKey(thread)}
            containerRef={(node) => registerThreadAnchor(thread, node)}
            deletingCommentIds={deletingCommentIds}
            patchViewerSessionKey={patchViewerSessionKey}
            resolvingThreadId={resolvingThreadId}
            onDeleteComment={handleDeleteComment}
            onEditComment={handleEditComment}
            onDeletePendingComment={handleDeletePendingComment}
            onReplyToThread={handleReplyToThread}
            onReplyToThreadNow={handleReplyToThreadNow}
            onSetThreadResolved={handleSetThreadResolved}
            editorPortalRootId={lineDraftPortalRootId}
            reviewEditorSessionKey={reviewEditorSessionKey}
            thread={thread}
            viewerLogin={viewerLogin}
          />
        ))}
        {fileReviewThreads.inactiveFileThreads.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-ink-200 pt-3">
            <button
              className="self-start text-xs font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
              onClick={() =>
                setInactiveFileCommentsExpanded(normalizedFilePath, !inactiveFileCommentsExpanded)
              }
              type="button"
            >
              {inactiveFileCommentsExpanded ? 'Hide inactive comments' : 'Show inactive comments'} (
              {fileReviewThreads.inactiveFileThreads.length})
            </button>
            {inactiveFileCommentsExpanded ? (
              <div className="flex flex-col gap-3">
                {fileReviewThreads.inactiveFileThreads.map((thread) => (
                  <ReviewThreadCard
                    key={getReviewThreadRefKey(thread)}
                    containerRef={(node) => registerThreadAnchor(thread, node)}
                    deletingCommentIds={deletingCommentIds}
                    patchViewerSessionKey={patchViewerSessionKey}
                    resolvingThreadId={resolvingThreadId}
                    onDeleteComment={handleDeleteComment}
                    onEditComment={handleEditComment}
                    onDeletePendingComment={handleDeletePendingComment}
                    onReplyToThread={handleReplyToThread}
                    onReplyToThreadNow={handleReplyToThreadNow}
                    onSetThreadResolved={handleSetThreadResolved}
                    editorPortalRootId={lineDraftPortalRootId}
                    reviewEditorSessionKey={reviewEditorSessionKey}
                    thread={thread}
                    viewerLogin={viewerLogin}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderCustomFileHeader() {
    return (
      <div className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3 text-sm text-ink-900">
            <span
              aria-label={fileChangeLabel}
              className={cx(
                'inline-flex shrink-0 items-center justify-center',
                fileChangeIconClassName,
              )}
              title={fileChangeLabel}
            >
              <PierreChangeTypeIcon changeType={changeType} className="size-4" />
            </span>
            {fileDiff.prevName ? (
              <>
                <span className="truncate text-ink-500">{fileDiff.prevName}</span>
                <PierreRenameArrowIcon className="size-4 shrink-0 text-ink-400" />
              </>
            ) : null}
            <span className="truncate font-medium">{fileDiff.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {deletions > 0 || additions === 0 ? (
              <span className="font-mono text-red-600 dark:text-red-400">-{deletions}</span>
            ) : null}
            {additions > 0 || deletions === 0 ? (
              <span className="font-mono text-emerald-600 dark:text-emerald-400">+{additions}</span>
            ) : null}
            {renderReviewThreadSummary()}
          </div>
        </div>
      </div>
    );
  }

  function syncFileCommentsPortalHost(node: HTMLElement) {
    const shadowRoot = node.shadowRoot;
    if (!shadowRoot) {
      if (fileCommentsPortalHostRef.current) {
        fileCommentsPortalHostRef.current = null;
        setFileCommentsPortalHost(null);
      }
      return;
    }

    const currentPortalHost = fileCommentsPortalHostRef.current;
    if (!shouldRenderFileCommentsInHeader) {
      shadowRoot
        .querySelector(`[data-file-comments-slot-container="${fileCommentsSlotName}"]`)
        ?.remove();
      currentPortalHost?.remove();
      if (currentPortalHost) {
        fileCommentsPortalHostRef.current = null;
        setFileCommentsPortalHost(null);
      }
      return;
    }

    const headerElement = shadowRoot.querySelector('[data-diffs-header]');
    if (!(headerElement instanceof HTMLElement)) {
      return;
    }

    let slotContainer: HTMLDivElement | null = shadowRoot.querySelector(
      `[data-file-comments-slot-container="${fileCommentsSlotName}"]`,
    );
    if (!(slotContainer instanceof HTMLDivElement)) {
      slotContainer = document.createElement('div');
      slotContainer.dataset.fileCommentsSlotContainer = fileCommentsSlotName;

      const slotElement = document.createElement('slot');
      slotElement.name = fileCommentsSlotName;
      slotContainer.appendChild(slotElement);

      const preElement = shadowRoot.querySelector('pre');
      if (preElement?.parentNode === shadowRoot) {
        shadowRoot.insertBefore(slotContainer, preElement);
      } else {
        headerElement.insertAdjacentElement('afterend', slotContainer);
      }
    }

    let portalHost = Array.from(node.children).find(
      (child): child is HTMLDivElement =>
        child instanceof HTMLDivElement &&
        child.dataset.fileCommentsSlotHost === fileCommentsSlotName,
    );
    if (!portalHost) {
      portalHost = document.createElement('div');
      portalHost.dataset.fileCommentsSlotHost = fileCommentsSlotName;
      portalHost.slot = fileCommentsSlotName;
      node.appendChild(portalHost);
    }

    if (portalHost !== fileCommentsPortalHostRef.current) {
      fileCommentsPortalHostRef.current = portalHost;
      setFileCommentsPortalHost(portalHost);
    }
  }

  function renderReviewThreadAnnotations(annotation: DiffLineAnnotation<PatchLineAnnotation>) {
    if ('kind' in annotation.metadata && annotation.metadata.kind === 'draft') {
      const draftAnnotation = annotation.metadata;
      const editor = getReviewCommentEditorSessionState(
        useReviewCommentEditorStore.getState(),
        reviewEditorSessionKey,
      ).editorsById[draftAnnotation.editorId];
      if (!editor) {
        return null;
      }

      return (
        <FloatingLineDraftEditorForTarget
          defaultMode={defaultReviewEditorMode}
          editor={editor}
          fileDiffs={parsedFileDiffs}
          portalRootId={draftAnnotation.portalRootId}
          provider={selectedProvider}
          selectedBaseSha={selectedBaseSha}
          selectedPatch={selectedPatch}
          onCancel={() => closeEditor(reviewEditorSessionKey, draftAnnotation.editorId)}
          onChange={(body) => setEditorBody(reviewEditorSessionKey, draftAnnotation.editorId, body)}
          onCursorPositionChange={(cursorPosition) =>
            setEditorCursorPosition(
              reviewEditorSessionKey,
              draftAnnotation.editorId,
              cursorPosition ?? null,
            )
          }
          onSubmitNow={(body) => handleSubmitDraftCommentNow(draftAnnotation.editorId, body)}
          onSubmit={(body) => handleSubmitDraftComment(draftAnnotation.editorId, body)}
        />
      );
    }

    if ('kind' in annotation.metadata && annotation.metadata.kind === 'quality') {
      const finding = annotation.metadata.finding;

      return (
        <div className="rounded-lg border border-ink-200 bg-canvas px-3 py-2 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-ink-900">{finding.title}</span>
            <span className="text-ink-500">{finding.sourceName}</span>
            {finding.externalUrl ? (
              <a
                className="font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
                href={finding.externalUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open
              </a>
            ) : null}
          </div>
          {finding.message ? <p className="mt-1 text-xs text-ink-600">{finding.message}</p> : null}
        </div>
      );
    }

    const threadAnnotation = annotation.metadata as ReviewThreadLineAnnotation;

    return (
      <ReviewThreadCard
        compact
        containerRef={(node) => registerThreadAnchor(threadAnnotation.thread, node)}
        defaultCollapsed={threadAnnotation.defaultCollapsed}
        deletingCommentIds={deletingCommentIds}
        patchViewerSessionKey={patchViewerSessionKey}
        resolvingThreadId={resolvingThreadId}
        editorPortalRootId={threadAnnotation.portalRootId}
        onDeleteComment={handleDeleteComment}
        onEditComment={handleEditComment}
        onDeletePendingComment={handleDeletePendingComment}
        onReplyToThread={handleReplyToThread}
        onReplyToThreadNow={handleReplyToThreadNow}
        onSetThreadResolved={handleSetThreadResolved}
        reviewEditorSessionKey={reviewEditorSessionKey}
        thread={threadAnnotation.thread}
        viewerLogin={viewerLogin}
      />
    );
  }

  const fileDiffElement = (
    <FileDiff
      fileDiff={fileDiff}
      metrics={VIRTUAL_FILE_METRICS}
      lineAnnotations={lineAnnotations}
      selectedLines={selectedLines}
      style={DIFF_FONT_STYLE}
      options={{
        theme: {
          dark: 'pierre-dark',
          light: 'pierre-light',
        },
        diffStyle: 'unified',
        diffIndicators: 'bars',
        lineDiffType: 'word',
        overflow: 'scroll',
        expansionLineCount: DIFF_EXPANSION_LINE_COUNT,
        collapsedContextThreshold: DIFF_COLLAPSED_CONTEXT_THRESHOLD,
        unsafeCSS: `
          [data-overflow='scroll'],
          [data-code] {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }

          [data-overflow='scroll']::-webkit-scrollbar,
          [data-code]::-webkit-scrollbar {
            display: none;
            width: 0;
            height: 0;
          }

          [data-code]::-webkit-scrollbar-track,
          [data-code]::-webkit-scrollbar-corner,
          [data-code]::-webkit-scrollbar-thumb,
          [data-diff]:hover [data-code]::-webkit-scrollbar-thumb,
          [data-file]:hover [data-code]::-webkit-scrollbar-thumb {
            background-color: transparent !important;
          }

          [data-diffs-header='default'],
          [data-diffs-header='custom'] {
            position: sticky;
            top: 0;
            z-index: 5;
            background-color: var(--diffs-bg);
            box-shadow: inset 0 -1px 0 var(--diffs-bg-context);
          }

          [data-file-comments-slot-container] {
            display: block;
            background-color: var(--diffs-bg);
          }

          :host-context(.macos) [data-diffs-header='default'],
          :host-context(.macos) [data-diffs-header='custom'] {
            min-height: ${TOP_BAR_MACOS_HEIGHT};
          }

          :host-context(.wco) [data-diffs-header='default'],
          :host-context(.wco) [data-diffs-header='custom'] {
            min-height: ${TOP_BAR_WCO_HEIGHT};
          }

          [data-column-number][data-selected-line]::before {
            background-color: #f59e0b;
            background-image: none;
          }

        `,
        enableGutterUtility: true,
        onGutterUtilityClick: openLineCommentDraft,
        onPostRender: (node, instance) => {
          syncFileCommentsPortalHost(node);
          handleFileDiffPostRender(node, instance, fileDiff, normalizedFilePath);
        },
      }}
      renderAnnotation={renderReviewThreadAnnotations}
      renderCustomHeader={renderCustomFileHeader}
      renderHeaderMetadata={renderReviewThreadSummary}
    />
  );

  return (
    <div
      className="relative min-w-0 w-full"
      data-file-path={fileDiff.name}
      ref={(node) => diffNavigator.registerDiffNode(fileDiff.name, node)}
    >
      {lineAnnotations.length > 0 ? (
        <VirtualizerContext.Provider value={undefined}>
          {fileDiffElement}
        </VirtualizerContext.Provider>
      ) : (
        fileDiffElement
      )}
      {fileCommentsPortalHost
        ? createPortal(
            <div className="bg-white px-4 pb-3 dark:bg-surface">{renderFileCommentsContent()}</div>,
            fileCommentsPortalHost,
          )
        : null}
      <div id={lineDraftPortalRootId} className="pointer-events-none absolute inset-0 z-[4]" />
    </div>
  );
}

function PatchViewerMain({
  selectedPrKey,
  selectedPr,
  selectedPatch,
  selectedBaseSha,
  isGitDiffMode,
  isPatchLoading,
  isDark,
  patchError,
  approvalState,
  isApprovalStateLoading,
  approvalStateError,
  changedFiles,
  isChangedFilesLoading,
  changedFilesError,
  globalReviewThreads,
  reviewThreadsByFile,
  reviewThreads,
  isReviewThreadsLoading,
  reviewThreadsError,
  pendingReview,
  isPendingReviewLoading,
  pendingReviewError,
  qualityReport,
  isQualityReportLoading,
  qualityReportError,
  qualityFindingsByFile,
  displayedQualityInlineCount,
  displayedQualityFileCount,
  unmappedQualityFindings,
  parsedPatch,
  fileStats,
  gitStatus,
}: PatchViewerMainProps) {
  const backgroundQuery = useQuery(appearanceBackgroundQueryOptions());
  const reviewEditorSettingsQuery = useQuery(reviewEditorSettingsQueryOptions());
  const defaultReviewEditorMode = reviewEditorSettingsQuery.data?.defaultMode ?? 'rich-text';
  const patchViewerSessionKey = selectedPrKey
    ? `${selectedPrKey}:${isGitDiffMode ? 'git' : 'provider'}`
    : null;
  const reviewEditorSessionKey = selectedPrKey;
  const ensureSession = usePatchViewerStore((state) => state.ensureSession);
  const highlightThread = usePatchViewerStore((state) => state.highlightThread);
  const setPendingScrollPath = usePatchViewerStore((state) => state.setPendingScrollPath);
  const setScrollTop = usePatchViewerStore((state) => state.setScrollTop);
  const setThreadExpanded = usePatchViewerStore((state) => state.setThreadExpanded);
  const recordHunkExpansion = usePatchViewerStore((state) => state.recordHunkExpansion);
  const setEditorError = useReviewCommentEditorStore((state) => state.setEditorError);
  const setEditorSubmitting = useReviewCommentEditorStore((state) => state.setEditorSubmitting);
  const closeEditor = useReviewCommentEditorStore((state) => state.closeEditor);
  const inactiveFileCommentsScopeKey = [
    patchViewerSessionKey ?? '',
    selectedPatch?.providerId ?? '',
    selectedPatch?.repoKey ?? '',
    selectedPatch?.number ?? '',
    selectedPatch?.headSha ?? '',
  ].join('::');
  const [inactiveFileCommentsState, setInactiveFileCommentsState] = useState<{
    byPath: Record<string, boolean>;
    scopeKey: string;
  }>({
    byPath: {},
    scopeKey: inactiveFileCommentsScopeKey,
  });
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const restoringScrollSessionKeyRef = useRef<string | null>(null);
  const cancelScrollRestoreRef = useRef<(() => void) | null>(null);
  const cancelFileCommentsSectionScrollRef = useRef<(() => void) | null>(null);
  const cancelThreadScrollRef = useRef<(() => void) | null>(null);
  const previousSessionKeyRef = useRef<string | null>(patchViewerSessionKey);
  const hunkExpansionNodesRef = useRef<WeakSet<HTMLElement>>(new WeakSet());
  const fileCommentsSectionNodesRef = useRef<Map<string, HTMLElement>>(new Map());
  const globalCommentsSectionNodeRef = useRef<HTMLDivElement | null>(null);
  const globalCommentsPortalRootId = selectedPatch
    ? `global-comments-editor-root-${selectedPatch.number}`
    : 'global-comments-editor-root-idle';
  const threadAnchorNodesRef = useRef<Map<string, HTMLElement>>(new Map());
  const hasSelection = selectedPrKey !== null;
  const isDiffReady = !isPatchLoading && !patchError && !parsedPatch.parseError;
  const shouldShowCommentsPanel =
    hasSelection &&
    (isReviewThreadsLoading || Boolean(reviewThreadsError) || reviewThreads.length > 0);
  const navigator = useDiffNavigator({
    sessionKey: patchViewerSessionKey,
    prKey: selectedPrKey,
    isDiffReady,
    hasDiffError: Boolean(patchError || parsedPatch.parseError),
  });
  const {
    createCommentMutation,
    createPendingGlobalMutation,
    createPendingReplyMutation,
    createPendingThreadMutation,
    deleteCommentMutation,
    deletePendingCommentMutation,
    discardPendingReviewMutation,
    publishPendingReviewMutation,
    replyCommentMutation,
    setResolvedMutation,
    updatePendingCommentMutation,
    updateCommentMutation,
    viewerLogin,
  } = usePullRequestReviewCommentMutations(
    selectedPatch
      ? {
          providerId: selectedPatch.providerId,
          repoKey: selectedPatch.repoKey,
          number: selectedPatch.number,
          headSha: selectedPatch.headSha,
        }
      : null,
  );
  const { approveMutation, removeApprovalMutation } = usePullRequestApprovalMutations(selectedPr);
  const [deletingCommentIds, setDeletingCommentIds] = useState<Set<string>>(() => new Set());
  const resolvingThreadId = setResolvedMutation.isPending
    ? (setResolvedMutation.variables?.threadId ?? null)
    : null;
  const selectedProvider = selectedPatch
    ? providerFromProviderId(selectedPatch.providerId)
    : 'github';
  const handleVirtualizerRootChange = useCallback((node: HTMLDivElement | null) => {
    scrollRootRef.current = node;
  }, []);

  const handlePatchScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (restoringScrollSessionKeyRef.current === patchViewerSessionKey) {
        return;
      }

      setScrollTop(patchViewerSessionKey, event.currentTarget.scrollTop);
    },
    [patchViewerSessionKey, setScrollTop],
  );
  const expandedInactiveFileCommentsByPath = useMemo(
    () =>
      inactiveFileCommentsState.scopeKey === inactiveFileCommentsScopeKey
        ? inactiveFileCommentsState.byPath
        : {},
    [inactiveFileCommentsScopeKey, inactiveFileCommentsState],
  );

  const isInactiveFileCommentsExpanded = useCallback(
    (filePath: string) => Boolean(expandedInactiveFileCommentsByPath[filePath]),
    [expandedInactiveFileCommentsByPath],
  );

  const setInactiveFileCommentsExpanded = useCallback(
    (filePath: string, expanded: boolean) => {
      setInactiveFileCommentsState((current) => {
        const currentByPath =
          current.scopeKey === inactiveFileCommentsScopeKey ? current.byPath : {};

        if (Boolean(currentByPath[filePath]) === expanded) {
          return current;
        }

        if (expanded) {
          return {
            byPath: {
              ...currentByPath,
              [filePath]: true,
            },
            scopeKey: inactiveFileCommentsScopeKey,
          };
        }

        const next = { ...currentByPath };
        delete next[filePath];
        return {
          byPath: next,
          scopeKey: inactiveFileCommentsScopeKey,
        };
      });
    },
    [inactiveFileCommentsScopeKey],
  );

  const registerFileCommentsSection = useCallback(
    (filePath: string, node: HTMLDivElement | null) => {
      if (node) {
        fileCommentsSectionNodesRef.current.set(filePath, node);
        return;
      }

      fileCommentsSectionNodesRef.current.delete(filePath);
    },
    [],
  );

  const registerGlobalCommentsSection = useCallback((node: HTMLDivElement | null) => {
    globalCommentsSectionNodeRef.current = node;
  }, []);

  const scrollToFileCommentsSection = useCallback((filePath: string) => {
    cancelFileCommentsSectionScrollRef.current?.();
    cancelFileCommentsSectionScrollRef.current = null;

    let attempts = 0;
    let cancelFrame: (() => void) | null = null;
    let cancelled = false;

    const stop = () => {
      cancelled = true;
      cancelFrame?.();
      cancelFrame = null;
      cancelFileCommentsSectionScrollRef.current = null;
    };

    const scrollToSection = () => {
      if (cancelled) {
        return;
      }

      const node = fileCommentsSectionNodesRef.current.get(filePath);
      if (node?.isConnected) {
        node.scrollIntoView({
          behavior: 'auto',
          block: 'center',
          inline: 'nearest',
        });
        stop();
        return;
      }

      attempts += 1;
      if (attempts >= SCROLL_RESTORE_MAX_ATTEMPTS) {
        stop();
        return;
      }

      cancelFrame = scheduleNextFrame(scrollToSection);
    };

    cancelFileCommentsSectionScrollRef.current = stop;
    scrollToSection();
  }, []);

  const registerThreadAnchor = useCallback((thread: ReviewThread, node: HTMLDivElement | null) => {
    const threadKey = getReviewThreadRefKey(thread);

    if (node) {
      threadAnchorNodesRef.current.set(threadKey, node);
      return;
    }

    threadAnchorNodesRef.current.delete(threadKey);
  }, []);

  const handleSelectReviewThread = useCallback(
    (thread: ReviewThread) => {
      cancelThreadScrollRef.current?.();
      cancelThreadScrollRef.current = null;

      if (isGlobalReviewThread(thread)) {
        globalCommentsSectionNodeRef.current?.scrollIntoView({
          behavior: 'auto',
          block: 'start',
          inline: 'nearest',
        });
      } else {
        navigator.tree.onSelectFile(thread.path);
        const normalizedFilePath = normalizePath(thread.path);

        if (isFileReviewThread(thread) && !isActiveReviewThread(thread)) {
          setInactiveFileCommentsExpanded(normalizedFilePath, true);
        }
      }

      const threadKey = getReviewThreadRefKey(thread);
      setThreadExpanded(patchViewerSessionKey, threadKey, true);
      let attempts = 0;
      let cancelFrame: (() => void) | null = null;
      let cancelled = false;

      const stop = () => {
        cancelled = true;
        cancelFrame?.();
        cancelFrame = null;
        cancelThreadScrollRef.current = null;
      };

      const scrollToThread = () => {
        if (cancelled) {
          return;
        }

        const node = threadAnchorNodesRef.current.get(threadKey);
        if (node?.isConnected) {
          node.scrollIntoView({
            behavior: 'auto',
            block: 'center',
            inline: 'nearest',
          });
          highlightThread(patchViewerSessionKey, threadKey);
          stop();
          return;
        }

        attempts += 1;
        if (attempts >= SCROLL_RESTORE_MAX_ATTEMPTS) {
          stop();
          return;
        }

        cancelFrame = scheduleNextFrame(scrollToThread);
      };

      cancelThreadScrollRef.current = stop;
      if (isGlobalReviewThread(thread)) {
        cancelFrame = scheduleNextFrame(scrollToThread);
        return;
      }

      scrollToThread();
    },
    [
      highlightThread,
      navigator.tree,
      patchViewerSessionKey,
      setInactiveFileCommentsExpanded,
      setThreadExpanded,
    ],
  );

  const handleFileDiffPostRender = useCallback(
    (
      node: HTMLElement,
      instance: PierreFileDiffInstance<PatchLineAnnotation>,
      fileDiff: FileDiffMetadata,
      normalizedFilePath: string,
    ) => {
      node.dataset.patchViewerSessionKey = patchViewerSessionKey ?? '';
      node.dataset.patchViewerFilePath = normalizedFilePath;

      if (!hunkExpansionNodesRef.current.has(node)) {
        const clickListener = (event: MouseEvent) => {
          const expansion = getExpansionClick(event);
          if (!expansion) return;
          const sessionKey = node.dataset.patchViewerSessionKey || null;
          const filePath = node.dataset.patchViewerFilePath;
          if (!filePath) return;

          recordHunkExpansion(
            sessionKey,
            filePath,
            expansion.hunkIndex,
            expansion.direction,
            expansion.lineCount,
          );
        };

        node.addEventListener('click', clickListener, { capture: true });
        hunkExpansionNodesRef.current.add(node);
      }

      const fileExpansions = getPatchViewerSessionState(
        usePatchViewerStore.getState(),
        patchViewerSessionKey,
      ).hunkExpansionsByFile[normalizedFilePath];
      replayHunkExpansions(fileDiff, instance as unknown as HunkExpansionOwner, fileExpansions);
    },
    [patchViewerSessionKey, recordHunkExpansion],
  );

  const restoreScrollPosition = useCallback((sessionKey: string, scrollTop: number) => {
    cancelScrollRestoreRef.current?.();
    restoringScrollSessionKeyRef.current = sessionKey;

    let attempts = 0;
    let cancelFrame: (() => void) | null = null;
    let cancelled = false;

    const stop = () => {
      cancelled = true;
      cancelFrame?.();
      cancelFrame = null;
      cancelScrollRestoreRef.current = null;
      if (restoringScrollSessionKeyRef.current === sessionKey) {
        restoringScrollSessionKeyRef.current = null;
      }
    };

    const tick = () => {
      if (cancelled) {
        return;
      }

      const root = scrollRootRef.current;
      if (!root || previousSessionKeyRef.current !== sessionKey) {
        stop();
        return;
      }

      root.scrollTo({
        top: scrollTop,
        behavior: 'auto',
      });

      const maxScrollTop = Math.max(root.scrollHeight - root.clientHeight, 0);
      const isRestored =
        Math.abs(root.scrollTop - Math.min(scrollTop, maxScrollTop)) <= 1 &&
        maxScrollTop >= scrollTop;

      attempts += 1;
      if (isRestored || attempts >= SCROLL_RESTORE_MAX_ATTEMPTS) {
        stop();
        return;
      }

      cancelFrame = scheduleNextFrame(tick);
    };

    cancelScrollRestoreRef.current = stop;
    cancelFrame = scheduleNextFrame(tick);
  }, []);

  useLayoutEffect(() => {
    previousSessionKeyRef.current = patchViewerSessionKey;
  }, [patchViewerSessionKey]);

  useEffect(() => {
    return () => {
      cancelScrollRestoreRef.current?.();
      const sessionKey = previousSessionKeyRef.current;
      if (!sessionKey || !scrollRootRef.current) {
        return;
      }

      setScrollTop(sessionKey, scrollRootRef.current.scrollTop);
    };
  }, [setScrollTop]);

  useEffect(() => {
    cancelFileCommentsSectionScrollRef.current?.();
    cancelFileCommentsSectionScrollRef.current = null;
    cancelThreadScrollRef.current?.();
    cancelThreadScrollRef.current = null;
    fileCommentsSectionNodesRef.current.clear();
    globalCommentsSectionNodeRef.current = null;
  }, [
    patchViewerSessionKey,
    selectedPatch?.headSha,
    selectedPatch?.number,
    selectedPatch?.providerId,
    selectedPatch?.repoKey,
  ]);

  useEffect(() => {
    const fileCommentsSectionNodes = fileCommentsSectionNodesRef.current;
    const threadAnchorNodes = threadAnchorNodesRef.current;
    return () => {
      cancelFileCommentsSectionScrollRef.current?.();
      cancelFileCommentsSectionScrollRef.current = null;
      cancelThreadScrollRef.current?.();
      cancelThreadScrollRef.current = null;
      fileCommentsSectionNodes.clear();
      globalCommentsSectionNodeRef.current = null;
      threadAnchorNodes.clear();
    };
  }, []);

  useEffect(() => {
    ensureSession(patchViewerSessionKey);
    const session = getPatchViewerSessionState(
      usePatchViewerStore.getState(),
      patchViewerSessionKey,
    );
    setPendingScrollPath(
      patchViewerSessionKey,
      session.scrollTop === null ? session.selectedFilePath : null,
    );
  }, [ensureSession, patchViewerSessionKey, setPendingScrollPath]);

  useLayoutEffect(() => {
    if (!patchViewerSessionKey || !isDiffReady || !scrollRootRef.current) {
      return;
    }

    const scrollTop = getPatchViewerSessionState(
      usePatchViewerStore.getState(),
      patchViewerSessionKey,
    ).scrollTop;
    if (scrollTop === null) {
      return;
    }

    restoreScrollPosition(patchViewerSessionKey, scrollTop);

    return () => {
      cancelScrollRestoreRef.current?.();
    };
  }, [isDiffReady, parsedPatch.fileDiffs, patchViewerSessionKey, restoreScrollPosition]);

  useEffect(() => {
    navigator.actions.notifyDiffContentChanged();
  }, [navigator.actions, parsedPatch.fileDiffs, qualityFindingsByFile, reviewThreadsByFile]);

  async function handleSubmitDraftComment(editorId: string, body: string) {
    const editor = getReviewCommentEditorSessionState(
      useReviewCommentEditorStore.getState(),
      reviewEditorSessionKey,
    ).editorsById[editorId];
    const target = editor?.target;
    if (!selectedPatch || !target) {
      return;
    }

    setEditorSubmitting(reviewEditorSessionKey, editorId, true);
    setEditorError(reviewEditorSessionKey, editorId, '');

    try {
      if (target.type === 'global' && selectedProvider === 'github') {
        await createCommentMutation.mutateAsync({
          providerId: selectedPatch.providerId,
          repoKey: selectedPatch.repoKey,
          number: selectedPatch.number,
          body,
          path: '',
          oldPath: '',
          newPath: '',
          line: null,
          side: null,
          startLine: null,
          startSide: null,
          subjectType: 'global',
        });
      } else if (target.type === 'global') {
        await createPendingGlobalMutation.mutateAsync({
          providerId: selectedPatch.providerId,
          repoKey: selectedPatch.repoKey,
          number: selectedPatch.number,
          headSha: selectedPatch.headSha,
          body,
        });
      } else {
        await createPendingThreadMutation.mutateAsync({
          providerId: selectedPatch.providerId,
          repoKey: selectedPatch.repoKey,
          number: selectedPatch.number,
          headSha: selectedPatch.headSha,
          body,
          path: target.path,
          oldPath: target.type === 'file' ? target.oldPath : target.path,
          newPath: target.type === 'file' ? target.newPath : target.path,
          line: target.type === 'line' ? target.line : null,
          side: target.type === 'line' ? target.side : null,
          startLine: target.type === 'line' ? target.startLine : null,
          startSide: target.type === 'line' ? target.startSide : null,
          subjectType: target.type,
        });
      }
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

  async function handleSubmitDraftCommentNow(editorId: string, body: string) {
    const editor = getReviewCommentEditorSessionState(
      useReviewCommentEditorStore.getState(),
      reviewEditorSessionKey,
    ).editorsById[editorId];
    const target = editor?.target;
    if (!selectedPatch || !target) {
      return;
    }

    setEditorSubmitting(reviewEditorSessionKey, editorId, true);
    setEditorError(reviewEditorSessionKey, editorId, '');

    try {
      await createCommentMutation.mutateAsync({
        providerId: selectedPatch.providerId,
        repoKey: selectedPatch.repoKey,
        number: selectedPatch.number,
        body,
        path: target.type === 'global' ? '' : target.path,
        oldPath:
          target.type === 'file' ? target.oldPath : target.type === 'line' ? target.path : '',
        newPath:
          target.type === 'file' ? target.newPath : target.type === 'line' ? target.path : '',
        line: target.type === 'line' ? target.line : null,
        side: target.type === 'line' ? target.side : null,
        startLine: target.type === 'line' ? target.startLine : null,
        startSide: target.type === 'line' ? target.startSide : null,
        subjectType: target.type,
      });
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

  async function handleReplyToThread(thread: ReviewThread, body: string) {
    if (!selectedPatch) {
      return;
    }

    if (isGlobalReviewThread(thread)) {
      if (selectedProvider !== 'gitlab') {
        await createCommentMutation.mutateAsync({
          providerId: selectedPatch.providerId,
          repoKey: selectedPatch.repoKey,
          number: selectedPatch.number,
          body,
          path: '',
          oldPath: '',
          newPath: '',
          line: null,
          side: null,
          startLine: null,
          startSide: null,
          subjectType: 'global',
        });
        return;
      } else if (!thread.id || thread.isPending) {
        throw new Error('This thread cannot be replied to from the app.');
      }
    }

    if (!thread.id || thread.isPending) {
      throw new Error('This thread cannot be replied to from the app.');
    }

    await createPendingReplyMutation.mutateAsync({
      providerId: selectedPatch.providerId,
      repoKey: selectedPatch.repoKey,
      number: selectedPatch.number,
      headSha: selectedPatch.headSha,
      threadId: thread.id,
      body,
      path: thread.path,
      line: thread.line,
      side: thread.side,
      startLine: thread.startLine,
      startSide: thread.startSide,
      subjectType: thread.subjectType ?? 'global',
    });
  }

  async function handleReplyToThreadNow(thread: ReviewThread, body: string) {
    if (!selectedPatch) {
      return;
    }

    if (isGlobalReviewThread(thread)) {
      await createCommentMutation.mutateAsync({
        providerId: selectedPatch.providerId,
        repoKey: selectedPatch.repoKey,
        number: selectedPatch.number,
        body,
        path: '',
        oldPath: '',
        newPath: '',
        line: null,
        side: null,
        startLine: null,
        startSide: null,
        subjectType: 'global',
      });
      return;
    }

    if (!thread.id || thread.isPending) {
      return;
    }

    await replyCommentMutation.mutateAsync({
      providerId: selectedPatch.providerId,
      repoKey: selectedPatch.repoKey,
      number: selectedPatch.number,
      threadId: thread.id,
      body,
    });
  }

  async function handleEditComment(comment: ReviewComment, body: string) {
    if (!selectedPatch || !comment.id) {
      throw new Error('This comment cannot be edited from the app.');
    }

    const pendingCommentId = getPendingCommentId(comment);
    if (pendingCommentId !== null) {
      await updatePendingCommentMutation.mutateAsync({
        providerId: selectedPatch.providerId,
        repoKey: selectedPatch.repoKey,
        number: selectedPatch.number,
        headSha: selectedPatch.headSha,
        pendingCommentId,
        body,
      });
      return;
    }
    const parentThread = reviewThreads.find((thread) =>
      thread.comments.some((item) => item.id === comment.id),
    );
    if (!parentThread?.id) {
      throw new Error('This comment cannot be edited from the app.');
    }

    await updateCommentMutation.mutateAsync({
      providerId: selectedPatch.providerId,
      repoKey: selectedPatch.repoKey,
      number: selectedPatch.number,
      threadId: parentThread.id,
      commentId: comment.id,
      body,
      subjectType: isGlobalReviewThread(parentThread)
        ? 'global'
        : isFileReviewThread(parentThread)
          ? 'file'
          : 'line',
    });
  }

  async function handleDeletePendingComment(comment: ReviewComment) {
    if (!selectedPatch) {
      return;
    }
    const pendingCommentId = getPendingCommentId(comment);
    if (pendingCommentId === null) {
      throw new Error('This comment is not pending.');
    }
    const deletingCommentId = comment.id;
    setDeletingCommentIds((current) => new Set(current).add(deletingCommentId));

    try {
      await deletePendingCommentMutation.mutateAsync({
        providerId: selectedPatch.providerId,
        repoKey: selectedPatch.repoKey,
        number: selectedPatch.number,
        headSha: selectedPatch.headSha,
        pendingCommentId,
      });
    } finally {
      setDeletingCommentIds((current) => {
        const next = new Set(current);
        next.delete(deletingCommentId);
        return next;
      });
    }
  }

  async function handleSetThreadResolved(thread: ReviewThread, isResolved: boolean) {
    if (!selectedPatch || !thread.id || thread.isPending || thread.canResolve === false) {
      throw new Error('This thread cannot be updated from the app.');
    }

    await setResolvedMutation.mutateAsync({
      providerId: selectedPatch.providerId,
      repoKey: selectedPatch.repoKey,
      number: selectedPatch.number,
      threadId: thread.id,
      isResolved,
    });
  }

  async function handleDeleteComment(thread: ReviewThread, comment: ReviewComment) {
    if (!selectedPatch || !comment.id) {
      throw new Error('This comment cannot be deleted from the app.');
    }

    if (comment.isPending) {
      await handleDeletePendingComment(comment);
      return;
    }

    if (!thread.id && !isGlobalReviewThread(thread)) {
      throw new Error('This comment cannot be deleted from the app.');
    }

    const deletingCommentId = comment.id;
    setDeletingCommentIds((current) => new Set(current).add(deletingCommentId));

    try {
      await deleteCommentMutation.mutateAsync({
        providerId: selectedPatch.providerId,
        repoKey: selectedPatch.repoKey,
        number: selectedPatch.number,
        threadId: thread.id,
        commentId: comment.id,
        subjectType: isGlobalReviewThread(thread)
          ? 'global'
          : isFileReviewThread(thread)
            ? 'file'
            : 'line',
      });
    } finally {
      setDeletingCommentIds((current) => {
        const next = new Set(current);
        next.delete(deletingCommentId);
        return next;
      });
    }
  }

  async function handlePublishPendingReview(
    action: PendingReviewSubmitAction = 'comment',
    summary = '',
  ) {
    if (!selectedPatch) return;
    await publishPendingReviewMutation.mutateAsync({
      action,
      headSha: selectedPatch.headSha,
      providerId: selectedPatch.providerId,
      repoKey: selectedPatch.repoKey,
      number: selectedPatch.number,
      summary,
    });
  }

  async function handleDiscardPendingReview() {
    if (!selectedPatch) return;
    await discardPendingReviewMutation.mutateAsync({
      headSha: selectedPatch.headSha,
      providerId: selectedPatch.providerId,
      repoKey: selectedPatch.repoKey,
      number: selectedPatch.number,
    });
  }

  const pendingReviewCount = pendingReview.comments.length;

  if (!hasSelection) {
    return (
      <main className="h-full min-h-0 min-w-0 pl-0">
        <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
          <TopBar className="shrink-0 cursor-grab app-region-drag" position="middle" />
          <AppearanceBackground
            background={backgroundQuery.data}
            className="min-h-0 flex-1 w-full object-cover"
          />
        </section>
      </main>
    );
  }

  return (
    <main className="h-full min-h-0 min-w-0 pl-0">
      <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="min-h-0 min-w-[30%] flex-1">
            <div className="relative h-full min-h-0 min-w-0">
              <PatchScrollVirtualizer
                className="relative h-full min-h-0 min-w-0"
                config={VIRTUALIZER_CONFIG}
                contentClassName="flex min-h-full flex-col bg-white dark:bg-surface"
                onRootChange={handleVirtualizerRootChange}
                onScroll={handlePatchScroll}
              >
                {!selectedPrKey && !isPatchLoading ? (
                  <div className="flex min-h-full flex-col">
                    <TopBar
                      aria-hidden="true"
                      position="middle"
                      className="shrink-0 cursor-grab app-region-drag border-b border-ink-200 bg-transparent dark:border-neutral-700"
                    />
                    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center md:min-h-full">
                      <strong>Select a pull request.</strong>
                      <span className="text-sm text-ink-600">
                        The PR patch will render here with Pierre Diffs.
                      </span>
                    </div>
                  </div>
                ) : null}

                {isPatchLoading ? (
                  <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center md:min-h-full">
                    Loading patch...
                  </div>
                ) : null}

                {!isPatchLoading && patchError ? (
                  <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-danger-600 md:min-h-full">
                    {patchError}
                  </div>
                ) : null}

                {hasSelection ? (
                  <PullRequestApprovalSummary
                    approvalState={approvalState}
                    error={approvalStateError}
                    isApprovePending={approveMutation.isPending}
                    isLoading={isApprovalStateLoading}
                    isRemovePending={removeApprovalMutation.isPending}
                    onApprove={async () => {
                      if (!selectedPr) {
                        return;
                      }

                      await approveMutation.mutateAsync(selectedPr);
                    }}
                    onRemoveApproval={async () => {
                      if (!selectedPr) {
                        return;
                      }

                      await removeApprovalMutation.mutateAsync(selectedPr);
                    }}
                  />
                ) : null}

                {hasSelection && !isPatchLoading ? (
                  <PullRequestQualitySummary
                    displayedFileCount={displayedQualityFileCount}
                    displayedInlineCount={displayedQualityInlineCount}
                    error={qualityReportError}
                    isLoading={isQualityReportLoading}
                    report={qualityReport}
                    unmappedFindings={unmappedQualityFindings}
                  />
                ) : null}

                {!isPatchLoading && !patchError && isReviewThreadsLoading ? (
                  <div className="px-4 pb-2 pt-1 text-sm text-ink-500">
                    Loading review threads...
                  </div>
                ) : null}

                {!isPatchLoading && !patchError && reviewThreadsError ? (
                  <div className="px-4 pb-2 pt-1 text-sm text-danger-600">{reviewThreadsError}</div>
                ) : null}

                {!isPatchLoading && !patchError && selectedPatch ? (
                  <div className="flex h-full min-h-[50vh] flex-col md:min-h-full">
                    <PatchFileDiffItemContext.Provider
                      value={{
                        defaultReviewEditorMode,
                        deletingCommentIds,
                        patchViewerSessionKey,
                        resolvingThreadId,
                        diffNavigator: navigator.diff,
                        isInactiveFileCommentsExpanded,
                        parsedFileDiffs: parsedPatch.fileDiffs,
                        qualityFindingsByFile,
                        registerFileCommentsSection,
                        registerThreadAnchor,
                        reviewEditorSessionKey,
                        reviewThreadsByFile,
                        scrollToFileCommentsSection,
                        selectedBaseSha,
                        selectedPatch,
                        selectedProvider,
                        setInactiveFileCommentsExpanded,
                        handleDeleteComment,
                        viewerLogin,
                        handleDeletePendingComment,
                        handleEditComment,
                        handleFileDiffPostRender,
                        handleReplyToThread,
                        handleReplyToThreadNow,
                        handleSetThreadResolved,
                        handleSubmitDraftComment,
                        handleSubmitDraftCommentNow,
                      }}
                    >
                      <div className="flex flex-col bg-white dark:bg-surface">
                        <GlobalCommentsSection
                          defaultReviewEditorMode={defaultReviewEditorMode}
                          deletingCommentIds={deletingCommentIds}
                          patchViewerSessionKey={patchViewerSessionKey}
                          resolvingThreadId={resolvingThreadId}
                          onDeleteComment={handleDeleteComment}
                          isLoading={isReviewThreadsLoading}
                          onDeletePendingComment={handleDeletePendingComment}
                          onEditComment={handleEditComment}
                          onOpenNewComment={() => {
                            useReviewCommentEditorStore
                              .getState()
                              .openNewEditor(reviewEditorSessionKey, {
                                type: 'global',
                              });
                            globalCommentsSectionNodeRef.current?.scrollIntoView({
                              behavior: 'auto',
                              block: 'start',
                              inline: 'nearest',
                            });
                          }}
                          onReplyToThread={handleReplyToThread}
                          onReplyToThreadNow={handleReplyToThreadNow}
                          onSetThreadResolved={handleSetThreadResolved}
                          onSubmitDraftComment={handleSubmitDraftComment}
                          onSubmitDraftCommentNow={handleSubmitDraftCommentNow}
                          portalRootId={globalCommentsPortalRootId}
                          provider={selectedProvider}
                          registerSection={registerGlobalCommentsSection}
                          registerThreadAnchor={registerThreadAnchor}
                          reviewEditorSessionKey={reviewEditorSessionKey}
                          threads={globalReviewThreads}
                          viewerLogin={viewerLogin}
                        />

                        {parsedPatch.parseError ? (
                          <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-danger-600 md:min-h-full">
                            {parsedPatch.parseError}
                          </div>
                        ) : parsedPatch.fileDiffs.length === 0 ? (
                          <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-ink-500 md:min-h-full">
                            No diff content.
                          </div>
                        ) : (
                          parsedPatch.fileDiffs.map((fileDiff, fileIndex) => (
                            <PatchFileDiffItem
                              fileDiff={fileDiff}
                              fileIndex={fileIndex}
                              key={`${repoIdentityKey(selectedPatch)}-${selectedPatch.number}-${selectedPatch.headSha}-${normalizePath(fileDiff.name)}`}
                            />
                          ))
                        )}
                      </div>
                    </PatchFileDiffItemContext.Provider>
                  </div>
                ) : null}
              </PatchScrollVirtualizer>
              {pendingReviewCount > 0 || pendingReviewError ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 z-40 flex justify-center px-4">
                  <PendingReviewBar
                    count={pendingReviewCount}
                    error={pendingReviewError}
                    isDiscarding={discardPendingReviewMutation.isPending}
                    isLoading={isPendingReviewLoading}
                    isPublishing={publishPendingReviewMutation.isPending}
                    provider={selectedProvider}
                    onDiscard={() => void handleDiscardPendingReview()}
                    onPublish={(action, summary) =>
                      void handlePublishPendingReview(action, summary)
                    }
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div className="min-h-0 w-1/3 min-w-[15%] shrink-0">
            <div
              className={cx(
                'flex h-full min-h-0 min-w-0 flex-col',
                shouldShowCommentsPanel && 'divide-y divide-ink-200',
              )}
            >
              <div
                className={cx(
                  'min-h-0 overflow-hidden',
                  shouldShowCommentsPanel ? 'flex-[3]' : 'flex-1',
                )}
              >
                <ChangedFilesTree
                  error={changedFilesError}
                  files={changedFiles}
                  hasSelection={hasSelection}
                  isDark={isDark}
                  isLoading={isChangedFilesLoading}
                  onSelectFile={navigator.tree.onSelectFile}
                  selectedFilePath={navigator.tree.selectedFilePath}
                  showContainer={false}
                  fileStats={fileStats}
                  gitStatus={gitStatus}
                />
              </div>

              {shouldShowCommentsPanel ? (
                <div className="min-h-0 flex-[2] overflow-y-auto scrollbar-hidden bg-surface">
                  <ReviewThreadsPanel
                    threads={reviewThreads}
                    isLoading={isReviewThreadsLoading}
                    error={reviewThreadsError}
                    hasSelection={hasSelection}
                    onSelectThread={handleSelectReviewThread}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export { PatchViewerMain };
export type { PatchViewerMainProps };
