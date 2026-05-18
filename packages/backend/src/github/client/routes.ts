import { createBuildRoute } from '../../providers/route.ts';

type GithubRepoAffiliation = 'owner' | 'collaborator' | 'organization_member';

type GithubRoutes = {
  '/user': {};
  '/user/orgs': {
    query: {
      per_page?: number;
    };
  };
  '/user/repos': {
    query: {
      per_page?: number;
      sort?: 'created' | 'updated' | 'pushed' | 'full_name';
      affiliation?: GithubRepoAffiliation | ReadonlyArray<GithubRepoAffiliation>;
    };
  };
  '/search/repositories': {
    query: {
      q: string;
      per_page?: number;
    };
  };
  '/search/users': {
    query: {
      q: string;
      per_page?: number;
    };
  };
  '/repos/:owner/:name': {};
  '/repos/:owner/:name/pulls': {
    query: {
      state?: 'open' | 'closed' | 'all';
      per_page?: number;
      page?: number;
    };
  };
  '/repos/:owner/:name/pulls/:number': {};
  '/repos/:owner/:name/pulls/:number/files': {
    query: {
      per_page?: number;
      page?: number;
    };
  };
  '/repos/:owner/:name/pulls/:number/reviews': {
    query: {
      per_page?: number;
      page?: number;
    };
  };
  '/repos/:owner/:name/pulls/:number/reviews/:reviewId/comments': {
    query: {
      per_page?: number;
    };
  };
  '/repos/:owner/:name/pulls/:number/reviews/:reviewId/dismissals': {};
  '/repos/:owner/:name/contents/:path': {
    query: {
      ref: string;
    };
  };
  '/repos/:owner/:name/commits/:headSha/check-runs': {
    query: {
      per_page?: number;
      page?: number;
    };
  };
  '/repos/:owner/:name/check-runs/:checkRunId/annotations': {
    query: {
      per_page?: number;
      page?: number;
    };
  };
};

const githubRoute = createBuildRoute<GithubRoutes>();

const initialRepoAffiliations = [
  'owner',
  'collaborator',
  'organization_member',
] as const satisfies ReadonlyArray<GithubRepoAffiliation>;

export { githubRoute, initialRepoAffiliations };
export type { GithubRepoAffiliation, GithubRoutes };
