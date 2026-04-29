import type { DiffLineAnnotation } from "@pierre/diffs";

type ReviewComment = {
  id: string;
  databaseId: number | null;
  authorLogin: string;
  authorAvatarUrl: string | null;
  authorAssociation: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  replyToId: string | null;
  isPending?: boolean;
  isOptimistic?: boolean;
};

type ReviewThread = {
  id: string;
  provider: "github" | "gitlab";
  path: string;
  isResolved: boolean;
  isOutdated: boolean;
  line: number | null;
  startLine: number | null;
  side: "LEFT" | "RIGHT" | null;
  startSide: "LEFT" | "RIGHT" | null;
  subjectType: "line" | "file" | "global" | null;
  comments: ReviewComment[];
  isPending?: boolean;
  isOptimistic?: boolean;
};

type ReviewThreadAnnotation = {
  thread: ReviewThread;
};

type FileReviewThreads = {
  activeFileThreads: ReviewThread[];
  activeLineAnnotations: DiffLineAnnotation<ReviewThreadAnnotation>[];
  inactiveFileThreads: ReviewThread[];
  totalCount: number;
  unresolvedCount: number;
  fileThreadCount: number;
};

const EMPTY_FILE_REVIEW_THREADS: FileReviewThreads = {
  activeFileThreads: [],
  activeLineAnnotations: [],
  inactiveFileThreads: [],
  totalCount: 0,
  unresolvedCount: 0,
  fileThreadCount: 0,
};

function normalizePath(path: string) {
  return path.replace(/^[ab]\//, "");
}

function getAnnotationSide(
  side: ReviewThread["side"],
): DiffLineAnnotation<ReviewThreadAnnotation>["side"] | null {
  if (side === "RIGHT") return "additions";
  if (side === "LEFT") return "deletions";
  return null;
}

function getThreadSortLine(thread: ReviewThread) {
  return thread.startLine ?? thread.line ?? Number.MAX_SAFE_INTEGER;
}

function compareThreads(a: ReviewThread, b: ReviewThread) {
  return getThreadSortLine(a) - getThreadSortLine(b);
}

function isActiveReviewThread(thread: ReviewThread) {
  return !thread.isResolved && !thread.isOutdated;
}

function isGlobalReviewThread(thread: ReviewThread) {
  return thread.subjectType === "global";
}

function isFileReviewThread(thread: ReviewThread) {
  if (isGlobalReviewThread(thread)) {
    return false;
  }

  return (
    thread.subjectType === "file" ||
    thread.line === null ||
    getAnnotationSide(thread.side) === null
  );
}

function createFileReviewThreads(fileThreads: ReviewThread[]): FileReviewThreads {
  const sortedThreads = [...fileThreads].sort(compareThreads);
  const activeThreads = sortedThreads.filter(isActiveReviewThread);
  const inactiveThreads = sortedThreads.filter((thread) => !isActiveReviewThread(thread));
  const activeLineAnnotations = activeThreads.flatMap((thread) => {
    const annotationSide = getAnnotationSide(thread.side);
    if (isFileReviewThread(thread) || thread.line === null || !annotationSide) {
      return [];
    }

    return [
      {
        side: annotationSide,
        lineNumber: thread.line,
        metadata: { thread },
      },
    ];
  });
  const activeFileThreads = activeThreads.filter(isFileReviewThread);
  const inactiveFileThreads = inactiveThreads.filter(isFileReviewThread);
  return {
    activeFileThreads,
    activeLineAnnotations,
    inactiveFileThreads,
    totalCount: sortedThreads.length,
    unresolvedCount: activeThreads.length,
    fileThreadCount: activeFileThreads.length + inactiveFileThreads.length,
  };
}

function buildReviewThreadsByFile(
  reviewThreads: ReviewThread[],
): Map<string, FileReviewThreads> {
  const groupedThreads = new Map<string, ReviewThread[]>();

  for (const thread of reviewThreads) {
    if (isGlobalReviewThread(thread)) {
      continue;
    }

    const normalizedPath = normalizePath(thread.path);
    const existingGroup = groupedThreads.get(normalizedPath);

    if (existingGroup) {
      existingGroup.push(thread);
      continue;
    }

    groupedThreads.set(normalizedPath, [thread]);
  }

  const reviewThreadsByFile = new Map<string, FileReviewThreads>();

  for (const [filePath, fileThreads] of groupedThreads) {
    reviewThreadsByFile.set(filePath, createFileReviewThreads(fileThreads));
  }

  return reviewThreadsByFile;
}

function getThreadRootComment(thread: ReviewThread) {
  return (
    thread.comments.find((comment) => comment.replyToId === null) ??
    thread.comments[0] ??
    null
  );
}

function getGlobalReviewThreads(reviewThreads: ReviewThread[]): ReviewThread[] {
  return [...reviewThreads]
    .filter(isGlobalReviewThread)
    .sort((left, right) => {
      const leftCreatedAt = Date.parse(getThreadRootComment(left)?.createdAt ?? "");
      const rightCreatedAt = Date.parse(
        getThreadRootComment(right)?.createdAt ?? "",
      );

      if (Number.isNaN(leftCreatedAt) && Number.isNaN(rightCreatedAt)) {
        return 0;
      }
      if (Number.isNaN(leftCreatedAt)) {
        return 1;
      }
      if (Number.isNaN(rightCreatedAt)) {
        return -1;
      }

      return leftCreatedAt - rightCreatedAt;
    });
}

function getFileReviewThreadsForPath(
  reviewThreadsByFile: Map<string, FileReviewThreads>,
  filePath: string,
): FileReviewThreads {
  return reviewThreadsByFile.get(normalizePath(filePath)) ?? EMPTY_FILE_REVIEW_THREADS;
}

export {
  buildReviewThreadsByFile,
  EMPTY_FILE_REVIEW_THREADS,
  getFileReviewThreadsForPath,
  getGlobalReviewThreads,
  isActiveReviewThread,
  isFileReviewThread,
  isGlobalReviewThread,
  normalizePath,
};
export type { FileReviewThreads, ReviewComment, ReviewThread, ReviewThreadAnnotation };
