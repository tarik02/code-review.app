import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs";
import type {
  PullRequestQualityFinding,
  PullRequestQualityReport,
} from "../types/forge";
import { normalizePath } from "./review-threads";

type QualityFindingAnnotation = {
  finding: PullRequestQualityFinding;
};

type FileQualityFindings = {
  inlineAnnotations: DiffLineAnnotation<QualityFindingAnnotation>[];
  fileFindings: PullRequestQualityFinding[];
  totalCount: number;
};

const EMPTY_FILE_QUALITY_FINDINGS: FileQualityFindings = {
  inlineAnnotations: [],
  fileFindings: [],
  totalCount: 0,
};

type PullRequestQualityView = {
  byFile: Map<string, FileQualityFindings>;
  displayedInlineCount: number;
  displayedFileCount: number;
  unmappedFindings: PullRequestQualityFinding[];
};

function fileContainsAdditionLine(fileDiff: FileDiffMetadata, lineNumber: number) {
  return fileDiff.hunks.some(
    (hunk) =>
      lineNumber >= hunk.additionStart &&
      lineNumber < hunk.additionStart + hunk.additionCount,
  );
}

function compareQualityFindings(
  left: PullRequestQualityFinding,
  right: PullRequestQualityFinding,
) {
  const leftLine = left.line ?? Number.MAX_SAFE_INTEGER;
  const rightLine = right.line ?? Number.MAX_SAFE_INTEGER;

  if (leftLine !== rightLine) {
    return leftLine - rightLine;
  }

  return left.title.localeCompare(right.title);
}

function buildPullRequestQualityView(
  report: PullRequestQualityReport | null,
  fileDiffs: FileDiffMetadata[],
): PullRequestQualityView {
  if (!report || report.findings.length === 0) {
    return {
      byFile: new Map<string, FileQualityFindings>(),
      displayedInlineCount: 0,
      displayedFileCount: 0,
      unmappedFindings: [],
    };
  }

  const fileDiffsByPath = new Map<string, FileDiffMetadata>();
  const pathAliases = new Map<string, string>();

  for (const fileDiff of fileDiffs) {
    const normalizedCurrentPath = normalizePath(fileDiff.name);
    fileDiffsByPath.set(normalizedCurrentPath, fileDiff);
    pathAliases.set(normalizedCurrentPath, normalizedCurrentPath);

    if (fileDiff.prevName) {
      pathAliases.set(normalizePath(fileDiff.prevName), normalizedCurrentPath);
    }
  }

  const grouped = new Map<string, FileQualityFindings>();
  const unmappedFindings: PullRequestQualityFinding[] = [];
  let displayedInlineCount = 0;
  let displayedFileCount = 0;

  for (const finding of report.findings) {
    const normalizedPath = normalizePath(finding.path);
    const resolvedPath = pathAliases.get(normalizedPath) ?? normalizedPath;
    const fileDiff = fileDiffsByPath.get(resolvedPath);

    if (!fileDiff) {
      unmappedFindings.push(finding);
      continue;
    }

    const existing =
      grouped.get(resolvedPath) ?? {
        inlineAnnotations: [],
        fileFindings: [],
        totalCount: 0,
      };

    const canInline =
      finding.line !== null &&
      finding.anchorState !== "unmapped" &&
      fileContainsAdditionLine(fileDiff, finding.line);

    if (canInline) {
      existing.inlineAnnotations.push({
        side: "additions",
        lineNumber: finding.line,
        metadata: { finding },
      });
      displayedInlineCount += 1;
    } else {
      existing.fileFindings.push(finding);
      displayedFileCount += 1;
    }

    existing.totalCount += 1;
    grouped.set(resolvedPath, existing);
  }

  for (const entry of grouped.values()) {
    entry.fileFindings.sort(compareQualityFindings);
    entry.inlineAnnotations.sort(
      (left, right) => left.lineNumber - right.lineNumber,
    );
  }

  unmappedFindings.sort(compareQualityFindings);

  return {
    byFile: grouped,
    displayedInlineCount,
    displayedFileCount,
    unmappedFindings,
  };
}

function getFileQualityFindings(
  byFile: Map<string, FileQualityFindings>,
  filePath: string,
) {
  return byFile.get(normalizePath(filePath)) ?? EMPTY_FILE_QUALITY_FINDINGS;
}

export {
  buildPullRequestQualityView,
  EMPTY_FILE_QUALITY_FINDINGS,
  getFileQualityFindings,
};
export type {
  FileQualityFindings,
  PullRequestQualityView,
  QualityFindingAnnotation,
};
