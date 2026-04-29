import { EditorView } from '@codemirror/view';

type CodeMirrorStyleRoot = Document | ShadowRoot;

const rootsWithCodeMirrorStyles = new WeakSet<CodeMirrorStyleRoot>();

function isCodeMirrorStyleRoot(root: Node): root is CodeMirrorStyleRoot {
  return (
    root instanceof Document || (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot)
  );
}

function getCodeMirrorStyleHost(root: CodeMirrorStyleRoot) {
  return root instanceof Document ? root.body : root;
}

function ensureCodeMirrorStyles(root?: Node | null) {
  if (typeof document === 'undefined') {
    return;
  }

  const targetRoot = root ?? document;

  if (!isCodeMirrorStyleRoot(targetRoot) || rootsWithCodeMirrorStyles.has(targetRoot)) {
    return;
  }

  const styleHost = getCodeMirrorStyleHost(targetRoot);
  if (!styleHost) {
    return;
  }

  rootsWithCodeMirrorStyles.add(targetRoot);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-10000px;top:-10000px;width:0;height:0;overflow:hidden;pointer-events:none;';

  styleHost.appendChild(host);

  const view = new EditorView({
    parent: host,
    doc: '',
  });

  view.destroy();
  host.remove();
}

export { ensureCodeMirrorStyles };
