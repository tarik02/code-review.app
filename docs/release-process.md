# Release process

`code-review.app` uses root-only Changesets versioning and tag-driven GitHub Actions releases.

## release target

The repo root package is the only release target.

- `package.json` at the repo root is the source of truth for the app version.
- Workspace package versions are placeholders only.
- Non-root workspace packages are not independently released.

## adding a changeset

Run:

```bash
pnpm changeset
```

Select only the root package and write the release note summary for the change.

## release flow

1. Make the code change.
2. Add a root-target changeset when the change should ship in a release.
3. Merge the change to `master`.
4. Let `version-pr.yaml` open or update the version PR.
5. Merge the version PR.
6. Push tag `vX.Y.Z` from that merged commit.
7. Let `ci.yaml` build all release targets and publish the GitHub Release.

## release artifacts

`ci.yaml` builds:

- macOS `x64`
- macOS `arm64`
- Linux `x64`
- Linux `arm64`
- Windows `x64`
- Windows `arm64`

Updater metadata is post-processed in CI:

- Windows metadata is merged into one `latest.yml`
- macOS metadata is merged into one `latest-mac.yml`
- Linux metadata stays split by architecture as `latest-linux.yml` and `latest-linux-arm64.yml`
