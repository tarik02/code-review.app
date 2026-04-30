import { describe, expect, it } from 'vite-plus/test';
import { dedupeOverviewPullRequestEntries } from './use-forge-queries';

describe('dedupeOverviewPullRequestEntries', () => {
  it('dedupes by provider, repo, and number while keeping the newest update', () => {
    const results = dedupeOverviewPullRequestEntries([
      {
        repo: {
          providerId: 'github:1',
          repoKey: 'acme/app',
          provider: 'github',
          host: 'https://github.com',
          providerAccountId: 'account-a',
          providerAccountLabel: 'account-a',
          name: 'app',
          nameWithOwner: 'acme/app',
          description: null,
          isPrivate: null,
          avatarUrl: null,
        },
        pullRequest: {
          number: 42,
          title: 'older',
          state: 'OPEN',
          isDraft: false,
          mergeStateStatus: 'CLEAN',
          mergeable: 'MERGEABLE',
          additions: 1,
          deletions: 1,
          changeCount: null,
          authorLogin: 'alice',
          updatedAt: '2026-04-28T10:00:00.000Z',
          url: 'https://example.com/older',
          headSha: 'aaa',
          baseSha: null,
        },
      },
      {
        repo: {
          providerId: 'github:1',
          repoKey: 'acme/app',
          provider: 'github',
          host: 'https://github.com',
          providerAccountId: 'account-b',
          providerAccountLabel: 'account-b',
          name: 'app',
          nameWithOwner: 'acme/app',
          description: null,
          isPrivate: null,
          avatarUrl: null,
        },
        pullRequest: {
          number: 42,
          title: 'newer',
          state: 'OPEN',
          isDraft: false,
          mergeStateStatus: 'CLEAN',
          mergeable: 'MERGEABLE',
          additions: 3,
          deletions: 2,
          changeCount: null,
          authorLogin: 'alice',
          updatedAt: '2026-04-29T10:00:00.000Z',
          url: 'https://example.com/newer',
          headSha: 'bbb',
          baseSha: null,
        },
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.pullRequest.title).toBe('newer');
    expect(results[0]?.pullRequest.headSha).toBe('bbb');
  });
});
