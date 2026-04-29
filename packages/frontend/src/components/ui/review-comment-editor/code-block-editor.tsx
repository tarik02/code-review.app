"use no memo";

import { indentWithTab } from "@codemirror/commands";
import { languages } from "@codemirror/language-data";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { autoUpdate, offset, shift, useFloating } from "@floating-ui/react";
import { useCellValues, usePublisher } from "@mdxeditor/gurx";
import {
  codeBlockLanguages$,
  codeMirrorAutoLoadLanguageSupport$,
  codeMirrorExtensions$,
  editorInFocus$,
  getCodeBlockLanguageSelectData,
  readOnly$,
  useCodeBlockEditorContext,
  useTranslation,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from "@mdxeditor/editor";
import { basicLight } from "cm6-theme-basic-light";
import { basicSetup, minimalSetup } from "codemirror";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $setSelection,
} from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import { Combobox } from "../combobox";
import { toggleCodeFormatting } from "../review-comment-editor-actions";
import { createSuggestionLineNumberGutter } from "./suggestion-gutter";
import type { SuggestionGutterColumns } from "./types";

const CODE_LANGUAGE_EMPTY_VALUE = "__EMPTY_VALUE__";

type CommentCodeMirrorEditorProps = CodeBlockEditorProps & {
  className?: string;
  codeOverride?: string;
  disableExpandControls?: boolean;
  forceReadOnly?: boolean;
  hideLanguageToolbar?: boolean;
  highlightLanguage?: string;
  lineNumberColumns?: (lineNumber: number) => SuggestionGutterColumns;
  lineNumberPrefix?: string;
  lineNumberStart?: number;
};

const commentCodeMirrorTheme = EditorView.theme({
  "&": {
    backgroundColor: "rgb(var(--rgb-surface))",
    color: "rgb(var(--rgb-ink-900))",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    lineHeight: "20px",
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
    fontSize: "13px",
    lineHeight: "20px",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "2rem",
    padding: "0 0.5rem",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
});

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

function stopNestedEditorDomKeyDown(event: globalThis.KeyboardEvent) {
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function appendTextWithLineBreaks(
  paragraphNode: ReturnType<typeof $createParagraphNode>,
  text: string,
) {
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    if (index > 0) {
      paragraphNode.append($createLineBreakNode());
    }

    if (line.length > 0) {
      paragraphNode.append($createTextNode(line));
    }
  });
}

function replaceCodeBlockWithTextAfterCursor(
  lexicalNode: ReturnType<typeof useCodeBlockEditorContext>["lexicalNode"],
  textAfterCursor: string,
) {
  const latestNode = lexicalNode.getLatest();

  if (textAfterCursor.length > 0) {
    const paragraphNode = $createParagraphNode();
    appendTextWithLineBreaks(paragraphNode, textAfterCursor);
    latestNode.replace(paragraphNode);
    paragraphNode.selectEnd();
    return;
  }

  const previousSibling = latestNode.getPreviousSibling();
  const nextSibling = latestNode.getNextSibling();

  if (previousSibling) {
    latestNode.remove();
    previousSibling.selectEnd();
  } else if (nextSibling) {
    latestNode.remove();
    nextSibling.selectStart();
  } else {
    const paragraphNode = $createParagraphNode();
    latestNode.replace(paragraphNode);
    paragraphNode.selectStart();
  }
}

