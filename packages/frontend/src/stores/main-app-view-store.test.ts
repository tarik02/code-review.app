import { describe, expect, it } from 'vite-plus/test';
import {
  applyProfileFilterChange,
  applyRepoFilterChange,
  initialMainAppViewState,
} from './main-app-view-store';

describe('main app view store helpers', () => {
  it('repo selection forces the owning profile filter', () => {
    const next = applyRepoFilterChange(initialMainAppViewState, {
      providerAccountId: 'account-1',
      repoKey: 'acme/app',
    });

    expect(next).toEqual({
      profileFilterAccountId: 'account-1',
      repoFilterKey: 'acme/app',
    });
  });

  it('profile changes clear an incompatible repo filter', () => {
    const next = applyProfileFilterChange(
      {
        profileFilterAccountId: 'account-1',
        repoFilterKey: 'acme/app',
      },
      'account-2',
      {
        'acme/app': 'account-1',
      },
    );

    expect(next).toEqual({
      profileFilterAccountId: 'account-2',
      repoFilterKey: null,
    });
  });

  it('profile changes preserve a compatible repo filter', () => {
    const next = applyProfileFilterChange(
      {
        profileFilterAccountId: 'account-1',
        repoFilterKey: 'acme/app',
      },
      'account-1',
      {
        'acme/app': 'account-1',
      },
    );

    expect(next).toEqual({
      profileFilterAccountId: 'account-1',
      repoFilterKey: 'acme/app',
    });
  });
});
