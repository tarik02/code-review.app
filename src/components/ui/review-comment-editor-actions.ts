import type { ForgeProviderKind, ReviewCommentSide } from "../../types/forge";

type MarkdownSelection = {
  start: number;
  end: number;
};

type MarkdownTransform = {
  markdown: string;
  selection: MarkdownSelection;
};

type CommentEditorTarget =
  | { type: "file"; path: string }
  | {
      type: "line";
      path: string;
      line: number;
      side: ReviewCommentSide;
      startLine: number | null;
      startSide: ReviewCommentSide | null;
    };

type SuggestionBlockResult =
  | {
      block: string;
      error: "";
    }
  | {
      block: "";
      error: string;
    };

const GITLAB_SUGGESTION_CONTEXT_LIMIT = 100;

function normalizeSelection(selection: MarkdownSelection): MarkdownSelection {
  return selection.start <= selection.end
    ? selection
    : { start: selection.end, end: selection.start };
}

function getSelectedText(markdown: string, selection: MarkdownSelection) {
  const normalizedSelection = normalizeSelection(selection);
  return markdown.slice(normalizedSelection.start, normalizedSelection.end);
}

function wrapSelection(
  markdown: string,
  selection: MarkdownSelection,
  before: string,
  after: string,
): MarkdownTransform {
  const normalizedSelection = normalizeSelection(selection);
  const selectedText = getSelectedText(markdown, normalizedSelection);
  const replacement = `${before}${selectedText}${after}`;
  const nextStart = normalizedSelection.start + before.length;
  const nextEnd = nextStart + selectedText.length;

  return {
    markdown:
      markdown.slice(0, normalizedSelection.start) +
      replacement +
      markdown.slice(normalizedSelection.end),
    selection: {
      start: nextStart,
      end: nextEnd,
    },
  };
}

function unwrapSelection(
  markdown: string,
  selection: MarkdownSelection,
  before: string,
  after: string,
): MarkdownTransform | null {
  const normalizedSelection = normalizeSelection(selection);
  const selectedText = getSelectedText(markdown, normalizedSelection);
  const hasSelectedWrappers =
    selectedText.startsWith(before) && selectedText.endsWith(after);
  const hasOuterWrappers =
    markdown.slice(
      normalizedSelection.start - before.length,
      normalizedSelection.start,
    ) === before &&
    markdown.slice(
      normalizedSelection.end,
      normalizedSelection.end + after.length,
    ) === after;

  if (hasSelectedWrappers) {
    const unwrappedText = selectedText.slice(
      before.length,
      selectedText.length - after.length,
    );
    return {
      markdown:
        markdown.slice(0, normalizedSelection.start) +
        unwrappedText +
        markdown.slice(normalizedSelection.end),
      selection: {
        start: normalizedSelection.start,
        end: normalizedSelection.start + unwrappedText.length,
      },
    };
  }

  if (hasOuterWrappers) {
    return {
      markdown:
        markdown.slice(0, normalizedSelection.start - before.length) +
        selectedText +
        markdown.slice(normalizedSelection.end + after.length),
      selection: {
        start: normalizedSelection.start - before.length,
        end: normalizedSelection.end - before.length,
      },
    };
  }

  return null;
}

function toggleInlineCode(
  markdown: string,
  selection: MarkdownSelection,
): MarkdownTransform {
  const unwrapped = unwrapSelection(markdown, selection, "`", "`");
  return unwrapped ?? wrapSelection(markdown, selection, "`", "`");
}

function toggleCodeFence(
  markdown: string,
  selection: MarkdownSelection,
): MarkdownTransform {
  const unwrapped = unwrapSelection(markdown, selection, "```\n", "\n```");
  return unwrapped ?? wrapSelection(markdown, selection, "```\n", "\n```");
}

function toggleCodeFormatting(
  markdown: string,
  selection: MarkdownSelection,
): MarkdownTransform {
  const selectedText = getSelectedText(markdown, selection);
  return selectedText.includes("\n")
    ? toggleCodeFence(markdown, selection)
    : toggleInlineCode(markdown, selection);
}

function insertFence(language: string, body: string) {
  const fenceLanguage = language.trim();
  const normalizedBody = body.replace(/\n+$/, "");
  return `\`\`\`${fenceLanguage}\n${normalizedBody}\n\`\`\``;
}

function buildGitlabSuggestionLanguage(
  target: Extract<CommentEditorTarget, { type: "line" }>,
) {
  const startLine = target.startLine ?? target.line;
  const endLine = target.line;
  const linesAbove = Math.max(endLine - startLine, 0);

  if (linesAbove > GITLAB_SUGGESTION_CONTEXT_LIMIT) {
    return {
      language: "",
      error: "GitLab suggestions support up to 100 selected lines above the commented line.",
    };
  }

  return {
    language: `suggestion:-${linesAbove}+0`,
    error: "",
  };
}

function buildSuggestionBlock(
  provider: ForgeProviderKind,
  target: CommentEditorTarget | null | undefined,
  selectedText: string,
): SuggestionBlockResult {
  if (!target || target.type !== "line") {
    return {
      block: "",
      error: "Suggestions require a line comment.",
    };
  }

  if (provider === "gitlab") {
    const gitlabSuggestion = buildGitlabSuggestionLanguage(target);
    if (gitlabSuggestion.error) {
      return {
        block: "",
        error: gitlabSuggestion.error,
      };
    }

    return {
      block: insertFence(gitlabSuggestion.language, selectedText),
      error: "",
    };
  }

  return {
    block: insertFence("suggestion", selectedText),
    error: "",
  };
}

export {
  buildSuggestionBlock,
  insertFence,
  toggleCodeFormatting,
  toggleInlineCode,
  wrapSelection,
};
export type {
  CommentEditorTarget,
  MarkdownSelection,
  MarkdownTransform,
  SuggestionBlockResult,
};
