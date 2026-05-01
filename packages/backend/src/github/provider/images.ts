function getOwnerLogin(nameWithOwner: string) {
  const [owner] = nameWithOwner.split('/');
  return owner || nameWithOwner;
}

function prepareGitHubProviderImageUrl(
  input: string | null | undefined,
  options: {
    host: string;
    nameWithOwner: string;
    size?: number;
  },
) {
  if (input) {
    return input;
  }

  const ownerLogin = getOwnerLogin(options.nameWithOwner);
  const normalizedHost = new URL(
    /^[a-z][a-z0-9+.-]*:\/\//i.test(options.host) ? options.host : `https://${options.host}`,
  ).origin.toLowerCase();
  return `${normalizedHost}/${ownerLogin}.png?size=${options.size ?? 40}`;
}

export { prepareGitHubProviderImageUrl };
