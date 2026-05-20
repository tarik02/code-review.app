import { Schema } from 'effect';

type GraphQlResponse<T> = {
  data?: T | null;
  errors?: ReadonlyArray<{ message: string }> | null;
};

const NullableString = Schema.NullOr(Schema.String);
const OptionalNullableString = Schema.optional(Schema.NullOr(Schema.String));
const OptionalNullableNumber = Schema.optional(Schema.NullOr(Schema.Number));

const GhActorSchema = Schema.Struct({
  login: Schema.String,
  avatarUrl: OptionalNullableString,
  avatar_url: OptionalNullableString,
  url: OptionalNullableString,
  html_url: OptionalNullableString,
});

const GhSearchRepoSchema = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  description: NullableString,
  private: Schema.NullOr(Schema.Boolean),
  owner: Schema.optional(Schema.NullOr(GhActorSchema)),
});

const GhRestRepoSchema = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  description: NullableString,
  private: Schema.NullOr(Schema.Boolean),
  owner: Schema.optional(Schema.NullOr(GhActorSchema)),
});

const GhRestPullRequestRefSchema = Schema.Struct({
  sha: Schema.String,
});

const GhRestPullRequestSchema = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  draft: Schema.optional(Schema.Boolean),
  additions: OptionalNullableNumber,
  deletions: OptionalNullableNumber,
  user: Schema.optional(Schema.NullOr(GhActorSchema)),
  updated_at: Schema.String,
  html_url: Schema.String,
  head: GhRestPullRequestRefSchema,
  base: GhRestPullRequestRefSchema,
  merged_at: OptionalNullableString,
});

const GhGraphqlRepoSchema = Schema.Struct({
  name: Schema.String,
  nameWithOwner: Schema.String,
  description: NullableString,
  isPrivate: Schema.NullOr(Schema.Boolean),
  owner: Schema.optional(Schema.NullOr(GhActorSchema)),
});

const GhRestUserSchema = Schema.Struct({
  login: Schema.String,
});

const GhSearchUserSchema = Schema.Struct({
  login: Schema.String,
  type: Schema.String,
  avatar_url: OptionalNullableString,
  html_url: OptionalNullableString,
});

const GhSearchResponseSchema = Schema.Struct({
  items: Schema.Array(GhSearchRepoSchema),
});

const GhSearchUsersResponseSchema = Schema.Struct({
  items: Schema.Array(GhSearchUserSchema),
});

const GhChangedFileSchema = Schema.Struct({
  filename: Schema.String,
  previous_filename: OptionalNullableString,
  status: Schema.String,
  changes: OptionalNullableNumber,
});

const GhPullRequestReviewSchema = Schema.Struct({
  id: Schema.Number,
  node_id: OptionalNullableString,
  body: OptionalNullableString,
  state: Schema.String,
  submitted_at: OptionalNullableString,
  commit_id: OptionalNullableString,
  html_url: OptionalNullableString,
  user: Schema.optional(Schema.NullOr(GhActorSchema)),
});

const GhPendingReviewCommentSchema = Schema.Struct({
  id: Schema.Number,
  node_id: Schema.String,
  body: Schema.String,
  path: Schema.String,
  line: OptionalNullableNumber,
  start_line: OptionalNullableNumber,
  side: OptionalNullableString,
  start_side: OptionalNullableString,
  in_reply_to_id: OptionalNullableNumber,
  created_at: Schema.String,
  updated_at: Schema.String,
  html_url: Schema.String,
  author_association: OptionalNullableString,
  user: Schema.optional(Schema.NullOr(GhActorSchema)),
});

const GhCheckRunOutputSchema = Schema.Struct({
  title: OptionalNullableString,
  summary: OptionalNullableString,
  text: OptionalNullableString,
  annotations_count: OptionalNullableNumber,
});

const GhCheckRunSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  status: Schema.String,
  conclusion: OptionalNullableString,
  details_url: OptionalNullableString,
  html_url: OptionalNullableString,
  app: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        name: Schema.String,
      }),
    ),
  ),
  output: Schema.optional(Schema.NullOr(GhCheckRunOutputSchema)),
});

