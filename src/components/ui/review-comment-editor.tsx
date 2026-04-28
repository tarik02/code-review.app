import { EditorView, keymap } from "@codemirror/view";
import { ArrowUpIcon, PencilSquareIcon } from "@heroicons/react/20/solid";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ButtonWithTooltip,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  ListsToggle,
  MDXEditor,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  toolbarPlugin,
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
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
  type KeyboardEvent,
} from "react";
import { ensureCodeMirrorStyles } from "../../lib/ensure-codemirror-styles";
import type { ForgeProviderKind } from "../../types/forge";
import {
  buildSuggestionBlock,
  toggleCodeFormatting,
  type CommentEditorTarget,
} from "./review-comment-editor-actions";
import "./review-comment-editor.css";

type CommentEditorMode = "rich-text" | "source";

type ReviewCommentEditorProps = {
  initialValue?: string;
  placeholder?: string;
  selectedLineLabel?: string;
  framed?: boolean;
  provider: ForgeProviderKind;
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

const sourceCodeFormattingKeymap = keymap.of([
  {
    key: "`",
    run(view) {
      const selection = view.state.selection.main;
      if (selection.empty) {
        return false;
      }

      const transform = toggleCodeFormatting(view.state.doc.toString(), {
        start: selection.from,
        end: selection.to,
      });

      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: transform.markdown,
        },
        selection: {
          anchor: transform.selection.start,
          head: transform.selection.end,
        },
        scrollIntoView: true,
      });

      return true;
    },
  },
]);

const commentCodeMirrorTheme = EditorView.theme({
  "&": {
    backgroundColor: "rgb(var(--rgb-surface))",
    color: "rgb(var(--rgb-ink-900))",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8125rem",
    lineHeight: "1.5rem",
  },
  ".cm-content": {
    caretColor: "rgb(var(--rgb-ink-900))",
    fontFamily: "var(--font-mono)",
    minHeight: "2.5rem",
  },
  ".cm-line": {
    padding: "0 0.75rem",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "rgb(var(--rgb-ink-900))",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgb(59 130 246 / 0.45)",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgb(59 130 246 / 0.45)",
  },
  ".cm-gutters": {
    backgroundColor: "rgb(var(--rgb-canvas))",
    borderRight: "1px solid rgb(var(--rgb-ink-200))",
    color: "rgb(var(--rgb-ink-500))",
    fontFamily: "var(--font-mono)",
    fontSize: "0.75rem",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "2rem",
    padding: "0 0.5rem",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
});

const DEFAULT_EDITOR_MODE: CommentEditorMode = "rich-text";

function stopNestedEditorKeyDown(event: KeyboardEvent) {
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
}

function SuggestionCodeBlockEditor({
  code,
  focusEmitter,
  language,
}: CodeBlockEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { setCode, setLanguage } = useCodeBlockEditorContext();

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useEffect(() => {
    focusEmitter.subscribe(() => {
      textareaRef.current?.focus();
    });
  }, [focusEmitter]);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [code, resizeTextarea]);

  return (
    <div className="rudu-comment-editor-suggestion">
      <input
        className="rudu-comment-editor-suggestion-language"
        onChange={(event) => setLanguage(event.currentTarget.value)}
        onKeyDown={stopNestedEditorKeyDown}
        onKeyDownCapture={stopNestedEditorKeyDown}
        spellCheck={false}
        value={language}
      />
      <textarea
        ref={textareaRef}
        className="rudu-comment-editor-suggestion-code"
        onChange={(event) => {
          setCode(event.currentTarget.value);
          resizeTextarea();
        }}
        onKeyDown={stopNestedEditorKeyDown}
        onKeyDownCapture={stopNestedEditorKeyDown}
        spellCheck={false}
        value={code}
      />
    </div>
  );
}

const suggestionCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 100,
  match: (language) => language?.startsWith("suggestion") ?? false,
  Editor: SuggestionCodeBlockEditor,
};

