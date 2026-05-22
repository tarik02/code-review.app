import type { ExpansionDirections, FileDiffMetadata } from '@pierre/diffs';
import type { PrFileContents } from '../types/forge';

type Hunk = FileDiffMetadata['hunks'][number];
type HunkContent = Hunk['hunkContent'][number];

type IndexedHunksResult = {
  hunks: Hunk[];
  splitLineCount: number;
  unifiedLineCount: number;
};

const PROVIDER_CONTEXT_PLACEHOLDER_LINE = '\n';
const PROVIDER_SHELL_COLLAPSED_CONTEXT_THRESHOLD = 0;
const PROVIDER_SHELL_CACHE_KEY_PREFIX = 'provider-shell:v4';

function splitFileContentLines(content: string) {
  if (content.length === 0) {
    return [];
  }

  return content.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) ?? [];
}

function hunkLineIndex(start: number) {
  return Math.max(start - 1, 0);
}

function hunkContentSplitLineCount(content: HunkContent) {
  if (content.type === 'context') {
    return content.lines;
  }
  return Math.max(content.deletions, content.additions);
}

function hunkContentUnifiedLineCount(content: HunkContent) {
  if (content.type === 'context') {
    return content.lines;
  }
  return content.deletions + content.additions;
}

function fillLine(lines: string[], index: number, value: string) {
  if (index < 0) {
    return;
  }

  lines[index] = value;
}

function buildIndexedHunks(input: {
  fileDiff: FileDiffMetadata;
  deletionLines: string[];
  additionLines: string[];
  fillFromPartialPatch: boolean;
}): IndexedHunksResult {
  const hunks: Hunk[] = [];
  let previousAdditionEnd = 0;
  let previousDeletionEnd = 0;
  let splitLineStart = 0;
  let unifiedLineStart = 0;

  for (const sourceHunk of input.fileDiff.hunks) {
    let deletionLineIndex = hunkLineIndex(sourceHunk.deletionStart);
    let additionLineIndex = hunkLineIndex(sourceHunk.additionStart);
    const hunkContent: HunkContent[] = [];

    for (const content of sourceHunk.hunkContent) {
      if (content.type === 'context') {
        if (input.fillFromPartialPatch) {
          for (let offset = 0; offset < content.lines; offset += 1) {
            const line =
              input.fileDiff.additionLines[content.additionLineIndex + offset] ??
              input.fileDiff.deletionLines[content.deletionLineIndex + offset] ??
              PROVIDER_CONTEXT_PLACEHOLDER_LINE;
            fillLine(input.additionLines, additionLineIndex + offset, line);
            fillLine(input.deletionLines, deletionLineIndex + offset, line);
          }
        }

        hunkContent.push({
          ...content,
          additionLineIndex,
          deletionLineIndex,
        });
        additionLineIndex += content.lines;
        deletionLineIndex += content.lines;
        continue;
      }

      if (input.fillFromPartialPatch) {
        for (let offset = 0; offset < content.additions; offset += 1) {
          fillLine(
            input.additionLines,
            additionLineIndex + offset,
            input.fileDiff.additionLines[content.additionLineIndex + offset] ??
              PROVIDER_CONTEXT_PLACEHOLDER_LINE,
          );
        }
        for (let offset = 0; offset < content.deletions; offset += 1) {
          fillLine(
            input.deletionLines,
            deletionLineIndex + offset,
            input.fileDiff.deletionLines[content.deletionLineIndex + offset] ??
              PROVIDER_CONTEXT_PLACEHOLDER_LINE,
          );
        }
      }

      hunkContent.push({
        ...content,
        additionLineIndex,
        deletionLineIndex,
      });
      additionLineIndex += content.additions;
      deletionLineIndex += content.deletions;
    }

    const collapsedBefore = Math.max(
      Math.min(
        hunkLineIndex(sourceHunk.additionStart) - previousAdditionEnd,
        hunkLineIndex(sourceHunk.deletionStart) - previousDeletionEnd,
      ),
      0,
    );
    const splitLineCount = hunkContent.reduce(
      (count, content) => count + hunkContentSplitLineCount(content),
      0,
    );
    const unifiedLineCount = hunkContent.reduce(
      (count, content) => count + hunkContentUnifiedLineCount(content),
      0,
    );
    const hunk = {
      ...sourceHunk,
      collapsedBefore,
      additionLineIndex: hunkLineIndex(sourceHunk.additionStart),
      deletionLineIndex: hunkLineIndex(sourceHunk.deletionStart),
      splitLineStart: splitLineStart + collapsedBefore,
      unifiedLineStart: unifiedLineStart + collapsedBefore,
      splitLineCount,
      unifiedLineCount,
      hunkContent,
    } satisfies Hunk;

    hunks.push(hunk);
    previousAdditionEnd = hunk.additionLineIndex + hunk.additionCount;
    previousDeletionEnd = hunk.deletionLineIndex + hunk.deletionCount;
    splitLineStart += hunk.collapsedBefore + hunk.splitLineCount;
    unifiedLineStart += hunk.collapsedBefore + hunk.unifiedLineCount;
  }

  const trailingLineCount = Math.max(
    Math.min(
      input.additionLines.length - previousAdditionEnd,
      input.deletionLines.length - previousDeletionEnd,
    ),
    0,
  );

  return {
    hunks,
    splitLineCount: splitLineStart + trailingLineCount,
    unifiedLineCount: unifiedLineStart + trailingLineCount,
  };
}

