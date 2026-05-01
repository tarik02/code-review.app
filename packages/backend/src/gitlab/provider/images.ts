import { createProviderImageUrl } from '../../services/provider-images.ts';

type GitLabProviderImageResource = {
  path?: string;
  type?: 'group' | 'project';
};

function resolveGitLabProviderImageSourceUrl(
  input: string,
  resource?: GitLabProviderImageResource,
) {
  const url = new URL(input);
  if (resource?.path && resource.type) {
    const apiResourceType = resource.type === 'project' ? 'projects' : 'groups';
    return `${url.origin}/api/v4/${apiResourceType}/${encodeURIComponent(resource.path)}/avatar`;
  }

  const uploadAvatarMatch = /^\/uploads\/-\/system\/(project|group)\/avatar\/(\d+)\//.exec(
    url.pathname,
  );
  if (!uploadAvatarMatch) {
    return input;
  }

  const [, resourceType, resourceId] = uploadAvatarMatch;
  const apiResourceType = resourceType === 'project' ? 'projects' : 'groups';
  return `${url.origin}/api/v4/${apiResourceType}/${resourceId}/avatar`;
}

function prepareGitLabProviderImageUrl(
  accountId: string,
  input: string | null | undefined,
  resource?: GitLabProviderImageResource,
) {
  if (!input) {
    return null;
  }

  return createProviderImageUrl({
    accountId,
    url: resolveGitLabProviderImageSourceUrl(input, resource),
  });
}

export { prepareGitLabProviderImageUrl };
export type { GitLabProviderImageResource };
