import {
  autoUpdate,
  FloatingPortal,
  offset,
  size,
  useFloating,
} from "@floating-ui/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, UIEvent } from "react";
import type {
  DiffLineAnnotation,
  ExpansionDirections,
  FileDiff as PierreFileDiffInstance,
  FileDiffMetadata,
  HunkExpansionRegion,
  SelectedLineRange,
  VirtualFileMetrics,
  VirtualizerConfig,
} from "@pierre/diffs";
import { useQuery } from "@tanstack/react-query";
import type { GitStatusEntry } from "@pierre/trees";
import { FileDiff } from "@pierre/diffs/react";
import { ChangedFilesTree } from "./changed-files-tree";
import { AppearanceBackground } from "./appearance-background";
import { PatchScrollVirtualizer } from "./patch-scroll-virtualizer";
import { ReviewCommentEditor } from "./review-comment-editor";
import { ReviewThreadCard } from "./review-thread-card";
import { TOP_BAR_MACOS_HEIGHT, TOP_BAR_WCO_HEIGHT } from "./top-bar";
import { usePullRequestReviewCommentMutations } from "../../hooks/use-forge-queries";
import { useDiffNavigator } from "../../hooks/use-diff-navigator";
import { cx } from "../../lib/cx";
import {
  appearanceBackgroundQueryOptions,
  pullRequestFileContentsQueryOptions,
} from "../../queries/forge";
import {
  getFileReviewThreadsForPath,
  isActiveReviewThread,
  normalizePath,
  type FileReviewThreads,
  type ReviewComment,
  type ReviewThread,
  type ReviewThreadAnnotation,
} from "../../lib/review-threads";
import type {
  FileStatsEntry,
  ForgeProviderKind,
  PrFileChangeType,
  PrFileContents,
  ReviewCommentSide,
} from "../../types/forge";
import {
  getPatchViewerSessionState,
  usePatchViewerStore,
  type DraftReviewCommentTarget,
} from "../../stores/patch-viewer-store";

const VIRTUALIZER_CONFIG: Partial<VirtualizerConfig> = {
  overscrollSize: 1200,
  resizeDebugging: import.meta.env.DEV,
};

const VIRTUAL_FILE_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 32,
  fileGap: 8,
};

const DIFF_FONT_STYLE = {
  "--diffs-font-family":
    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  "--diffs-header-font-family":
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

type SelectedPatch = {
  repoId: string;
  number: number;
  headSha: string;
  fileDiffs: FileDiffMetadata[];
};

type DraftReviewCommentAnnotation = {
  kind: "draft";
  portalRootId: string;
};

type PatchLineAnnotation =
  | ReviewThreadAnnotation
  | DraftReviewCommentAnnotation;

type PatchViewerMainProps = {
  selectedPrKey: string | null;
  selectedPatch: SelectedPatch | null;
  selectedBaseSha: string | null;
  isGitDiffMode: boolean;
  isPatchLoading: boolean;
  patchError: string;
  changedFiles: string[];
  isChangedFilesLoading: boolean;
  changedFilesError: string;
  reviewThreadsByFile: Map<string, FileReviewThreads>;
  reviewThreads: ReviewThread[];
  isReviewThreadsLoading: boolean;
  reviewThreadsError: string;
  parsedPatch: {
    fileDiffs: FileDiffMetadata[];
    parseError: string;
  };
  fileStats: Map<string, FileStatsEntry> | null;
  gitStatus: GitStatusEntry[] | undefined;
  isDark: boolean;
};

function toGithubSide(side: SelectedLineRange["side"]): ReviewCommentSide {
  return side === "deletions" ? "LEFT" : "RIGHT";
}

function toSelectionSide(side: ReviewCommentSide | null | undefined) {
  return side === "LEFT" ? "deletions" : "additions";
}

function scheduleNextFrame(callback: () => void) {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    const frameId = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frameId);
  }

  const timeoutId = setTimeout(callback, 0);
  return () => clearTimeout(timeoutId);
}

function getProviderFromRepoId(repoId: string): ForgeProviderKind {
  return repoId.startsWith("gitlab:") ? "gitlab" : "github";
}

