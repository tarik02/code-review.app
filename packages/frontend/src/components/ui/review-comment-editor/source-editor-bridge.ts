import type { Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import type { Dispatch, SetStateAction } from 'react';

function createSourceEditorViewBridge(
  setSourceEditorView: Dispatch<SetStateAction<EditorView | null>>,
): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(private readonly view: EditorView) {
        setSourceEditorView(view);
      }

      destroy() {
        setSourceEditorView((current) => (current === this.view ? null : current));
      }
    },
  );
}

export { createSourceEditorViewBridge };
