import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import type { DiffDataMode } from "@rudu/shared";

const GIT_PATCH_CONTEXT_SIZE = 3;

function parsePatch(patch: string, cacheKeyPrefix: string) {
  return parsePatchFiles(patch, cacheKeyPrefix).flatMap(
    (parsedPatch) => parsedPatch.files,
  );
}

type Hunk = FileDiffMetadata["hunks"][number];
type HunkContent = Hunk["hunkContent"][number];

function hunkContentSplitLineCount(content: HunkContent) {
  if (content.type === "context") {
    return content.lines;
  }
  return Math.max(content.deletions, content.additions);
}

function hunkContentUnifiedLineCount(content: HunkContent) {
  if (content.type === "context") {
    return content.lines;
  }
  return content.deletions + content.additions;
}

function hunkContentDeletionEnd(content: HunkContent) {
  if (content.type === "context") {
    return content.deletionLineIndex + content.lines;
  }
  return content.deletionLineIndex + content.deletions;
}

function hunkContentAdditionEnd(content: HunkContent) {
  if (content.type === "context") {
    return content.additionLineIndex + content.lines;
  }
  return content.additionLineIndex + content.additions;
}

function sliceContextContent(
  content: Extract<HunkContent, { type: "context" }>,
  offset: number,
  lines: number,
): HunkContent | null {
  if (lines <= 0) {
    return null;
  }

  return {
    ...content,
    lines,
    deletionLineIndex: content.deletionLineIndex + offset,
    additionLineIndex: content.additionLineIndex + offset,
  };
}

function appendContextContent(
  group: HunkContent[],
  content: Extract<HunkContent, { type: "context" }>,
  offset: number,
  lines: number,
) {
  const sliced = sliceContextContent(content, offset, lines);
  if (sliced) {
    group.push(sliced);
  }
}

function groupHasChange(group: HunkContent[]) {
  return group.some((content) => content.type === "change");
}

function hasLaterChange(
  hunkContent: HunkContent[],
  startIndex: number,
) {
  return hunkContent
    .slice(startIndex)
    .some((content) => content.type === "change");
}

function compactHunkContent(hunkContent: HunkContent[], contextSize: number) {
  const groups: HunkContent[][] = [];
  let group: HunkContent[] = [];

  function closeGroup() {
    if (groupHasChange(group)) {
      groups.push(group);
    }
    group = [];
  }

  for (const [index, content] of hunkContent.entries()) {
    if (content.type === "change") {
      group.push(content);
      continue;
    }

    const nextHasChange = hasLaterChange(hunkContent, index + 1);
    if (!groupHasChange(group)) {
      group = [];
      appendContextContent(
        group,
        content,
        Math.max(content.lines - contextSize, 0),
        Math.min(content.lines, contextSize),
      );
      continue;
    }

    if (!nextHasChange) {
      appendContextContent(
        group,
        content,
        0,
        Math.min(content.lines, contextSize),
      );
      continue;
    }

    if (content.lines <= contextSize * 2) {
      group.push(content);
      continue;
    }

    appendContextContent(group, content, 0, contextSize);
    closeGroup();
    appendContextContent(
      group,
      content,
      content.lines - contextSize,
      contextSize,
    );
  }

  closeGroup();
  return groups;
}

function hunkStart(lineIndex: number, count: number) {
  return count === 0 ? lineIndex : lineIndex + 1;
}

function formatHunkSpecs(hunk: Hunk) {
  return `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@\n`;
}