type SuggestChangeButtonProps = {
  disabled: boolean;
  provider: ForgeProviderKind;
  onClick: () => void;
};

function SuggestChangeButton({
  disabled,
  provider,
  onClick,
}: SuggestChangeButtonProps) {
  const title =
    provider === "gitlab"
      ? "Insert GitLab suggestion"
      : "Insert GitHub suggestion";

  return (
    <ButtonWithTooltip
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      <PencilSquareIcon className="size-4" />
    </ButtonWithTooltip>
  );
}

function ReviewCommentEditor({
  initialValue = "",
  placeholder = "Leave a comment",
  selectedLineLabel,
  framed = true,
  provider,
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
  const [body, setBody] = useState(initialValue);
  const suggestion = useMemo(
    () => buildSuggestionBlock(provider, target, selectedText),
    [provider, selectedText, target],
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

  const plugins = useMemo<RealmPlugin[]>(
    () => [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4] }),
      quotePlugin(),
      listsPlugin(),
      linkPlugin(),
      codeBlockPlugin({
        codeBlockEditorDescriptors: [suggestionCodeBlockDescriptor],
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
          commentCodeMirrorTheme,
          sourceCodeFormattingKeymap,
        ],
      }),
      toolbarPlugin({
        toolbarClassName: "rudu-comment-editor-toolbar",
        toolbarContents: () => (
          <DiffSourceToggleWrapper
            options={["rich-text", "source"]}
            SourceToolbar={
              <>
                <UndoRedo />
                <Separator />
                <SuggestChangeButton
                  disabled={!canInsertSuggestion}
                  provider={provider}
                  onClick={insertSuggestion}
                />
              </>
            }
          >
            <UndoRedo />
            <Separator />
            <BlockTypeSelect />
            <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
            <CodeToggle />
            <CreateLink />
            <Separator />
            <ListsToggle options={["bullet", "number", "check"]} />
            <InsertCodeBlock />
            <Separator />
            <SuggestChangeButton
              disabled={!canInsertSuggestion}
              provider={provider}
              onClick={insertSuggestion}
            />
          </DiffSourceToggleWrapper>
        ),
      }),
    ],
    [canInsertSuggestion, insertSuggestion, provider],
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
    <div
      className={
        framed
          ? "rounded-lg border border-ink-200 bg-canvas p-3 shadow-xs font-sans"
          : "font-sans"
      }
    >
      {selectedLineLabel ? (
        <div className="mb-2 text-xs font-medium text-ink-500">
          {selectedLineLabel}
        </div>
      ) : null}
      <div ref={editorHostRef}>
        <MDXEditor
          ref={editorRef}
          autoFocus={
            autoFocus
              ? { defaultSelection: "rootEnd", preventScroll: true }
              : false
          }
          className="rudu-comment-editor"
          contentEditableClassName="rudu-comment-editor-content"
          markdown={initialValue}
          onChange={(markdown) => setBody(markdown)}
          placeholder={placeholder}
          plugins={plugins}
          readOnly={isPending}
          suppressHtmlProcessing
          trim={false}
        />
      </div>
      {error || suggestionError ? (
        <div className="mt-2 text-sm text-danger-600">
          {error || suggestionError}
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <button
          className="flex items-center gap-2 rounded-md bg-ink-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-ink-700 disabled:cursor-default disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900 dark:hover:bg-ink-300"
          disabled={isPending || body.trim().length === 0}
          onClick={() => void handleSubmit()}
          type="button"
        >
          <ArrowUpIcon className="size-4" />{" "}
          {isPending ? "Saving..." : submitLabel}
        </button>
        {onCancel ? (
          <button
            className="rounded-md px-3 py-1.5 text-sm text-ink-600 transition hover:bg-canvasDark hover:text-ink-900 disabled:cursor-default disabled:opacity-60"
            disabled={isPending}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export { ReviewCommentEditor };
export type {
  CommentEditorMode,
  CommentEditorTarget,
  ReviewCommentEditorProps,
};
