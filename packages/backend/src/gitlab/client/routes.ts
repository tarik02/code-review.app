import type { ProviderRepoIdentity } from '../../repo-id.ts';
import { createBuildRoute } from '../../providers/route.ts';

type GitLabOverviewMergeRequestScope = 'reviews_for_me' | 'assigned_to_me' | 'created_by_me';

type GitlabRoutes = {
  user: {};
  projects: {
    query: {
      membership?: boolean;
      simple?: boolean;
      per_page?: number;
      search?: string;
    };
  };
  merge_requests: {
    query: {
      scope: GitLabOverviewMergeRequestScope;
      state: 'opened';
      order_by: 'updated_at';
      sort: 'desc';
      non_archived: 'true';
      per_page: number;
    };
  };
  'projects/:project': {};
  'projects/:project/merge_requests': {
    query: {
      state?: 'opened';
      order_by?: 'updated_at' | 'created_at';
      sort?: 'desc' | 'asc';
      per_page?: number;
    };
  };
  'projects/:project/merge_requests/:number': {};
  'projects/:project/merge_requests/:number/approvals': {};
  'projects/:project/merge_requests/:number/approve': {};
  'projects/:project/merge_requests/:number/unapprove': {};
  'projects/:project/merge_requests/:number/diffs': {
    query: {
      per_page?: number;
      page?: number;
    };
  };
  'projects/:project/merge_requests/:number/raw_diffs': {};
  'projects/:project/merge_requests/:number/versions': {};
  'projects/:project/repository/files/:path/raw': {
    query: {
      ref: string;
    };
  };
  'projects/:project/merge_requests/:number/discussions': {
    query: {
      per_page?: number;
      page?: number;
    };
  };
  'projects/:project/merge_requests/:number/discussions/:threadId': {};
  'projects/:project/merge_requests/:number/discussions/:threadId/notes': {};
  'projects/:project/merge_requests/:number/discussions/:threadId/notes/:commentId': {};
  'projects/:project/merge_requests/:number/notes': {
    query: {
      order_by?: 'created_at';
      sort?: 'asc' | 'desc';
      per_page?: number;
      page?: number;
    };
  };
  'projects/:project/merge_requests/:number/notes/:commentId': {};
  'projects/:project/merge_requests/:number/draft_notes': {};
  'projects/:project/merge_requests/:number/draft_notes/:draftNoteId': {};
  'projects/:project/merge_requests/:number/draft_notes/:draftNoteId/publish': {};
  'projects/:project/merge_requests/:number/draft_notes/bulk_publish': {};
};

const gitlabRoute = createBuildRoute<GitlabRoutes>();

function gitlabProjectPath(project: ProviderRepoIdentity | string) {
  return typeof project === 'string' ? project : project.path;
}

export { gitlabProjectPath, gitlabRoute };
export type { GitLabOverviewMergeRequestScope, GitlabRoutes };
