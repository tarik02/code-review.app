import {
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from "@mdxeditor/editor";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "../button";
import { CommentCodeMirrorEditor } from "./code-block-editor";
import { SuggestionEditorContext } from "./suggestion-context";
import {
  clampSuggestionRange,
  getSuggestionLanguageForRange,
  parseGitlabSuggestionRange,
} from "./suggestion-range";
import type { SuggestionRange } from "./types";

function SuggestionCodeBlockEditor(props: CodeBlockEditorProps) {
  const suggestionContext = useContext(SuggestionEditorContext);
  const { parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const fallbackLines = useMemo(
    () =>
      props.code.split("\n").map((content, index) => ({
        content,
        line: index + 1,
        newLine: index + 1,
        oldLine: null,
      })),
    [props.code],
  );
  const sourceLines = suggestionContext?.lines.length
    ? suggestionContext.lines
    : fallbackLines;
  const fallbackRange = useMemo(
    () => ({
      from: suggestionContext?.startLine ?? sourceLines[0]?.line ?? 1,
      to:
        suggestionContext?.endLine ??
        sourceLines[sourceLines.length - 1]?.line ??
        1,
    }),
    [sourceLines, suggestionContext?.endLine, suggestionContext?.startLine],
  );
  const [range, setRange] = useState(() =>
    clampSuggestionRange(
      suggestionContext
        ? parseGitlabSuggestionRange(
            props.language,
            suggestionContext.anchorLine,
            fallbackRange,
          )
        : fallbackRange,
      sourceLines,
    ),
  );
  const canAdjustRange =
    suggestionContext?.provider === "gitlab" && sourceLines.length > 1;
  const minLine = sourceLines[0]?.line ?? range.from;
  const maxLine = sourceLines[sourceLines.length - 1]?.line ?? range.to;
  const anchorLine = suggestionContext?.anchorLine ?? range.from;
  const selectedSourceLines = useMemo(
    () =>
      sourceLines.filter(
        (line) => line.line >= range.from && line.line <= range.to,
      ),
    [range.from, range.to, sourceLines],
  );
  const selectedSourceText = useMemo(
    () => selectedSourceLines.map((line) => line.content).join("\n"),
    [selectedSourceLines],
  );
  const highlightLanguage = suggestionContext?.language ?? "";
  const sourceSide = suggestionContext?.sourceSide ?? "RIGHT";
  const originalLineColumns = useMemo(
    () =>
      selectedSourceLines.map((line) => ({
        newLine: null,
        oldLine: line.line,
        sign: "-" as const,
      })),
    [selectedSourceLines],
  );
  const getOriginalLineNumberColumns = useCallback(
    (lineNumber: number) =>
      originalLineColumns[lineNumber - 1] ?? {
        newLine: null,
        oldLine: null,
        sign: "-" as const,
      },
    [originalLineColumns],
  );
  const getReplacementLineNumberColumns = useCallback(
    (lineNumber: number) => {
      const nextLine = range.from + lineNumber - 1;
      return {
        newLine: sourceSide === "RIGHT" ? nextLine : null,
        oldLine: sourceSide === "LEFT" ? nextLine : null,
        sign: "+" as const,
      };
    },
    [range.from, sourceSide],
  );

  useEffect(() => {
    setRange(
      clampSuggestionRange(
        suggestionContext
          ? parseGitlabSuggestionRange(
              props.language,
              suggestionContext.anchorLine,
              fallbackRange,
            )
          : fallbackRange,
        sourceLines,
      ),
    );
  }, [fallbackRange, props.language, sourceLines, suggestionContext]);

  function commitRange(nextRange: SuggestionRange) {
    const clampedRange = clampSuggestionRange(nextRange, sourceLines);
    setRange(clampedRange);

    if (suggestionContext) {
      const nextLanguage = getSuggestionLanguageForRange(
        suggestionContext.provider,
        suggestionContext.anchorLine,
        clampedRange,
      );

      parentEditor.update(() => {
        lexicalNode.setLanguage(nextLanguage);
      });
    }
  }

  function stepRange(edge: keyof SuggestionRange, delta: number) {
    commitRange({
      ...range,
      [edge]:
        edge === "from"
          ? Math.min(anchorLine, range.to, Math.max(minLine, range.from + delta))
          : Math.max(
              anchorLine,
              range.from,
              Math.min(maxLine, range.to + delta),
            ),
    });
  }

  function renderRangeControl(edge: keyof SuggestionRange) {
    const value = range[edge];
    const decrementDisabled =
      !canAdjustRange ||
      (edge === "from"
        ? value <= minLine
        : value <= Math.max(range.from, anchorLine));
    const incrementDisabled =
      !canAdjustRange ||
      (edge === "from"
        ? value >= Math.min(range.to, anchorLine)
        : value >= maxLine);

    return (
      <div className="rudu-comment-editor-suggestion-range-control">
        {canAdjustRange ? (
          <Button
            aria-label={`Decrease ${edge} line`}
            disabled={decrementDisabled}
            onClick={() => stepRange(edge, -1)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            -
          </Button>
        ) : null}
        <input
          aria-label={`${edge} line`}
          readOnly
          value={value}
          className="rudu-comment-editor-suggestion-range-input"
        />
        {canAdjustRange ? (
          <Button
            aria-label={`Increase ${edge} line`}
            disabled={incrementDisabled}
            onClick={() => stepRange(edge, 1)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            +
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rudu-comment-editor-suggestion">
      <div className="rudu-comment-editor-suggestion-header">
        <strong>Suggested change</strong>
        <span className="rudu-comment-editor-suggestion-header-spacer" />
        <span>From line</span>
        {renderRangeControl("from")}
        <span>to</span>
        {renderRangeControl("to")}
      </div>
      <CommentCodeMirrorEditor
        {...props}
        className="rudu-comment-editor-suggestion-original"
        codeOverride={selectedSourceText}
        disableExpandControls
        forceReadOnly
        hideLanguageToolbar
        highlightLanguage={highlightLanguage}
        lineNumberColumns={getOriginalLineNumberColumns}
      />
      <CommentCodeMirrorEditor
        {...props}
        className="rudu-comment-editor-suggestion-replacement"
        disableExpandControls
        hideLanguageToolbar
        highlightLanguage={highlightLanguage}
        lineNumberColumns={getReplacementLineNumberColumns}
      />
    </div>
  );
}

const suggestionCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 100,
  match: (language) => language?.startsWith("suggestion") ?? false,
  Editor: SuggestionCodeBlockEditor,
};

export { suggestionCodeBlockDescriptor };
