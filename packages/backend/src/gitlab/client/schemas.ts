import { Schema } from 'effect';

const NullableString = Schema.NullOr(Schema.String);
const OptionalNullableString = Schema.optional(Schema.NullOr(Schema.String));
const OptionalNullableNumber = Schema.optional(Schema.NullOr(Schema.Number));
const OptionalNullableBoolean = Schema.optional(Schema.NullOr(Schema.Boolean));

const GitLabUserSchema = Schema.Struct({
  username: Schema.String,
  avatar_url: OptionalNullableString,
});

const GitLabProjectSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  path_with_namespace: Schema.String,
  description: NullableString,
  visibility: NullableString,
  avatar_url: NullableString,
});

const GitLabDiffRefsSchema = Schema.Struct({
  base_sha: OptionalNullableString,
  head_sha: OptionalNullableString,
  start_sha: OptionalNullableString,
});

const GitLabMergeRequestSchema = Schema.Struct({
  project_id: OptionalNullableNumber,
  iid: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  draft: OptionalNullableBoolean,
  work_in_progress: OptionalNullableBoolean,
  merge_status: OptionalNullableString,
  detailed_merge_status: OptionalNullableString,
  changes_count: OptionalNullableString,
  author: Schema.optional(Schema.NullOr(GitLabUserSchema)),
  updated_at: Schema.String,
  web_url: Schema.String,
  sha: OptionalNullableString,
  diff_refs: Schema.optional(Schema.NullOr(GitLabDiffRefsSchema)),
});

const GitLabDiffSchema = Schema.Struct({
  new_path: Schema.String,
  old_path: Schema.String,
  new_file: Schema.Boolean,
  deleted_file: Schema.Boolean,
  renamed_file: Schema.Boolean,
});

const GitLabLineRangePointSchema = Schema.Struct({
  type: OptionalNullableString,
  old_line: OptionalNullableNumber,
  new_line: OptionalNullableNumber,
});

const GitLabLineRangeSchema = Schema.Struct({
  start: Schema.optional(Schema.NullOr(GitLabLineRangePointSchema)),
  end: Schema.optional(Schema.NullOr(GitLabLineRangePointSchema)),
});

const GitLabPositionSchema = Schema.Struct({
  old_path: OptionalNullableString,
  new_path: OptionalNullableString,
  old_line: OptionalNullableNumber,
  new_line: OptionalNullableNumber,
  head_sha: OptionalNullableString,
  position_type: OptionalNullableString,
  line_range: Schema.optional(Schema.NullOr(GitLabLineRangeSchema)),
});

const GitLabNoteSchema = Schema.Struct({
  id: Schema.Number,
  type: OptionalNullableString,
  body: Schema.String,
  system: OptionalNullableBoolean,
  author: Schema.optional(Schema.NullOr(GitLabUserSchema)),
  created_at: Schema.String,
  updated_at: Schema.String,
  web_url: OptionalNullableString,
  resolved: OptionalNullableBoolean,
  position: Schema.optional(Schema.NullOr(GitLabPositionSchema)),
});

const GitLabDraftNoteSchema = Schema.Struct({
  id: Schema.Number,
  author_id: OptionalNullableNumber,
  merge_request_id: OptionalNullableNumber,
  resolve_discussion: OptionalNullableBoolean,
  discussion_id: OptionalNullableString,
  note: OptionalNullableString,
  commit_id: OptionalNullableString,
  line_code: OptionalNullableString,
  position: Schema.optional(Schema.NullOr(GitLabPositionSchema)),
});

const GitLabDiscussionSchema = Schema.Struct({
  id: Schema.String,
  individual_note: Schema.optional(Schema.Boolean),
  notes: Schema.optional(Schema.Array(GitLabNoteSchema)),
});

const GitLabMrVersionSchema = Schema.Struct({
  base_commit_sha: Schema.String,
  head_commit_sha: Schema.String,
  start_commit_sha: Schema.String,
});

const GitLabApprovalActorSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  username: Schema.String,
  avatar_url: OptionalNullableString,
  web_url: OptionalNullableString,
});

