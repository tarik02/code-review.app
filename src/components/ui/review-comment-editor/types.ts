import type { CommentEditorTarget } from "../review-comment-editor-actions";
import type { ForgeProviderKind } from "../../../types/forge";

type CommentEditorMode = "rich-text" | "source";

type SuggestionSourceLine = {
  content: string;
  line: number;
  newLine: number | null;
  oldLine: number | null;
};

type SuggestionEditorSourceContext = {
  lines: SuggestionSourceLine[];
};

type SuggestionEditorContextValue = {
  anchorLine: number;
  endLine: number;
  language: string;
  lines: SuggestionSourceLine[];
  provider: ForgeProviderKind;
  sourceSide: "LEFT" | "RIGHT";
  startLine: number;
};

type SuggestionGutterColumns = {
  newLine: number | null;
  oldLine: number | null;
  sign: "" | "+" | "-";
};

type SuggestionRange = {
  from: number;
  to: number;
};

type ReviewCommentEditorProps = {
  initialValue?: string;
  placeholder?: string;
  provider: ForgeProviderKind;
  suggestionContext?: SuggestionEditorSourceContext | null;
  target?: CommentEditorTarget | null;
  selectedText?: string;
  submitLabel: string;
  cancelLabel?: string;
  isPending?: boolean;
  error?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
  onSubmit: (body: string) => Promise<void> | void;
};

export type {
  CommentEditorMode,
  ReviewCommentEditorProps,
  SuggestionEditorContextValue,
  SuggestionEditorSourceContext,
  SuggestionGutterColumns,
  SuggestionRange,
  SuggestionSourceLine,
};