const GhCheckRunsResponseSchema = Schema.Struct({
  total_count: OptionalNullableNumber,
  check_runs: Schema.Array(GhCheckRunSchema),
});

const GhCheckRunAnnotationSchema = Schema.Struct({
  path: Schema.String,
  start_line: Schema.Number,
  end_line: OptionalNullableNumber,
  annotation_level: Schema.String,
  message: Schema.String,
  title: OptionalNullableString,
  raw_details: OptionalNullableString,
});

type GhChangedFile = typeof GhChangedFileSchema.Type;
type GhCheckRun = typeof GhCheckRunSchema.Type;
type GhCheckRunAnnotation = typeof GhCheckRunAnnotationSchema.Type;
type GhPendingReviewComment = typeof GhPendingReviewCommentSchema.Type;
type GhPullRequestReview = typeof GhPullRequestReviewSchema.Type;

const GhPullRequestFields = {
  number: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  isDraft: Schema.Boolean,
  mergeStateStatus: OptionalNullableString,
  mergeable: OptionalNullableString,
  additions: OptionalNullableNumber,
  deletions: OptionalNullableNumber,
  body: OptionalNullableString,
  author: Schema.optional(Schema.NullOr(GhActorSchema)),
  updatedAt: Schema.String,
  url: Schema.String,
  headRefOid: Schema.String,
  baseRefOid: OptionalNullableString,
  mergedAt: OptionalNullableString,
};

const GhPullRequestSchema = Schema.Struct(GhPullRequestFields);

const GhOverviewPullRequestSchema = Schema.Struct({
  ...GhPullRequestFields,
  repository: Schema.optional(Schema.NullOr(GhGraphqlRepoSchema)),
});

const PullRequestNodeIdQueryDataSchema = Schema.Struct({
  repository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              id: Schema.String,
            }),
          ),
        ),
      }),
    ),
  ),
});

const GraphQlReviewCommentSchema = Schema.Struct({
  id: Schema.String,
  databaseId: OptionalNullableNumber,
  body: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  url: Schema.String,
  path: Schema.String,
  authorAssociation: OptionalNullableString,
  author: Schema.optional(Schema.NullOr(GhActorSchema)),
  replyTo: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
      }),
    ),
  ),
});

const GraphQlConversationCommentSchema = Schema.Struct({
  id: Schema.String,
  databaseId: OptionalNullableNumber,
  body: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  url: Schema.String,
  authorAssociation: OptionalNullableString,
  author: Schema.optional(Schema.NullOr(GhActorSchema)),
});

const GraphQlReviewThreadSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  line: OptionalNullableNumber,
  originalLine: OptionalNullableNumber,
  startLine: OptionalNullableNumber,
  originalStartLine: OptionalNullableNumber,
  diffSide: Schema.String,
  startDiffSide: OptionalNullableString,
  subjectType: Schema.String,
  comments: Schema.Struct({
    nodes: Schema.Array(GraphQlReviewCommentSchema),
  }),
});

const ReviewThreadsQueryDataSchema = Schema.Struct({
  repository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              reviewThreads: Schema.Struct({
                nodes: Schema.Array(GraphQlReviewThreadSchema),
              }),
              comments: Schema.Struct({
                nodes: Schema.Array(GraphQlConversationCommentSchema),
              }),
            }),
          ),
        ),
      }),
    ),
  ),
});

const AddPullRequestReviewDataSchema = Schema.Struct({
  addPullRequestReview: Schema.NullOr(
    Schema.Struct({
      pullRequestReview: Schema.NullOr(
        Schema.Struct({
          id: Schema.String,
        }),
      ),
    }),
  ),
});

const AddPullRequestReviewThreadDataSchema = Schema.Struct({
  addPullRequestReviewThread: Schema.NullOr(
    Schema.Struct({
      thread: Schema.NullOr(
        Schema.Struct({
          id: Schema.String,
          comments: Schema.Struct({
            nodes: Schema.Array(
              Schema.Struct({
                id: Schema.String,
              }),
            ),
          }),
        }),
      ),
    }),
  ),
});