function createCompactedHunk(input: {
  baseHunk: Hunk;
  hunkContent: HunkContent[];
  previousAdditionEnd: number;
  previousDeletionEnd: number;
  splitLineStart: number;
  unifiedLineStart: number;
}) {
  const firstContent = input.hunkContent[0];
  const lastContent = input.hunkContent[input.hunkContent.length - 1];
  if (!firstContent || !lastContent) {
    throw new Error("Cannot compact an empty diff hunk.");
  }

  const deletionLineIndex = firstContent.deletionLineIndex;
  const additionLineIndex = firstContent.additionLineIndex;
  const deletionEnd = hunkContentDeletionEnd(lastContent);
  const additionEnd = hunkContentAdditionEnd(lastContent);
  const deletionCount = deletionEnd - deletionLineIndex;
  const additionCount = additionEnd - additionLineIndex;
  const collapsedBefore = Math.max(
    Math.min(
      additionLineIndex - input.previousAdditionEnd,
      deletionLineIndex - input.previousDeletionEnd,
    ),
    0,
  );
  const hunk = {
    ...input.baseHunk,
    collapsedBefore,
    deletionLineIndex,
    additionLineIndex,
    deletionStart: hunkStart(deletionLineIndex, deletionCount),
    additionStart: hunkStart(additionLineIndex, additionCount),
    deletionCount,
    additionCount,
    deletionLines: input.hunkContent.reduce(
      (count, content) =>
        count + (content.type === "change" ? content.deletions : 0),
      0,
    ),
    additionLines: input.hunkContent.reduce(
      (count, content) =>
        count + (content.type === "change" ? content.additions : 0),
      0,
    ),
    splitLineStart: input.splitLineStart + collapsedBefore,
    unifiedLineStart: input.unifiedLineStart + collapsedBefore,
    splitLineCount: input.hunkContent.reduce(
      (count, content) => count + hunkContentSplitLineCount(content),
      0,
    ),
    unifiedLineCount: input.hunkContent.reduce(
      (count, content) => count + hunkContentUnifiedLineCount(content),
      0,
    ),
    hunkContent: input.hunkContent,
    hunkSpecs: "",
  } satisfies Hunk;

  return {
    ...hunk,
    hunkSpecs: formatHunkSpecs(hunk),
  } satisfies Hunk;
}

function compactFullFileDiffHunks(fileDiff: FileDiffMetadata) {
  if (fileDiff.isPartial || fileDiff.hunks.length === 0) {
    return fileDiff;
  }

  const hunks: Hunk[] = [];
  let previousAdditionEnd = 0;
  let previousDeletionEnd = 0;
  let splitLineStart = 0;
  let unifiedLineStart = 0;

  for (const baseHunk of fileDiff.hunks) {
    const groups = compactHunkContent(
      baseHunk.hunkContent,
      GIT_PATCH_CONTEXT_SIZE,
    );

    for (const hunkContent of groups) {
      const hunk = createCompactedHunk({
        baseHunk,
        hunkContent,
        previousAdditionEnd,
        previousDeletionEnd,
        splitLineStart,
        unifiedLineStart,
      });
      hunks.push(hunk);
      previousAdditionEnd = hunk.additionLineIndex + hunk.additionCount;
      previousDeletionEnd = hunk.deletionLineIndex + hunk.deletionCount;
      splitLineStart += hunk.collapsedBefore + hunk.splitLineCount;
      unifiedLineStart += hunk.collapsedBefore + hunk.unifiedLineCount;
    }
  }

  const trailingLineCount = Math.max(
    Math.min(
      fileDiff.additionLines.length - previousAdditionEnd,
      fileDiff.deletionLines.length - previousDeletionEnd,
    ),
    0,
  );

  return {
    ...fileDiff,
    hunks,
    isPartial: false,
    splitLineCount: splitLineStart + trailingLineCount,
    unifiedLineCount: unifiedLineStart + trailingLineCount,
    cacheKey: `${fileDiff.cacheKey ?? fileDiff.name}:git-full-compact`,
  } satisfies FileDiffMetadata;
}

function parseGitPatch(patch: string, cacheKeyPrefix: string) {
  return parsePatch(patch, cacheKeyPrefix).map((fileDiff) =>
    compactFullFileDiffHunks({
      ...fileDiff,
      isPartial: false,
    }),
  );
}

function parsePullRequestPatch(input: {
  patch: string;
  providerId: string;
  repoKey: string;
  number: number;
  headSha: string;
  mode: DiffDataMode;
}): FileDiffMetadata[] {
  const cacheKeyPrefix = `${input.providerId}:${input.repoKey}-${input.number}-${input.headSha}-${input.mode}`;

  if (input.mode === "git") {
    return parseGitPatch(input.patch, `${cacheKeyPrefix}:git`);
  }

  return parsePatch(input.patch, `${cacheKeyPrefix}:provider`);
}

export { parsePullRequestPatch };