const GitLabApprovedByEntrySchema = Schema.Struct({
  user: GitLabApprovalActorSchema,
  approved_at: OptionalNullableString,
});

const GitLabMergeRequestApprovalsSchema = Schema.Struct({
  approvals_required: OptionalNullableNumber,
  approvals_left: OptionalNullableNumber,
  approved_by: Schema.optional(Schema.NullOr(Schema.Array(GitLabApprovedByEntrySchema))),
});

const GitLabErrorBodySchema = Schema.Struct({
  message: Schema.optional(Schema.String),
});

const GitLabGraphQlErrorSchema = Schema.Struct({
  message: Schema.String,
});

const GitLabCodeQualityFindingSchema = Schema.Struct({
  description: Schema.String,
  fingerprint: OptionalNullableString,
  severity: OptionalNullableString,
  filePath: OptionalNullableString,
  line: OptionalNullableNumber,
  webUrl: OptionalNullableString,
  engineName: OptionalNullableString,
});

const GitLabCodeQualitySummarySchema = Schema.Struct({
  errored: OptionalNullableNumber,
  resolved: OptionalNullableNumber,
  total: OptionalNullableNumber,
});

const GitLabCodeQualityReportSchema = Schema.Struct({
  status: OptionalNullableString,
  newErrors: Schema.optional(Schema.NullOr(Schema.Array(GitLabCodeQualityFindingSchema))),
  resolvedErrors: Schema.optional(Schema.NullOr(Schema.Array(GitLabCodeQualityFindingSchema))),
  existingErrors: Schema.optional(Schema.NullOr(Schema.Array(GitLabCodeQualityFindingSchema))),
  summary: Schema.optional(Schema.NullOr(GitLabCodeQualitySummarySchema)),
});

const GitLabCodeQualityComparerSchema = Schema.Struct({
  status: OptionalNullableString,
  report: Schema.optional(Schema.NullOr(GitLabCodeQualityReportSchema)),
});

const GitLabCodeQualityGraphqlQueryDataSchema = Schema.Struct({
  project: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        mergeRequest: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              codequalityReportsComparer: Schema.optional(
                Schema.NullOr(GitLabCodeQualityComparerSchema),
              ),
            }),
          ),
        ),
      }),
    ),
  ),
});

type GitLabProject = typeof GitLabProjectSchema.Type;
type GitLabMergeRequest = typeof GitLabMergeRequestSchema.Type;
type GitLabMrVersion = typeof GitLabMrVersionSchema.Type;
type GitLabPosition = typeof GitLabPositionSchema.Type;
type GitLabDiscussion = typeof GitLabDiscussionSchema.Type;
type GitLabDiff = typeof GitLabDiffSchema.Type;
type GitLabDraftNote = typeof GitLabDraftNoteSchema.Type;
type GitLabNote = typeof GitLabNoteSchema.Type;

function graphQlResponseSchema<A, I>(dataSchema: Schema.Schema<A, I, never>) {
  return Schema.Struct({
    data: Schema.optional(Schema.NullOr(dataSchema)),
    errors: Schema.optional(Schema.NullOr(Schema.Array(GitLabGraphQlErrorSchema))),
  });
}

export {
  GitLabApprovedByEntrySchema,
  GitLabCodeQualityGraphqlQueryDataSchema,
  GitLabDiffSchema,
  GitLabDiscussionSchema,
  GitLabDraftNoteSchema,
  GitLabErrorBodySchema,
  GitLabGraphQlErrorSchema,
  GitLabMergeRequestApprovalsSchema,
  GitLabMergeRequestSchema,
  GitLabMrVersionSchema,
  GitLabNoteSchema,
  GitLabPositionSchema,
  GitLabProjectSchema,
  GitLabUserSchema,
  graphQlResponseSchema,
};
export type {
  GitLabDiff,
  GitLabDiscussion,
  GitLabDraftNote,
  GitLabMergeRequest,
  GitLabMrVersion,
  GitLabNote,
  GitLabPosition,
  GitLabProject,
};
