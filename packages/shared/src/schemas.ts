import { z } from "zod";

const forgeProviderKindSchema = z.enum(["github", "gitlab"]);
const diffDataModeSchema = z.enum(["provider-api", "git"]);
const reviewEditorModeSchema = z.enum(["rich-text", "source"]);
const reviewCommentSideSchema = z.enum(["LEFT", "RIGHT"]);

const repoSummarySchema = z.object({
  providerId: z.string(),
  repoKey: z.string(),
  provider: forgeProviderKindSchema,
  host: z.string(),
  providerAccountId: z.string(),
  providerAccountLabel: z.string(),
  name: z.string(),
  nameWithOwner: z.string(),
  description: z.string().nullable(),
  isPrivate: z.boolean().nullable(),
  avatarUrl: z.string().nullable(),
});

const pullRequestSummarySchema = z.object({
  number: z.number().int().nonnegative(),
  title: z.string(),
  state: z.string(),
  isDraft: z.boolean(),
  mergeStateStatus: z.string(),
  mergeable: z.string(),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  changeCount: z.number().int().nonnegative().nullable(),
  authorLogin: z.string(),
  updatedAt: z.string(),
  url: z.string(),
  headSha: z.string(),
  baseSha: z.string().nullable(),
});

const overviewPullRequestSummarySchema = z.object({
  repo: repoSummarySchema,
  pullRequest: pullRequestSummarySchema,
});

const providerHostSchema = z.object({
  provider: forgeProviderKindSchema,
  host: z.string(),
  clientId: z.string().optional().default(""),
  clientSecret: z.string().optional().default(""),
});

const completeOAuthSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const providerAccountSchema = z.object({
  accountId: z.string().min(1),
});

const accountVisibilitySettingsSchema = z.object({
  enabledAccountIds: z.array(z.string()),
});

const diffDataSettingsSchema = z.object({
  mode: diffDataModeSchema,
});

const reviewEditorSettingsSchema = z.object({
  defaultMode: reviewEditorModeSchema,
});

const appearanceBackgroundInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default") }),
  z.object({
    kind: z.literal("solid"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
]);

const providerProfileSchema = z.object({
  accountId: z.string(),
  login: z.string(),
});

const repoIdentitySchema = z.object({
  providerId: z.string().min(1),
  repoKey: z.string().min(1),
});

const pullRequestInputSchema = repoIdentitySchema.extend({
  number: z.number().int().nonnegative(),
});

const pullRequestVersionedInputSchema = pullRequestInputSchema.extend({
  headSha: z.string().min(1),
});

const prFileChangeTypeSchema = z.enum([
  "change",
  "rename-pure",
  "rename-changed",
  "new",
  "deleted",
]);

const pullRequestFileContentsInputSchema = repoIdentitySchema.extend({
  number: z.number().int().nonnegative(),
  oldPath: z.string(),
  newPath: z.string(),
  baseSha: z.string().nullable(),
  headSha: z.string().min(1),
  changeType: prFileChangeTypeSchema,
});

const createPullRequestReviewCommentInputSchema = pullRequestInputSchema.extend({
  body: z.string(),
  path: z.string(),
  oldPath: z.string(),
  newPath: z.string(),
  line: z.number().int().nonnegative().nullable(),
  side: reviewCommentSideSchema.nullable(),
  startLine: z.number().int().nonnegative().nullable(),
  startSide: reviewCommentSideSchema.nullable(),
  subjectType: z.enum(["file", "line"]),
});

const replyToPullRequestReviewCommentInputSchema = pullRequestInputSchema.extend({
  threadId: z.string(),
  body: z.string(),
});

const updatePullRequestReviewCommentInputSchema =
  replyToPullRequestReviewCommentInputSchema.extend({
    commentId: z.string(),
  });

export {
  accountVisibilitySettingsSchema,
  appearanceBackgroundInputSchema,
  completeOAuthSchema,
  createPullRequestReviewCommentInputSchema,
  diffDataModeSchema,
  diffDataSettingsSchema,
  forgeProviderKindSchema,
  overviewPullRequestSummarySchema,
  providerAccountSchema,
  providerProfileSchema,
  providerHostSchema,
  pullRequestInputSchema,
  pullRequestFileContentsInputSchema,
  pullRequestSummarySchema,
  pullRequestVersionedInputSchema,
  replyToPullRequestReviewCommentInputSchema,
  reviewEditorModeSchema,
  reviewEditorSettingsSchema,
  repoIdentitySchema,
  repoSummarySchema,
  updatePullRequestReviewCommentInputSchema,
};
