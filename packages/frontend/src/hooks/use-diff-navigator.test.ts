import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDiffNavigatorController } from './use-diff-navigator';

function createFakeNode() {
  let callCount = 0;
  let lastOptions: ScrollIntoViewOptions | undefined;

  return {
    node: {
      scrollIntoView(options?: ScrollIntoViewOptions) {
        callCount += 1;
        lastOptions = options;
      },
    },
    getCallCount() {
      return callCount;
    },
    getLastOptions() {
      return lastOptions;
    },
  };
}

function createController(options?: {
  prKey?: string | null;
  isDiffReady?: boolean;
  hasDiffError?: boolean;
}) {
  let selectedFilePath: string | null = null;
  let pendingScrollPath: string | null = null;

  const controller = createDiffNavigatorController({
    prKey: options?.prKey ?? 'repo#1@sha',
    isDiffReady: options?.isDiffReady ?? true,
    hasDiffError: options?.hasDiffError ?? false,
    getSelectedFilePath() {
      return selectedFilePath;
    },
    setSelectedFilePath(path) {
      selectedFilePath = path;
    },
    getPendingScrollPath() {
      return pendingScrollPath;
    },
    setPendingScrollPath(path) {
      pendingScrollPath = path;
    },
  });

  return {
    controller,
    getSelectedFilePath() {
      return selectedFilePath;
    },
  };
}

describe('createDiffNavigatorController', () => {
  it('queues pending navigation when selecting a file without an anchor', () => {
    const { controller, getSelectedFilePath } = createController();

    controller.onSelectFile('src/app.ts');

    assert.equal(getSelectedFilePath(), 'src/app.ts');
    assert.equal(controller.getState().pendingScrollPath, 'src/app.ts');
  });

  it('does not flush pending navigation while diff is not ready or has an error', () => {
    const { controller } = createController({
      isDiffReady: false,
    });
    const firstNode = createFakeNode();

    controller.registerDiffNode('src/app.ts', firstNode.node as HTMLDivElement);
    controller.onSelectFile('src/app.ts');
    assert.equal(firstNode.getCallCount(), 0);

    controller.setReadiness(true, true);
    assert.equal(firstNode.getCallCount(), 0);
    assert.equal(controller.getState().pendingScrollPath, 'src/app.ts');
  });

  it('flushes pending navigation when a matching anchor is registered and diff is ready', () => {
    const { controller } = createController();
    const node = createFakeNode();

    controller.onSelectFile('src/app.ts');
    assert.equal(controller.getState().pendingScrollPath, 'src/app.ts');

    controller.registerDiffNode('src/app.ts', node.node as HTMLDivElement);

    assert.equal(node.getCallCount(), 1);
    assert.deepEqual(node.getLastOptions(), {
      behavior: 'auto',
      block: 'start',
      inline: 'nearest',
    });
    assert.equal(controller.getState().pendingScrollPath, null);
  });

  it('preserves selection without queueing scroll when PR key changes', () => {
    const { controller, getSelectedFilePath } = createController({
      prKey: 'repo#1@shaA',
    });
    const node = createFakeNode();

    controller.onSelectFile('src/app.ts');
    controller.registerDiffNode('src/app.ts', node.node as HTMLDivElement);
    assert.equal(getSelectedFilePath(), 'src/app.ts');
    assert.equal(controller.getState().pendingScrollPath, null);

    controller.setPrKey('repo#2@shaB');

    assert.equal(getSelectedFilePath(), 'src/app.ts');
    assert.equal(controller.getState().pendingScrollPath, null);
  });

  it('does not re-scroll valid selection on content change', () => {
    const { controller, getSelectedFilePath } = createController();
    const node = createFakeNode();

    controller.registerDiffNode('src/app.ts', node.node as HTMLDivElement);
    controller.onSelectFile('src/app.ts');
    assert.equal(node.getCallCount(), 1);

    controller.notifyDiffContentChanged();

    assert.equal(getSelectedFilePath(), 'src/app.ts');
    assert.equal(node.getCallCount(), 1);
    assert.equal(controller.getState().pendingScrollPath, null);
  });

  it('clears selection when selected file no longer exists after content changes', () => {
    const { controller, getSelectedFilePath } = createController();
    const selectedNode = createFakeNode();
    const otherNode = createFakeNode();

    controller.registerDiffNode('src/selected.ts', selectedNode.node as HTMLDivElement);
    controller.registerDiffNode('src/other.ts', otherNode.node as HTMLDivElement);
    controller.onSelectFile('src/selected.ts');
    assert.equal(getSelectedFilePath(), 'src/selected.ts');

    controller.registerDiffNode('src/selected.ts', null);
    controller.notifyDiffContentChanged();

    assert.equal(getSelectedFilePath(), null);
    assert.equal(controller.getState().pendingScrollPath, null);
  });
});
