import { ViewPlugin, type EditorView, type Extension } from "@codemirror/view";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

function createSourceEditorViewBridge(
  sourceEditorViewRef: MutableRefObject<EditorView | null>,
  setSourceEditorView: Dispatch<SetStateAction<EditorView | null>>,
): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(private readonly view: EditorView) {
        sourceEditorViewRef.current = view;
        setSourceEditorView(view);
      }

      destroy() {
        if (sourceEditorViewRef.current === this.view) {
          sourceEditorViewRef.current = null;
          setSourceEditorView(null);
        }
      }
    },
  );
}

export { createSourceEditorViewBridge };
