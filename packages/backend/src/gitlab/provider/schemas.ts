import type { PrChangedFile } from '@code-review-app/shared';
import type { ProviderRepoIdentity } from '../../repo-id.ts';
import type { GitLabDiff } from '../client/schemas.ts';
import type { GitLabOverviewMergeRequestScope } from '../client/routes.ts';

const OVERVIEW_MERGE_REQUEST_SCOPES = [
  'reviews_for_me',
  'assigned_to_me',
  'created_by_me',
] as const satisfies ReadonlyArray<GitLabOverviewMergeRequestScope>;

function toChangedFile(diff: GitLabDiff): PrChangedFile {
  const oldPath = diff.old_path.trim();
  const newPath = diff.new_path.trim();
  const path = newPath || oldPath;

  if (diff.new_file) {
    return {
      path,
      oldPath: '',
      newPath,
      changeType: 'new',
    };
  }

  if (diff.deleted_file) {
    return {
      path,
      oldPath,
      newPath: '',
      changeType: 'deleted',
    };
  }

  if (diff.renamed_file) {
    return {
      path,
      oldPath,
      newPath,
      changeType: 'rename-changed',
    };
  }

  return {
    path,
    oldPath,
    newPath,
    changeType: 'change',
  };
}

function gitlabWebUrl(host: string, path: string) {
  return `${host}${path}`;
}

function mergeRequestWebUrl(repo: ProviderRepoIdentity, number: number) {
  return gitlabWebUrl(repo.host, `/${repo.path}/-/merge_requests/${number}`);
}

export { gitlabWebUrl, mergeRequestWebUrl, OVERVIEW_MERGE_REQUEST_SCOPES, toChangedFile };