const AddPullRequestReviewThreadReplyDataSchema = Schema.Struct({
  addPullRequestReviewThreadReply: Schema.NullOr(
    Schema.Struct({
      comment: Schema.NullOr(
        Schema.Struct({
          id: Schema.String,
        }),
      ),
    }),
  ),
});

const UpdatePullRequestReviewCommentDataSchema = Schema.Struct({
  updatePullRequestReviewComment: Schema.NullOr(
    Schema.Struct({
      pullRequestReviewComment: Schema.NullOr(
        Schema.Struct({
          id: Schema.String,
        }),
      ),
    }),
  ),
});

const SearchPullRequestsQueryDataSchema = Schema.Struct({
  search: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nodes: Schema.optional(
          Schema.NullOr(Schema.Array(Schema.NullOr(GhOverviewPullRequestSchema))),
        ),
      }),
    ),
  ),
});

const ListPullRequestsQueryDataSchema = Schema.Struct({
  repository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        pullRequests: Schema.Struct({
          nodes: Schema.Array(GhPullRequestSchema),
        }),
      }),
    ),
  ),
});

const GetPullRequestQueryDataSchema = Schema.Struct({
  repository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.optional(Schema.NullOr(GhPullRequestSchema)),
      }),
    ),
  ),
});

const GitHubGraphQlErrorSchema = Schema.Struct({
  message: Schema.String,
});

const GitHubErrorBodySchema = Schema.Struct({
  message: Schema.optional(Schema.String),
});

type GhSearchRepo = typeof GhSearchRepoSchema.Type;
type GhSearchUser = typeof GhSearchUserSchema.Type;
type GhRestPullRequest = typeof GhRestPullRequestSchema.Type;
type GhRestRepo = typeof GhRestRepoSchema.Type;
type GhGraphqlRepo = typeof GhGraphqlRepoSchema.Type;
type GhPullRequest = typeof GhPullRequestSchema.Type;

function graphQlResponseSchema<A, I, R>(dataSchema: Schema.Schema<A, I, R>) {
  return Schema.Struct({
    data: Schema.optional(Schema.NullOr(dataSchema)),
    errors: Schema.optional(Schema.NullOr(Schema.Array(GitHubGraphQlErrorSchema))),
  });
}

export {
  AddPullRequestReviewDataSchema,
  AddPullRequestReviewThreadDataSchema,
  AddPullRequestReviewThreadReplyDataSchema,
  GhActorSchema,
  GhChangedFileSchema,
  GhCheckRunAnnotationSchema,
  GhCheckRunSchema,
  GhCheckRunsResponseSchema,
  GhGraphqlRepoSchema,
  GhOverviewPullRequestSchema,
  GhPendingReviewCommentSchema,
  GhPullRequestReviewSchema,
  GhPullRequestSchema,
  GhRestPullRequestSchema,
  GhRestRepoSchema,
  GhRestUserSchema,
  GhSearchRepoSchema,
  GhSearchResponseSchema,
  GhSearchUserSchema,
  GhSearchUsersResponseSchema,
  GetPullRequestQueryDataSchema,
  GitHubErrorBodySchema,
  GitHubGraphQlErrorSchema,
  GraphQlConversationCommentSchema,
  GraphQlReviewCommentSchema,
  GraphQlReviewThreadSchema,
  ListPullRequestsQueryDataSchema,
  PullRequestNodeIdQueryDataSchema,
  ReviewThreadsQueryDataSchema,
  SearchPullRequestsQueryDataSchema,
  UpdatePullRequestReviewCommentDataSchema,
  graphQlResponseSchema,
};
export type {
  GhChangedFile,
  GhCheckRun,
  GhCheckRunAnnotation,
  GhGraphqlRepo,
  GhPendingReviewComment,
  GhPullRequest,
  GhPullRequestReview,
  GhRestPullRequest,
  GhRestRepo,
  GhSearchRepo,
  GhSearchUser,
  GraphQlResponse,
};
