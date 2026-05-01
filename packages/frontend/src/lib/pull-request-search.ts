import type { PullRequestSearchState, PullRequestSummary } from '../types/forge';

function matchesPullRequestSearchState(
  pullRequest: PullRequestSummary,
  state: PullRequestSearchState,
) {
  if (state === 'all') {
    return true;
  }

  if (pullRequest.state !== 'OPEN') {
    return false;
  }

  return state === 'draft_open' || !pullRequest.isDraft;
}

export { matchesPullRequestSearchState };