function normalizeDiffLineText(content: string) {
  return content.replace(/[\r\n]+$/g, "");
}

function splitFileContentLines(content: string) {
  if (content.length === 0) {
    return [];
  }

  const lines = content.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function getDiffLineContent(
  fileDiff: FileDiffMetadata,
  side: ReviewCommentSide,
  line: number,
) {
  const isAdditionSide = side === "RIGHT";
  const lines = isAdditionSide ? fileDiff.additionLines : fileDiff.deletionLines;

  for (const hunk of fileDiff.hunks) {
    const startLine = isAdditionSide ? hunk.additionStart : hunk.deletionStart;
    const lineCount = isAdditionSide ? hunk.additionCount : hunk.deletionCount;
    const lineIndex = isAdditionSide
      ? hunk.additionLineIndex
      : hunk.deletionLineIndex;

    if (line >= startLine && line < startLine + lineCount) {
      return normalizeDiffLineText(lines[lineIndex + line - startLine] ?? "");
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
  if (!target || target.type !== "line") {
    return "";
  }

  if (target.startSide && target.startSide !== target.side) {
    return "";
  }

  const fileDiff = fileDiffs.find(
    (candidate) => normalizePath(candidate.name) === normalizePath(target.path),
  );
  if (!fileDiff) {
    return "";
  }

  const startLine = Math.min(target.startLine ?? target.line, target.line);
  const endLine = Math.max(target.startLine ?? target.line, target.line);
  const selectedLines: string[] = [];

  for (let line = startLine; line <= endLine; line += 1) {
    const lineContent =
      getFullFileLineContent(fileContents, target.side, line) ??
      getDiffLineContent(fileDiff, target.side, line);
    if (lineContent === null) {
      return "";
    }

    selectedLines.push(lineContent);
  }

  return selectedLines.join("\n");
}

function createSuggestionSourceLine(
  content: string,
  line: number,
  side: ReviewCommentSide,
) {
  return {
    content: normalizeDiffLineText(content),
    line,
    newLine: side === "RIGHT" ? line : null,
    oldLine: side === "LEFT" ? line : null,
  };
}

function getFullFileSuggestionLines(
  fileContents: PrFileContents | null | undefined,
  side: ReviewCommentSide,
) {
  if (!fileContents) {
    return null;
  }

  const sourceContent =
    side === "RIGHT" ? fileContents.newContent : fileContents.oldContent;
  const lines = splitFileContentLines(sourceContent);
  if (lines.length === 0) {
    return null;
  }

  return lines.map((content, index) =>
    createSuggestionSourceLine(content, index + 1, side),
  );
}

function getPatchSuggestionLines(
  fileDiff: FileDiffMetadata,
  side: ReviewCommentSide,
) {
  const isAdditionSide = side === "RIGHT";
  const sourceLines = isAdditionSide
    ? fileDiff.additionLines
    : fileDiff.deletionLines;

  if (!fileDiff.isPartial) {
    return sourceLines.map((content, index) =>
      createSuggestionSourceLine(content, index + 1, side),
    );
  }

  const linesByNumber = new Map<
    number,
    ReturnType<typeof createSuggestionSourceLine>
  >();

  for (const hunk of fileDiff.hunks) {
    const startLine = isAdditionSide ? hunk.additionStart : hunk.deletionStart;
    const lineCount = isAdditionSide ? hunk.additionCount : hunk.deletionCount;
    const lineIndex = isAdditionSide
      ? hunk.additionLineIndex
      : hunk.deletionLineIndex;

    for (let index = 0; index < lineCount; index += 1) {
      const line = startLine + index;
      linesByNumber.set(
        line,
        createSuggestionSourceLine(
          sourceLines[lineIndex + index] ?? "",
          line,
          side,
        ),
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
  if (!target || target.type !== "line") {
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
  if (!selectedPatch || !target || target.type !== "line") {
    return null;
  }

  const fileDiff = fileDiffs.find(
    (candidate) => normalizePath(candidate.name) === normalizePath(target.path),
  );
  if (!fileDiff) {
    return null;
  }

  return {
    repoId: selectedPatch.repoId,
    number: selectedPatch.number,
    oldPath: fileDiff.prevName ?? fileDiff.name,
    newPath: fileDiff.name,
    baseSha: selectedBaseSha,
    headSha: selectedPatch.headSha,
    changeType: fileDiff.type as PrFileChangeType,
  };
}

type FloatingLineDraftEditorProps = {
  error: string;
  isPending: boolean;
  provider: ForgeProviderKind;
  portalRootId: string;
  selectedText: string;
  suggestionContext: ReturnType<typeof getDraftSuggestionContext>;
  target: DraftReviewCommentTarget | null;
  onCancel: () => void;
  onSubmit: (body: string) => Promise<void>;
};

function FloatingLineDraftEditor({
  error,
  isPending,
  provider,
  portalRootId,
  selectedText,
  suggestionContext,
  target,
  onCancel,
  onSubmit,
}: FloatingLineDraftEditorProps) {
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
    setPortalRoot(document.getElementById(portalRootId));
  }, [portalRootId]);

  return (
    <>
      <div
        ref={setReference}
        style={{ height: INITIAL_FLOATING_EDITOR_HEIGHT }}
      />
      <FloatingPortal root={portalRoot}>
        {hasReference && portalRoot ? (
          <div
            ref={setFloating}
            className="pointer-events-auto z-50 px-3 py-2 font-sans"
            style={floatingStyles}
          >
            <ReviewCommentEditor
              error={error}
              isPending={isPending}
              provider={provider}
              selectedText={selectedText}
              suggestionContext={suggestionContext}
              submitLabel="Comment"
              target={target}
              onCancel={onCancel}
              onSubmit={onSubmit}
            />
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

function getMissingExpansion(desired: number, current: number) {
  if (desired === Number.POSITIVE_INFINITY) {
    return current === Number.POSITIVE_INFINITY ? 0 : Number.POSITIVE_INFINITY;
  }

  return Math.max(desired - current, 0);
}

function getCurrentHunkExpansion(
  instance: HunkExpansionOwner,
  hunkIndex: number,
) {
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
    if (
      !Number.isInteger(hunkIndex) ||
      hunkIndex < 0 ||
      hunkIndex > fileDiff.hunks.length
    ) {
      continue;
    }

    const currentRegion = getCurrentHunkExpansion(instance, hunkIndex);
    const upExpansion = getMissingExpansion(
      desiredRegion.fromStart,
      currentRegion.fromStart,
    );
    const downExpansion = getMissingExpansion(
      desiredRegion.fromEnd,
      currentRegion.fromEnd,
    );

    if (
      upExpansion > 0 &&
      downExpansion > 0 &&
      upExpansion === downExpansion
    ) {
      instance.expandHunk(hunkIndex, "both", upExpansion);
      continue;
    }

    if (upExpansion > 0) {
      instance.expandHunk(hunkIndex, "up", upExpansion);
    }

    const nextRegion = getCurrentHunkExpansion(instance, hunkIndex);
    const nextDownExpansion = getMissingExpansion(
      desiredRegion.fromEnd,
      nextRegion.fromEnd,
    );

    if (nextDownExpansion > 0) {
      instance.expandHunk(hunkIndex, "down", nextDownExpansion);
    }
  }
}

function getExpansionClick(
  event: MouseEvent,
): {
  hunkIndex: number;
  direction: ExpansionDirections;
  lineCount: number;
} | null {
  let direction: ExpansionDirections = "both";
  let hunkIndex: number | null = null;
  let isExpansionClick = false;
  let expandAll = event.shiftKey;

  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;

    if (
      target.hasAttribute("data-expand-button") ||
      target.hasAttribute("data-unmodified-lines")
    ) {
      isExpansionClick = true;
      expandAll ||= target.hasAttribute("data-expand-all-button");

      if (target.hasAttribute("data-expand-up")) {
        direction = "up";
      } else if (target.hasAttribute("data-expand-down")) {
        direction = "down";
      } else {
        direction = "both";
      }
    }

    const expandIndex = target.getAttribute("data-expand-index");
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
    lineCount: expandAll
      ? Number.POSITIVE_INFINITY
      : DIFF_EXPANSION_LINE_COUNT,
  };
}

type ReviewThreadsPanelProps = {
  threads: ReviewThread[];
  isLoading: boolean;
  error: string;
  hasSelection: boolean;
};

function getThreadRefKey(thread: ReviewThread) {
  if (thread.id) {
    return `id:${thread.id}`;
  }

  return `fallback:${normalizePath(thread.path)}:${thread.startLine ?? thread.line ?? "file"}:${thread.comments[0]?.id ?? "unknown"}`;
}

function ReviewThreadsPanel({
  threads,
  isLoading,
  error,
  hasSelection,
}: ReviewThreadsPanelProps) {
  const activeThreads = threads.filter(isActiveReviewThread);
  const resolvedThreads = threads.filter((t) => t.isResolved || t.isOutdated);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 py-3 text-xs text-ink-500 flex items-center gap-2">
        <p className="text-sm font-medium text-ink-500">Comments</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hidden px-2 pb-2">
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
        activeThreads.length === 0 ? (
          <div className="mb-3 rounded-lg px-3  text-sm text-emerald-800  dark:text-emerald-300">
            No active comments. You&apos;re in the clear!
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
                  key={getThreadRefKey(thread)}
                  slim
                  thread={thread}
                />
              ))}
            </div>
          </div>
        ) : null}

        {resolvedThreads.length > 0 ? (
          <div>
            <div className="sticky top-0 z-10 mb-2 bg-surface px-1 py-1 text-xs font-medium tracking-wide text-ink-500">
              Inactive
              <span className="ml-2 text-ink-400">
                {resolvedThreads.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {resolvedThreads.map((thread) => (
                <ReviewThreadCard
                  key={getThreadRefKey(thread)}
                  slim
                  thread={thread}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PatchViewerMain({
  selectedPrKey,
  selectedPatch,
  selectedBaseSha,
  isGitDiffMode,
  isPatchLoading,
  isDark,
  patchError,
  changedFiles,
  isChangedFilesLoading,
  changedFilesError,
  reviewThreadsByFile,
  reviewThreads,
  isReviewThreadsLoading,
  reviewThreadsError,
  parsedPatch,
  fileStats,
  gitStatus,
}: PatchViewerMainProps) {
  const backgroundQuery = useQuery(appearanceBackgroundQueryOptions());
  const patchViewerSessionKey = selectedPrKey
    ? `${selectedPrKey}:${isGitDiffMode ? "git" : "provider"}`
    : null;
  const draftCommentTarget = usePatchViewerStore(
    (state) =>
      getPatchViewerSessionState(state, patchViewerSessionKey)
        .draftCommentTarget,
  );
  const draftCommentError = usePatchViewerStore(
    (state) =>
      getPatchViewerSessionState(state, patchViewerSessionKey)
        .draftCommentError,
  );
  const ensureSession = usePatchViewerStore((state) => state.ensureSession);
  const setDraftCommentTarget = usePatchViewerStore(
    (state) => state.setDraftCommentTarget,
  );
  const setDraftCommentError = usePatchViewerStore(
    (state) => state.setDraftCommentError,
  );
  const clearDraftComment = usePatchViewerStore(
    (state) => state.clearDraftComment,
  );
  const setPendingScrollPath = usePatchViewerStore(
    (state) => state.setPendingScrollPath,
  );
  const setScrollTop = usePatchViewerStore((state) => state.setScrollTop);
  const recordHunkExpansion = usePatchViewerStore(
    (state) => state.recordHunkExpansion,
  );
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const restoringScrollSessionKeyRef = useRef<string | null>(null);
  const cancelScrollRestoreRef = useRef<(() => void) | null>(null);
  const previousSessionKeyRef = useRef<string | null>(patchViewerSessionKey);
  const hunkExpansionNodesRef = useRef<WeakSet<HTMLElement>>(new WeakSet());
  const hasSelection = selectedPrKey !== null;
  const isDiffReady =
    !isPatchLoading && !patchError && !parsedPatch.parseError;
  const shouldShowCommentsPanel =
    hasSelection &&
    (isReviewThreadsLoading ||
      Boolean(reviewThreadsError) ||
      reviewThreads.length > 0);
  const navigator = useDiffNavigator({
    sessionKey: patchViewerSessionKey,
    prKey: selectedPrKey,
    isDiffReady,
    hasDiffError: Boolean(patchError || parsedPatch.parseError),
  });
  const {
    createCommentMutation,
    replyCommentMutation,
    updateCommentMutation,
    viewerLogin,
  } = usePullRequestReviewCommentMutations(
    selectedPatch
      ? {
          repoId: selectedPatch.repoId,
          number: selectedPatch.number,
          headSha: selectedPatch.headSha,
        }
      : null,
  );
  const selectedProvider = selectedPatch
    ? getProviderFromRepoId(selectedPatch.repoId)
    : "github";
  const draftFileContentsInput = useMemo(
    () =>
      getFileContentsInput(
        selectedPatch,
        selectedBaseSha,
        parsedPatch.fileDiffs,
        draftCommentTarget,
      ),
    [draftCommentTarget, parsedPatch.fileDiffs, selectedBaseSha, selectedPatch],
  );
  const draftFileContentsQuery = useQuery({
    ...pullRequestFileContentsQueryOptions(
      draftFileContentsInput ?? {
        repoId: "__idle__",
        number: 0,
        oldPath: "",
        newPath: "",
        baseSha: null,
        headSha: "__idle__",
        changeType: "change",
      },
    ),
    enabled: draftFileContentsInput !== null,
  });
  const draftSelectedText = useMemo(
    () =>
      getDraftSelectedText(
        parsedPatch.fileDiffs,
        draftCommentTarget,
        draftFileContentsQuery.data,
      ),
    [draftCommentTarget, draftFileContentsQuery.data, parsedPatch.fileDiffs],
  );
  const draftSuggestionContext = useMemo(
    () =>
      getDraftSuggestionContext(
        parsedPatch.fileDiffs,
        draftCommentTarget,
        draftFileContentsQuery.data,
      ),
    [draftCommentTarget, draftFileContentsQuery.data, parsedPatch.fileDiffs],
  );

  const handleVirtualizerRootChange = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRootRef.current = node;
    },
    [],
  );

  const handlePatchScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (restoringScrollSessionKeyRef.current === patchViewerSessionKey) {
        return;
      }

      setScrollTop(patchViewerSessionKey, event.currentTarget.scrollTop);
    },
    [patchViewerSessionKey, setScrollTop],
  );

  const handleFileDiffPostRender = useCallback(
    (
      node: HTMLElement,
      instance: PierreFileDiffInstance<PatchLineAnnotation>,
      fileDiff: FileDiffMetadata,
      normalizedFilePath: string,
    ) => {
      node.dataset.patchViewerSessionKey = patchViewerSessionKey ?? "";
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

        node.addEventListener("click", clickListener, { capture: true });
        hunkExpansionNodesRef.current.add(node);
      }

      const fileExpansions = getPatchViewerSessionState(
        usePatchViewerStore.getState(),
        patchViewerSessionKey,
      ).hunkExpansionsByFile[normalizedFilePath];
      replayHunkExpansions(
        fileDiff,
        instance as HunkExpansionOwner,
        fileExpansions,
      );
    },
    [patchViewerSessionKey, recordHunkExpansion],
  );

  const restoreScrollPosition = useCallback(
    (sessionKey: string, scrollTop: number) => {
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
          behavior: "auto",
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
    },
    [],
  );

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
  }, [
    isDiffReady,
    parsedPatch.fileDiffs,
    patchViewerSessionKey,
    restoreScrollPosition,
  ]);

  useEffect(() => {
    navigator.actions.notifyDiffContentChanged();
  }, [
    navigator.actions,
    parsedPatch.fileDiffs,
    reviewThreadsByFile,
  ]);

  function openLineCommentDraft(path: string, range: SelectedLineRange) {
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

    setDraftCommentError(patchViewerSessionKey, "");
    setDraftCommentTarget(patchViewerSessionKey, {
      type: "line",
      path,
      line: endLine,
      side: endGithubSide,
      startLine: startLine !== endLine ? startLine : null,
      startSide: startLine !== endLine ? startGithubSide : null,
    });
  }

  async function handleSubmitDraftComment(body: string) {
    if (!selectedPatch || !draftCommentTarget) {
      return;
    }

    setDraftCommentError(patchViewerSessionKey, "");

    try {
      await createCommentMutation.mutateAsync({
        repoId: selectedPatch.repoId,
        number: selectedPatch.number,
        body,
        path: draftCommentTarget.path,
        oldPath: draftCommentTarget.path,
        newPath: draftCommentTarget.path,
        line:
          draftCommentTarget.type === "line" ? draftCommentTarget.line : null,
        side:
          draftCommentTarget.type === "line" ? draftCommentTarget.side : null,
        startLine:
          draftCommentTarget.type === "line"
            ? draftCommentTarget.startLine
            : null,
        startSide:
          draftCommentTarget.type === "line"
            ? draftCommentTarget.startSide
            : null,
        subjectType: draftCommentTarget.type === "file" ? "file" : "line",
      });
      setDraftCommentTarget(patchViewerSessionKey, null);
    } catch (error) {
      setDraftCommentError(
        patchViewerSessionKey,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function handleReplyToThread(thread: ReviewThread, body: string) {
    if (!selectedPatch) {
      return;
    }

    if (!thread.id) {
      throw new Error("This thread cannot be replied to from the app.");
    }

    await replyCommentMutation.mutateAsync({
      repoId: selectedPatch.repoId,
      number: selectedPatch.number,
      threadId: thread.id,
      body,
    });
  }

  async function handleEditComment(comment: ReviewComment, body: string) {
    if (!selectedPatch || !comment.id) {
      throw new Error("This comment cannot be edited from the app.");
    }
    const parentThread = reviewThreads.find((thread) =>
      thread.comments.some((item) => item.id === comment.id),
    );
    if (!parentThread?.id) {
      throw new Error("This comment cannot be edited from the app.");
    }

    await updateCommentMutation.mutateAsync({
      repoId: selectedPatch.repoId,
      number: selectedPatch.number,
      threadId: parentThread.id,
      commentId: comment.id,
      body,
    });
  }

  function renderReviewThreadSummary(
    fileReviewThreads: FileReviewThreads,
    path: string,
  ) {
    const hasDraft =
      draftCommentTarget?.type === "file" &&
      normalizePath(draftCommentTarget.path) === normalizePath(path);

    return (
      <div className="flex items-center gap-2 text-xs text-ink-500">
        {fileReviewThreads.totalCount > 0 ? (
          <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-700">
            {fileReviewThreads.totalCount} threads
          </span>
        ) : null}
        {fileReviewThreads.totalCount > 0 ? (
          <span
            className={cx(
              "rounded-full px-2 py-0.5",
              fileReviewThreads.unresolvedCount > 0
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
            )}
          >
            {fileReviewThreads.unresolvedCount > 0
              ? `${fileReviewThreads.unresolvedCount} open`
              : "All resolved"}
          </span>
        ) : null}
        {hasDraft ? (
          <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-700">
            Draft open
          </span>
        ) : null}
        {fileReviewThreads.fileThreads.length > 0 ? (
          <span className="text-ink-500">
            {fileReviewThreads.fileThreads.length} file-level
          </span>
        ) : null}
      </div>
    );
  }

  function renderReviewThreadAnnotations(
    annotation: DiffLineAnnotation<PatchLineAnnotation>,
  ) {
    if ("kind" in annotation.metadata && annotation.metadata.kind === "draft") {
      return (
        <FloatingLineDraftEditor
          error={draftCommentError}
          isPending={createCommentMutation.isPending}
          portalRootId={annotation.metadata.portalRootId}
          provider={selectedProvider}
          selectedText={draftSelectedText}
          suggestionContext={draftSuggestionContext}
          target={draftCommentTarget}
          onCancel={() => clearDraftComment(patchViewerSessionKey)}
          onSubmit={handleSubmitDraftComment}
        />
      );
    }

    const threadAnnotation = annotation.metadata as ReviewThreadAnnotation;

    return (
      <ReviewThreadCard
        compact
        onEditComment={handleEditComment}
        onReplyToThread={handleReplyToThread}
        thread={threadAnnotation.thread}
        viewerLogin={viewerLogin}
      />
    );
  }

  if (!hasSelection) {
    return (
      <main className="h-full min-h-0 min-w-0 pl-0">
        <section className="h-full min-h-0 min-w-0 overflow-hidden">
          <AppearanceBackground
            background={backgroundQuery.data}
            className="h-full w-full object-cover"
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
            <PatchScrollVirtualizer
              className="relative h-full min-h-0 min-w-0 overflow-y-auto scrollbar-hidden"
              config={VIRTUALIZER_CONFIG}
              contentClassName="flex min-h-full flex-col bg-white dark:bg-surface"
              onRootChange={handleVirtualizerRootChange}
              onScroll={handlePatchScroll}
            >
              {!selectedPrKey && !isPatchLoading ? (
                <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 px-6 py-10 text-center md:min-h-full">
                  <strong>Select a pull request.</strong>
                  <span className="text-sm text-ink-600">
                    The PR patch will render here with Pierre Diffs.
                  </span>
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

              {!isPatchLoading && !patchError && isReviewThreadsLoading ? (
                <div className="px-4 pb-2 pt-1 text-sm text-ink-500">
                  Loading review threads...
                </div>
              ) : null}

              {!isPatchLoading && !patchError && reviewThreadsError ? (
                <div className="px-4 pb-2 pt-1 text-sm text-danger-600">
                  {reviewThreadsError}
                </div>
              ) : null}

              {!isPatchLoading && !patchError && selectedPatch ? (
                <div className="flex min-h-[50vh] flex-col md:min-h-full h-full">
                  {parsedPatch.parseError ? (
                    <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-danger-600 md:min-h-full">
                      {parsedPatch.parseError}
                    </div>
                  ) : parsedPatch.fileDiffs.length === 0 ? (
                    <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-ink-500 md:min-h-full">
                      No diff content.
                    </div>
                  ) : (
                    <div className="flex flex-col bg-white dark:bg-surface">
                      {parsedPatch.fileDiffs.map((fileDiff, fileIndex) => {
                        const fileReviewThreads = getFileReviewThreadsForPath(
                          reviewThreadsByFile,
                          fileDiff.name,
                        );
                        const normalizedFilePath = normalizePath(fileDiff.name);
                        const lineDraftPortalRootId = `line-draft-editor-root-${selectedPatch.number}-${fileIndex}`;
                        let lineDraft: Extract<
                          DraftReviewCommentTarget,
                          { type: "line" }
                        > | null = null;
                        let fileDraft: Extract<
                          DraftReviewCommentTarget,
                          { type: "file" }
                        > | null = null;

                        if (
                          draftCommentTarget?.type === "line" &&
                          normalizePath(draftCommentTarget.path) ===
                            normalizedFilePath
                        ) {
                          lineDraft = draftCommentTarget;
                        }

                        if (
                          draftCommentTarget?.type === "file" &&
                          normalizePath(draftCommentTarget.path) ===
                            normalizedFilePath
                        ) {
                          fileDraft = draftCommentTarget;
                        }

                        const lineAnnotations: DiffLineAnnotation<PatchLineAnnotation>[] =
                          lineDraft
                            ? [
                                ...fileReviewThreads.lineAnnotations,
                                {
                                  side: toSelectionSide(lineDraft.side),
                                  lineNumber: lineDraft.line,
                                  metadata: {
                                    kind: "draft",
                                    portalRootId: lineDraftPortalRootId,
                                  },
                                },
                              ]
                            : fileReviewThreads.lineAnnotations;
                        const selectedLines: SelectedLineRange | null =
                          lineDraft
                            ? {
                                start: lineDraft.startLine ?? lineDraft.line,
                                side: toSelectionSide(
                                  lineDraft.startSide ?? lineDraft.side,
                                ),
                                end: lineDraft.line,
                                endSide: toSelectionSide(lineDraft.side),
                              }
                            : null;

                        return (
                          <div
                            className="relative"
                            data-file-path={fileDiff.name}
                            key={`${selectedPatch.repoId}-${selectedPatch.number}-${selectedPatch.headSha}-${normalizePath(fileDiff.name)}`}
                            ref={(node) =>
                              navigator.diff.registerDiffNode(
                                fileDiff.name,
                                node,
                              )
                            }
                          >
                            <FileDiff
                              fileDiff={fileDiff}
                              metrics={VIRTUAL_FILE_METRICS}
                              lineAnnotations={lineAnnotations}
                              selectedLines={selectedLines}
                              style={DIFF_FONT_STYLE}
                              options={{
                                theme: {
                                  dark: "pierre-dark",
                                  light: "pierre-light",
                                },
                                diffStyle: "unified",
                                diffIndicators: "bars",
                                lineDiffType: "word",
                                overflow: "scroll",
                                expansionLineCount: DIFF_EXPANSION_LINE_COUNT,
                                collapsedContextThreshold:
                                  DIFF_COLLAPSED_CONTEXT_THRESHOLD,
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

                                  [data-diffs-header='default'] {
                                    position: sticky;
                                    top: 0;
                                    z-index: 5;
                                    box-shadow: inset 0 -1px 0 var(--diffs-bg-context);
                                  }

                                  :host-context(.macos) [data-diffs-header='default'] {
                                    min-height: ${TOP_BAR_MACOS_HEIGHT};
                                  }

                                  :host-context(.wco) [data-diffs-header='default'] {
                                    min-height: ${TOP_BAR_WCO_HEIGHT};
                                  }

                                  [data-column-number][data-selected-line]::before {
                                    background-color: #f59e0b;
                                    background-image: none;
                                  }

                                `,
                                enableGutterUtility:
                                  draftCommentTarget === null,
                                onGutterUtilityClick: (range) =>
                                  openLineCommentDraft(fileDiff.name, range),
                                onPostRender: (node, instance) =>
                                  handleFileDiffPostRender(
                                    node,
                                    instance,
                                    fileDiff,
                                    normalizedFilePath,
                                  ),
                              }}
                              renderAnnotation={renderReviewThreadAnnotations}
                              renderHeaderMetadata={() =>
                                renderReviewThreadSummary(
                                  fileReviewThreads,
                                  fileDiff.name,
                                )
                              }
                            />
                            <div
                              id={lineDraftPortalRootId}
                              className="pointer-events-none absolute inset-0 z-[4]"
                            />
                            {fileReviewThreads.fileThreads.length > 0 ||
                            fileDraft ? (
                              <div className="mt-3 flex flex-col gap-3 rounded-xl border border-ink-200 bg-surface p-3">
                                <div className="text-xs font-medium uppercase tracking-wide text-ink-500">
                                  File threads
                                </div>
                                {fileDraft ? (
                                  <ReviewCommentEditor
                                    error={draftCommentError}
                                    isPending={createCommentMutation.isPending}
                                    provider={selectedProvider}
                                    submitLabel="Comment"
                                    target={fileDraft}
                                    onCancel={() =>
                                      clearDraftComment(patchViewerSessionKey)
                                    }
                                    onSubmit={handleSubmitDraftComment}
                                  />
                                ) : null}
                                {fileReviewThreads.fileThreads.map((thread) => (
                                  <ReviewThreadCard
                                    key={getThreadRefKey(thread)}
                                    onEditComment={handleEditComment}
                                    onReplyToThread={handleReplyToThread}
                                    thread={thread}
                                    viewerLogin={viewerLogin}
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </PatchScrollVirtualizer>
          </div>
          <div className="min-h-0 w-1/3 min-w-[15%] shrink-0">
            <div
              className={cx(
                "flex h-full min-h-0 min-w-0 flex-col",
                shouldShowCommentsPanel && "divide-y divide-ink-200",
              )}
            >
              <div
                className={cx(
                  "min-h-0 overflow-hidden",
                  shouldShowCommentsPanel ? "flex-[3]" : "flex-1",
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
