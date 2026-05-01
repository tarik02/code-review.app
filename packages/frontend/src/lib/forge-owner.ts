function getOwnerLogin(nameWithOwner: string) {
  const [owner] = nameWithOwner.split('/');
  return owner || nameWithOwner;
}

function getOwnerInitials(nameWithOwner: string) {
  return getOwnerLogin(nameWithOwner).slice(0, 1).toUpperCase();
}

export { getOwnerInitials, getOwnerLogin };
