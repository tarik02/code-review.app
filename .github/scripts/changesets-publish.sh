#!/usr/bin/env bash
set -euo pipefail

version="$(jq -r '.version' package.json)"
tag="v${version}"

if git rev-parse --verify --quiet "refs/tags/${tag}" >/dev/null; then
  printf 'tag %s already exists\n' "${tag}"
  exit 0
fi

printf 'creating tag %s for %s\n' "${tag}" "${GITHUB_SHA}"

git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
git tag "${tag}" "${GITHUB_SHA}"
git push origin "refs/tags/${tag}"