function canHydrateProviderFileDiff(fileDiff: FileDiffMetadata) {
  return (
    fileDiff.isPartial &&
    fileDiff.hunks.length > 0 &&
    (fileDiff.type === 'change' || fileDiff.type === 'rename-changed')
  );
}

function createExpandableProviderShellDiff(fileDiff: FileDiffMetadata) {
  if (!canHydrateProviderFileDiff(fileDiff)) {
    return fileDiff;
  }

  return {
    ...fileDiff,
    isPartial: true,
    cacheKey: `${PROVIDER_SHELL_CACHE_KEY_PREFIX}:${fileDiff.cacheKey ?? fileDiff.name}`,
  } satisfies FileDiffMetadata;
}

function isExpandableProviderShellDiff(fileDiff: FileDiffMetadata) {
  return fileDiff.cacheKey?.startsWith(`${PROVIDER_SHELL_CACHE_KEY_PREFIX}:`) === true;
}

function createProviderShellExpandButton(direction: ExpansionDirections) {
  const button = document.createElement('div');
  button.setAttribute('role', 'button');
  button.setAttribute('data-expand-button', '');
  button.setAttribute('data-provider-shell-expand-button', '');
  button.setAttribute(`data-expand-${direction}`, '');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('data-icon', '');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('viewBox', '0 0 16 16');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', direction === 'both' ? '#diffs-icon-expand-all' : '#diffs-icon-expand');
  icon.append(use);
  button.append(icon);
  return button;
}

function installProviderShellExpandControls(node: HTMLElement, fileDiff: FileDiffMetadata) {
  const root = node.shadowRoot;
  if (!root) {
    return;
  }

  const expandableHunkIndexes = fileDiff.hunks.flatMap((hunk, hunkIndex) =>
    hunk.collapsedBefore > 0 ? [hunkIndex] : [],
  );
  const separators = Array.from(root.querySelectorAll('[data-separator]')).filter(
    (separator): separator is HTMLElement =>
      separator instanceof HTMLElement &&
      (separator.hasAttribute('data-unmodified-lines') ||
        separator.querySelector('[data-unmodified-lines]') !== null),
  );

  for (const [separatorIndex, separator] of separators.entries()) {
    const hunkIndex = expandableHunkIndexes[separatorIndex];
    if (hunkIndex === undefined) {
      continue;
    }

    const direction = hunkIndex === 0 ? 'down' : 'both';
    separator.setAttribute('data-expand-index', String(hunkIndex));
    separator.setAttribute(`data-expand-${direction}`, '');

    const wrapper = separator.querySelector('[data-separator-wrapper]');
    if (!(wrapper instanceof HTMLElement)) {
      continue;
    }
    if (wrapper.querySelector('[data-provider-shell-expand-button]')) {
      continue;
    }

    wrapper.setAttribute('data-provider-shell-separator-wrapper', '');
    wrapper.prepend(createProviderShellExpandButton(direction));
  }
}

function hydrateProviderFileDiff(fileDiff: FileDiffMetadata, fileContents: PrFileContents) {
  const deletionLines = splitFileContentLines(fileContents.oldContent);
  const additionLines = splitFileContentLines(fileContents.newContent);
  const indexed = buildIndexedHunks({
    fileDiff,
    deletionLines,
    additionLines,
    fillFromPartialPatch: false,
  });

  return {
    ...fileDiff,
    hunks: indexed.hunks,
    splitLineCount: indexed.splitLineCount,
    unifiedLineCount: indexed.unifiedLineCount,
    isPartial: false,
    deletionLines,
    additionLines,
    cacheKey: [
      'provider-full',
      fileContents.providerId,
      fileContents.repoKey,
      fileContents.baseSha ?? '',
      fileContents.headSha,
      fileContents.oldPath,
      fileContents.newPath,
      fileDiff.cacheKey ?? fileDiff.name,
    ].join(':'),
  } satisfies FileDiffMetadata;
}

export {
  canHydrateProviderFileDiff,
  createExpandableProviderShellDiff,
  hydrateProviderFileDiff,
  installProviderShellExpandControls,
  isExpandableProviderShellDiff,
  PROVIDER_SHELL_COLLAPSED_CONTEXT_THRESHOLD,
};
