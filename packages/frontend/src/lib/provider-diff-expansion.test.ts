import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vite-plus/test';
import { FileDiff } from '@pierre/diffs/react';
import {
  DiffHunksRenderer,
  getSharedHighlighter,
  renderDiffWithHighlighter,
  type FileDiffMetadata,
} from '@pierre/diffs';
import {
  createExpandableProviderShellDiff,
  hydrateProviderFileDiff,
  isExpandableProviderShellDiff,
  PROVIDER_SHELL_COLLAPSED_CONTEXT_THRESHOLD,
} from './provider-diff-expansion';
import type { PrFileContents } from '../types/forge';

function createPartialProviderDiff(): FileDiffMetadata {
  return {
    name: 'src/app.ts',
    type: 'change',
    hunks: [
      {
        collapsedBefore: 5,
        additionStart: 6,
        additionCount: 3,
        additionLines: 1,
        additionLineIndex: 0,
        deletionStart: 6,
        deletionCount: 3,
        deletionLines: 1,
        deletionLineIndex: 0,
        hunkContent: [
          {
            type: 'context',
            lines: 1,
            deletionLineIndex: 0,
            additionLineIndex: 0,
          },
          {
            type: 'change',
            deletions: 1,
            deletionLineIndex: 1,
            additions: 1,
            additionLineIndex: 1,
          },
          {
            type: 'context',
            lines: 1,
            deletionLineIndex: 2,
            additionLineIndex: 2,
          },
        ],
        splitLineStart: 5,
        splitLineCount: 3,
        unifiedLineStart: 5,
        unifiedLineCount: 4,
        noEOFCRDeletions: false,
        noEOFCRAdditions: false,
      },
    ],
    splitLineCount: 8,
    unifiedLineCount: 9,
    isPartial: true,
    deletionLines: ['keep();\n', 'const beforeValue = computeBeforeValue();\n', 'done();\n'],
    additionLines: ['keep();\n', 'x\n', 'done();\n'],
    cacheKey: 'provider:src/app.ts',
  };
}

describe('provider diff expansion', () => {
  it('renders an expandable provider shell through react without replacing patch content', () => {
    const shell = createExpandableProviderShellDiff(createPartialProviderDiff());

    const html = renderToStaticMarkup(
      createElement(FileDiff, {
        fileDiff: shell,
        options: {
          diffStyle: 'unified',
          lineDiffType: 'word',
        },
      }),
    );

    expect(isExpandableProviderShellDiff(shell)).toBe(true);
    expect(shell.isPartial).toBe(true);
    expect(shell.deletionLines[0]).toBe('keep();\n');
    expect(shell.additionLines[1]).toBe('x\n');
    expect(html).toContain('diffs-container');
  });

  it('does not auto-expand provider shell placeholders into visible blank rows', async () => {
    const shell = createExpandableProviderShellDiff(createPartialProviderDiff());
    const renderer = new DiffHunksRenderer({
      collapsedContextThreshold: PROVIDER_SHELL_COLLAPSED_CONTEXT_THRESHOLD,
      diffStyle: 'unified',
      lineDiffType: 'word',
      theme: 'github-light',
    });

    const result = await renderer.asyncRender(shell);
    const html = renderer.renderFullHTML(result);

    expect(result.hunkData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hunkIndex: 0,
          lines: 5,
          expandable: undefined,
        }),
      ]),
    );
    expect(html.match(/data-line=/g)).toHaveLength(4);
    expect(html).toContain('5 unmodified lines');
  });

  it('keeps shiki word decorations valid for sparse provider shells', async () => {
    const shell = createExpandableProviderShellDiff(createPartialProviderDiff());
    const highlighter = await getSharedHighlighter({
      langs: ['typescript'],
      themes: ['github-light'],
    });

    expect(() =>
      renderDiffWithHighlighter(shell, highlighter, {
        theme: 'github-light',
        useTokenTransformer: false,
        tokenizeMaxLineLength: 1000,
        lineDiffType: 'word',
        maxLineDiffLength: 1000,
      }),
    ).not.toThrow();
  });

  it('hydrates provider diffs with full file lines while preserving hunk indexes', () => {
    const partial = createPartialProviderDiff();
    const fileContents: PrFileContents = {
      providerId: 'github:default',
      repoKey: 'owner/repo',
      oldPath: 'src/app.ts',
      newPath: 'src/app.ts',
      baseSha: 'base',
      headSha: 'head',
      oldContent: [
        'line 1',
        'line 2',
        'line 3',
        'line 4',
        'line 5',
        'keep();',
        'const beforeValue = computeBeforeValue();',
        'done();',
        'tail();',
      ].join('\n'),
      newContent: [
        'line 1',
        'line 2',
        'line 3',
        'line 4',
        'line 5',
        'keep();',
        'x',
        'done();',
        'tail();',
      ].join('\n'),
    };

    const hydrated = hydrateProviderFileDiff(partial, fileContents);

    expect(hydrated.isPartial).toBe(false);
    expect(hydrated.hunks).toHaveLength(partial.hunks.length);
    expect(hydrated.hunks[0]?.additionLineIndex).toBe(5);
    expect(hydrated.hunks[0]?.deletionLineIndex).toBe(5);
    expect(hydrated.additionLines[6]).toBe('x\n');
    expect(hydrated.deletionLines[6]).toBe('const beforeValue = computeBeforeValue();\n');
    expect(hydrated.unifiedLineCount).toBeGreaterThan(partial.unifiedLineCount);
  });

  it('renders hydrated provider diffs with native expandable regions', async () => {
    const partial = createPartialProviderDiff();
    const hydrated = hydrateProviderFileDiff(partial, {
      providerId: 'github:default',
      repoKey: 'owner/repo',
      oldPath: 'src/app.ts',
      newPath: 'src/app.ts',
      baseSha: 'base',
      headSha: 'head',
      oldContent: [
        'line 1',
        'line 2',
        'line 3',
        'line 4',
        'line 5',
        'keep();',
        'const beforeValue = computeBeforeValue();',
        'done();',
        'tail();',
        'tail 2;',
        'tail 3;',
      ].join('\n'),
      newContent: [
        'line 1',
        'line 2',
        'line 3',
        'line 4',
        'line 5',
        'keep();',
        'x',
        'done();',
        'tail();',
        'tail 2;',
        'tail 3;',
      ].join('\n'),
    });
    const renderer = new DiffHunksRenderer({
      diffStyle: 'unified',
      lineDiffType: 'word',
      theme: 'github-light',
    });

    const result = await renderer.asyncRender(hydrated);
    const html = renderer.renderFullHTML(result);

    expect(result.hunkData[0]?.hunkIndex).toBe(0);
    expect(result.hunkData[0]?.lines).toBe(5);
    expect(result.hunkData[0]?.expandable?.up).toBe(false);
    expect(result.hunkData[0]?.expandable?.down).toBe(true);
    expect(result.hunkData[1]?.hunkIndex).toBe(hydrated.hunks.length);
    expect(result.hunkData[1]?.lines).toBe(3);
    expect(result.hunkData[1]?.expandable?.up).toBe(true);
    expect(result.hunkData[1]?.expandable?.down).toBe(false);
    expect(html).toContain('data-expand-index="0"');
    expect(html).toContain(`data-expand-index="${hydrated.hunks.length}"`);
  });
});