function CommentCodeMirrorEditor({
  code,
  className,
  codeOverride,
  disableExpandControls = false,
  focusEmitter,
  forceReadOnly = false,
  hideLanguageToolbar = false,
  highlightLanguage,
  language,
  lineNumberColumns,
  lineNumberPrefix = "",
  lineNumberStart = 1,
}: CommentCodeMirrorEditorProps) {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const editorHandleRef = useRef({
    getCodemirror: () => editorViewRef.current,
  });
  const { lexicalNode, parentEditor, setCode } = useCodeBlockEditorContext();
  const lexicalNodeRef = useRef(lexicalNode);
  const setEditorInFocus = usePublisher(editorInFocus$);
  const [readOnly, codeMirrorExtensions, autoLoadLanguageSupport, codeBlockLanguages] =
    useCellValues(
      readOnly$,
      codeMirrorExtensions$,
      codeMirrorAutoLoadLanguageSupport$,
      codeBlockLanguages$,
    );
  const t = useTranslation();
  const editorCode = codeOverride ?? code;
  const effectiveLanguage = highlightLanguage || language;
  const { value: selectedLanguage, items: languageOptions } = useMemo(
    () => getCodeBlockLanguageSelectData(codeBlockLanguages, language),
    [codeBlockLanguages, language],
  );
  const [isLanguageComboboxOpen, setIsLanguageComboboxOpen] = useState(false);
  const { floatingStyles, refs } = useFloating({
    placement: "top",
    strategy: "fixed",
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), shift({ padding: 8 })],
  });
  const setCodeRef = useRef(setCode);
  const codeMirrorExtensionsRef = useRef(codeMirrorExtensions);
  const codeBlockLanguagesRef = useRef(codeBlockLanguages);
  const parentEditorRef = useRef(parentEditor);
  const setEditorInFocusRef = useRef(setEditorInFocus);
  const setCodeBlockReference = useCallback(
    (node: HTMLDivElement | null) => {
      refs.setReference(node);
    },
    [refs],
  );
  const setLanguageToolbar = useCallback(
    (node: HTMLDivElement | null) => {
      refs.setFloating(node);
    },
    [refs],
  );

  useEffect(() => {
    lexicalNodeRef.current = lexicalNode;
    setCodeRef.current = setCode;
    codeMirrorExtensionsRef.current = codeMirrorExtensions;
    codeBlockLanguagesRef.current = codeBlockLanguages;
    parentEditorRef.current = parentEditor;
    setEditorInFocusRef.current = setEditorInFocus;
  }, [
    codeBlockLanguages,
    codeMirrorExtensions,
    lexicalNode,
    parentEditor,
    setCode,
    setEditorInFocus,
  ]);

  useEffect(() => {
    if (forceReadOnly) {
      return;
    }

    return focusEmitter.subscribe(() => {
      editorViewRef.current?.focus();
    });
  }, [focusEmitter, forceReadOnly]);

  useEffect(() => {
    const editorHost = editorHostRef.current;
    if (!editorHost) {
      return;
    }

    let disposed = false;

    async function mountEditor() {
      const extensions = [
        ...codeMirrorExtensionsRef.current,
        disableExpandControls ? minimalSetup : basicSetup,
        basicLight,
        lineNumberColumns
          ? createSuggestionLineNumberGutter(lineNumberColumns)
          : lineNumbers({
              formatNumber: (lineNumber) =>
                `${lineNumberPrefix}${lineNumberStart + lineNumber - 1}`,
            }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !forceReadOnly) {
            setCodeRef.current(update.state.doc.toString());
          }
        }),
        Prec.highest(
          keymap.of([
            {
              key: "Backspace",
              stopPropagation: true,
              run(view) {
                const selection = view.state.selection.main;

                if (readOnly || forceReadOnly || !selection.empty || selection.from !== 0) {
                  return false;
                }

                const textAfterCursor = view.state.doc.sliceString(selection.to);
                parentEditorRef.current.update(() => {
                  replaceCodeBlockWithTextAfterCursor(lexicalNodeRef.current, textAfterCursor);
                });

                return true;
              },
            },
          ]),
        ),
        EditorView.domEventHandlers({
          focus: () => {
            setEditorInFocusRef.current({
              editorType: "codeblock",
              rootNode: lexicalNodeRef.current,
              editorRef: editorHandleRef.current,
            });
            parentEditorRef.current.update(() => {
              $setSelection(null);
            });
          },
        }),
        keymap.of([indentWithTab]),
      ];

      if (readOnly || forceReadOnly) {
        extensions.push(EditorState.readOnly.of(true));
        extensions.push(EditorView.editable.of(false));
      }

      if (effectiveLanguage !== "") {
        const currentCodeBlockLanguages = codeBlockLanguagesRef.current;
        const canonical = currentCodeBlockLanguages.keyMap[effectiveLanguage] ?? effectiveLanguage;
        const providedSupport = currentCodeBlockLanguages.supportMap[canonical];

        if (providedSupport) {
          extensions.push(providedSupport.extension);
        } else if (autoLoadLanguageSupport) {
          const languageData = languages.find(
            (candidate) =>
              candidate.name.toLowerCase() === effectiveLanguage.toLowerCase() ||
              candidate.alias.includes(effectiveLanguage) ||
              candidate.extensions.includes(effectiveLanguage),
          );

          if (languageData) {
            try {
              const languageSupport = await languageData.load();
              extensions.push(languageSupport.extension);
            } catch {
              console.warn("failed to load language support for", effectiveLanguage);
            }
          }
        }
      }

      if (disposed || !editorHost) {
        return;
      }

      editorHost.innerHTML = "";
      editorViewRef.current = new EditorView({
        parent: editorHost,
        state: EditorState.create({
          doc: editorCode,
          extensions,
        }),
      });
      editorHost.addEventListener("keydown", stopNestedEditorDomKeyDown);
    }

    void mountEditor();

    return () => {
      disposed = true;
      editorViewRef.current?.destroy();
      editorViewRef.current = null;
      editorHost.removeEventListener("keydown", stopNestedEditorDomKeyDown);
    };
  }, [
    autoLoadLanguageSupport,
    disableExpandControls,
    editorCode,
    effectiveLanguage,
    forceReadOnly,
    lineNumberPrefix,
    lineNumberStart,
    lineNumberColumns,
    readOnly,
  ]);

  function handleLanguageChange(nextLanguage: string | null) {
    parentEditor.update(() => {
      lexicalNode.setLanguage(
        nextLanguage === CODE_LANGUAGE_EMPTY_VALUE ? "" : (nextLanguage ?? ""),
      );
      setTimeout(() => {
        parentEditor.update(() => {
          lexicalNode.getLatest().select();
        });
      });
    });
  }

  return (
    <div ref={setCodeBlockReference} className={cn("rudu-comment-editor-code-block", className)}>
      {hideLanguageToolbar ? null : (
        <div
          ref={setLanguageToolbar}
          className="rudu-comment-editor-code-toolbar"
          data-open={isLanguageComboboxOpen ? "true" : undefined}
          style={floatingStyles}
        >
          <Combobox
            aria-label={t("codeBlock.selectLanguage", "Select code block language")}
            className="rudu-comment-editor-code-language-combobox"
            contentClassName="rudu-comment-editor-code-language-combobox-content"
            disabled={readOnly}
            options={languageOptions}
            placeholder={t("codeBlock.inlineLanguage", "Language")}
            value={selectedLanguage || null}
            onOpenChange={setIsLanguageComboboxOpen}
            onValueChange={handleLanguageChange}
          />
        </div>
      )}
      <div ref={editorHostRef} />
    </div>
  );
}

const commentCodeMirrorDescriptor: CodeBlockEditorDescriptor = {
  priority: 10,
  match: () => true,
  Editor: CommentCodeMirrorEditor,
};

export {
  CommentCodeMirrorEditor,
  commentCodeMirrorDescriptor,
  commentCodeMirrorTheme,
  sourceCodeFormattingKeymap,
};
