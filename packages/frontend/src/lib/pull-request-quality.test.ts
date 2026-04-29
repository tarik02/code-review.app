import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FileDiffMetadata } from '@pierre/diffs';
import type { PullRequestQualityReport } from '../types/forge';
import { buildPullRequestQualityView } from './pull-request-quality';

function createFileDiff(
  name: string,
  additionStart: number,
  additionCount: number,
): FileDiffMetadata {
  return {
    name,
    type: 'change',
    hunks: [
      {
        collapsedBefore: 0,
        additionStart,
        additionCount,
        additionLines: additionCount,
        additionLineIndex: 0,
        deletionStart: additionStart,
        deletionCount: additionCount,
        deletionLines: 0,
        deletionLineIndex: 0,
        hunkContent: [],
        splitLineStart: 0,
        splitLineCount: additionCount,
        unifiedLineStart: 0,
        unifiedLineCount: additionCount,
        noEOFCRDeletions: false,
        noEOFCRAdditions: false,
      },
    ],
    splitLineCount: additionCount,
    unifiedLineCount: additionCount,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
  };
}

function createReport(findings: PullRequestQualityReport['findings']): PullRequestQualityReport {
  return {
    provider: 'github',
    repoKey: 'owner/repo',
    number: 1,
    headSha: 'abc123',
    status: 'warning',
    summary: {
      totalFindings: findings.length,
      inlineFindings: findings.filter((finding) => finding.anchorState === 'inline').length,
      fileOnlyFindings: findings.filter((finding) => finding.anchorState !== 'inline').length,
      providerLabel: 'GitHub checks',
    },
    findings,
    fetchedAt: new Date().toISOString(),
  };
}

describe('buildPullRequestQualityView', () => {
  it('maps visible addition-line findings to inline annotations', () => {
    const report = createReport([
      {
        id: 'finding-1',
        sourceType: 'github-check',
        sourceName: 'lint',
        severity: 'warning',
        status: 'new',
        title: 'Unused variable',
        path: 'src/app.ts',
        line: 12,
        anchorState: 'inline',
      },
    ]);

    const view = buildPullRequestQualityView(report, [createFileDiff('src/app.ts', 10, 5)]);

    assert.equal(view.displayedInlineCount, 1);
    assert.equal(view.displayedFileCount, 0);
    assert.equal(view.unmappedFindings.length, 0);
    assert.equal(view.byFile.get('src/app.ts')?.inlineAnnotations[0]?.lineNumber, 12);
  });

  it('falls back to file-level when the line is outside rendered additions', () => {
    const report = createReport([
      {
        id: 'finding-2',
        sourceType: 'gitlab-code-quality',
        sourceName: 'GitLab Code Quality',
        severity: 'major',
        status: 'new',
        title: 'Complex method',
        path: 'src/app.ts',
        line: 40,
        anchorState: 'inline',
      },
    ]);

    const view = buildPullRequestQualityView(report, [createFileDiff('src/app.ts', 10, 5)]);

    assert.equal(view.displayedInlineCount, 0);
    assert.equal(view.displayedFileCount, 1);
    assert.equal(view.byFile.get('src/app.ts')?.fileFindings.length, 1);
  });

  it('surfaces missing-path findings as unmapped', () => {
    const report = createReport([
      {
        id: 'finding-3',
        sourceType: 'gitlab-code-quality',
        sourceName: 'GitLab Code Quality',
        severity: 'minor',
        status: 'new',
        title: 'Formatting issue',
        path: 'src/missing.ts',
        line: 4,
        anchorState: 'inline',
      },
    ]);

    const view = buildPullRequestQualityView(report, [createFileDiff('src/app.ts', 1, 10)]);

    assert.equal(view.displayedInlineCount, 0);
    assert.equal(view.displayedFileCount, 0);
    assert.equal(view.unmappedFindings.length, 1);
    assert.equal(view.unmappedFindings[0]?.path, 'src/missing.ts');
  });
});
