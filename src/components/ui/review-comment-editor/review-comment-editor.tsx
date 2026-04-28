import type { EditorView } from "@codemirror/view";
import {
  MDXEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  toolbarPlugin,
  type MDXEditorMethods,
  type RealmPlugin,
} from "@mdxeditor/editor";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ensureCodeMirrorStyles } from "../../../lib/ensure-codemirror-styles";
import { buildSuggestionBlock } from "../review-comment-editor-actions";
import {
  commentCodeMirrorDescriptor,
  commentCodeMirrorTheme,
  sourceCodeFormattingKeymap,
} from "./code-block-editor";
import { ReviewCommentEditorFooter } from "./footer";
import { getLanguageFromPath } from "./language";
import { ReviewCommentLinkDialog } from "./link-dialog";
import { createSourceEditorViewBridge } from "./source-editor-bridge";
import { suggestionCodeBlockDescriptor } from "./suggestion-code-block-editor";
import { SuggestionEditorContext } from "./suggestion-context";
import { ReviewCommentToolbar } from "./toolbar";
import type {
  CommentEditorMode,
  ReviewCommentEditorProps,
  SuggestionEditorContextValue,
} from "./types";
import "../comment-markdown.css";
import "./styles.css";

const DEFAULT_EDITOR_MODE: CommentEditorMode = "rich-text";

function ReviewCommentEditor({
  initialValue = "",
  placeholder = "Leave a comment",
  provider,
  suggestionContext = null,
  target = null,
  selectedText = "",
  submitLabel,
  cancelLabel = "Cancel",
  isPending = false,
  error = "",
  autoFocus = true,
  onCancel,
  onSubmit,
}: ReviewCommentEditorProps) {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const sourceEditorViewRef = useRef<EditorView | null>(null);
  const [sourceEditorView, setSourceEditorView] = useState<EditorView | null>(
    null,
  );
  const [body, setBody] = useState(initialValue);
  const suggestion = useMemo(
    () => buildSuggestionBlock(provider, target, selectedText),
    [provider, selectedText, target],
  );
  const suggestionHighlightLanguage = useMemo(
    () => getLanguageFromPath(target?.path),
    [target?.path],
  );
  const suggestionEditorContext = useMemo<SuggestionEditorContextValue | null>(
    () =>
      target?.type === "line"
        ? {
            anchorLine: target.line,
            endLine: Math.max(target.startLine ?? target.line, target.line),
            language: suggestionHighlightLanguage,
            lines: suggestionContext?.lines ?? [],
            provider,
            sourceSide: target.side,
            startLine: Math.min(target.startLine ?? target.line, target.line),
          }
        : null,
    [provider, suggestionContext?.lines, suggestionHighlightLanguage, target],
  );
  const suggestionError =
    target?.type === "line" && suggestion.error ? suggestion.error : "";
  const canInsertSuggestion = !isPending && suggestion.block.length > 0;

  useLayoutEffect(() => {
    ensureCodeMirrorStyles(editorHostRef.current?.getRootNode() ?? null);
  }, []);

  useEffect(() => {
    setBody(initialValue);
    editorRef.current?.setMarkdown(initialValue);
  }, [initialValue]);

  const insertSuggestion = useCallback(() => {
    if (!suggestion.block || isPending) {
      return;
    }

    editorRef.current?.focus(
      () => {
        editorRef.current?.insertMarkdown(suggestion.block);
      },
      { defaultSelection: "rootEnd" },
    );
  }, [isPending, suggestion.block]);

  const sourceEditorBridgeExtension = useMemo(
    () =>
      createSourceEditorViewBridge(sourceEditorViewRef, setSourceEditorView),
    [],
  );

  const plugins = useMemo<RealmPlugin[]>(
    () => [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4] }),
      quotePlugin(),
      listsPlugin(),
      linkPlugin(),
      linkDialogPlugin({
        LinkDialog: ReviewCommentLinkDialog,
        showLinkTitleField: false,
      }),
      codeBlockPlugin({
        codeBlockEditorDescriptors: [
          suggestionCodeBlockDescriptor,
          commentCodeMirrorDescriptor,
        ],
        defaultCodeBlockLanguage: "",
      }),
      codeMirrorPlugin({
        codeBlockLanguages: {
          "": "Plain text",
          bash: "Bash",
          css: "CSS",
          diff: "Diff",
          html: "HTML",
          js: "JavaScript",
          json: "JSON",
          md: "Markdown",
          sh: "Shell",
          ts: "TypeScript",
          tsx: "TSX",
        },
        codeMirrorExtensions: [commentCodeMirrorTheme],
      }),
      markdownShortcutPlugin(),
      diffSourcePlugin({
        viewMode: DEFAULT_EDITOR_MODE,
        codeMirrorExtensions: [
          sourceEditorBridgeExtension,
          commentCodeMirrorTheme,
          sourceCodeFormattingKeymap,
        ],
      }),
      toolbarPlugin({
        toolbarClassName: "rudu-comment-editor-toolbar",
        toolbarContents: () => (
          <ReviewCommentToolbar
            canInsertSuggestion={canInsertSuggestion}
            provider={provider}
            sourceEditorView={sourceEditorView}
            sourceEditorViewRef={sourceEditorViewRef}
            suggestionMarkdown={suggestion.block}
            onInsertSuggestion={insertSuggestion}
          />
        ),
      }),
    ],
    [
      canInsertSuggestion,
      insertSuggestion,
      provider,
      sourceEditorBridgeExtension,
      sourceEditorView,
      suggestion.block,
    ],
  );

  async function handleSubmit() {
    const currentBody = editorRef.current?.getMarkdown() ?? body;
    const trimmedBody = currentBody.trim();
    if (!trimmedBody) {
      return;
    }

    await onSubmit(trimmedBody);
  }

  return (
    <div className="font-sans">
      <div ref={editorHostRef} className="rudu-comment-editor-shell">
        <SuggestionEditorContext.Provider value={suggestionEditorContext}>
          <MDXEditor
            ref={editorRef}
            autoFocus={
              autoFocus
                ? { defaultSelection: "rootEnd", preventScroll: true }
                : false
            }
            className="rudu-comment-editor"
            contentEditableClassName="rudu-comment-editor-content rudu-comment-markdown"
            markdown={initialValue}
            onChange={(markdown) => setBody(markdown)}
            placeholder={placeholder}
            plugins={plugins}
            readOnly={isPending}
            suppressHtmlProcessing
            trim={false}
          />
        </SuggestionEditorContext.Provider>
        <ReviewCommentEditorFooter
          canSubmit={!isPending && body.trim().length > 0}
          cancelLabel={cancelLabel}
          isPending={isPending}
          submitLabel={submitLabel}
          onCancel={onCancel}
          onSubmit={() => void handleSubmit()}
        />
      </div>
      {error || suggestionError ? (
        <div className="mt-2 text-sm text-danger-600">
          {error || suggestionError}
        </div>
      ) : null}
    </div>
  );
}

export { ReviewCommentEditor };
