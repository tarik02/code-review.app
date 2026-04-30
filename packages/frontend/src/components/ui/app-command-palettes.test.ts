import { describe, expect, it } from 'vite-plus/test';
import { buildPullRequestContentPaletteItems } from './app-command-palettes';

describe('buildPullRequestContentPaletteItems', () => {
  it('builds file items before comment items', () => {
    const items = buildPullRequestContentPaletteItems({
      changedFiles: ['src/app.ts', 'src/lib/utils.ts'],
      patchViewerSessionKey: 'pr-1',
      reviewThreads: [],
    });

    expect(items.map((item) => [item.group, item.title])).toEqual([
      ['Files', 'src/app.ts'],
      ['Files', 'src/lib/utils.ts'],
    ]);
  });

  it('builds thread preview items with file and status metadata', () => {
    const items = buildPullRequestContentPaletteItems({
      changedFiles: [],
      patchViewerSessionKey: 'pr-1',
      reviewThreads: [
        {
          id: 'thread-1',
          provider: 'github',
          path: 'src/app.ts',
          canResolve: true,
          isResolved: true,
          isOutdated: false,
          line: 12,
          startLine: null,
          side: 'RIGHT',
          startSide: null,
          subjectType: 'line',
          comments: [
            {
              id: 'comment-1',
              databaseId: 1,
              authorLogin: 'alice',
              authorAvatarUrl: null,
              authorAssociation: null,
              body: 'Please split this function.',
              createdAt: '2026-04-30T10:00:00.000Z',
              updatedAt: '2026-04-30T10:00:00.000Z',
              url: 'https://example.com/comment-1',
              replyToId: null,
            },
          ],
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.group).toBe('Comments');
    expect(items[0]?.title).toBe('Please split this function.');
    expect(items[0]?.subtitle).toContain('src/app.ts');
    expect(items[0]?.subtitle).toContain('alice');
    expect(items[0]?.subtitle).toContain('resolved');
  });
});
