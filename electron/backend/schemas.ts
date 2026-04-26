import { z } from "zod";

const forgeProviderKindSchema = z.enum(["github", "gitlab"]);
const reviewCommentSideSchema = z.enum(["LEFT", "RIGHT"]);

const repoSummarySchema = z.object({
  id: z.string(),
  provider: forgeProviderKindSchema,
  host: z.string(),
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

const providerHostLimitSchema = z.object({
  provider: forgeProviderKindSchema.optional(),
  host: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

const repoIdSchema = z.object({
  repoId: z.string().min(1),
});

const pullRequestInputSchema = repoIdSchema.extend({
  number: z.number().int().nonnegative(),
});

const pullRequestVersionedInputSchema = pullRequestInputSchema.extend({
  headSha: z.string().min(1),
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
  createPullRequestReviewCommentInputSchema,
  forgeProviderKindSchema,
  providerHostLimitSchema,
  pullRequestInputSchema,
  pullRequestSummarySchema,
  pullRequestVersionedInputSchema,
  replyToPullRequestReviewCommentInputSchema,
  repoIdSchema,
  repoSummarySchema,
  updatePullRequestReviewCommentInputSchema,
};
