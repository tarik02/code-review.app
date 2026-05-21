import { trpc } from './trpc';

async function writeClipboardText(value: string) {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard) {
    await clipboard.writeText(value);
    return;
  }

  await trpc.window.writeClipboardText.mutate(value);
}

export { writeClipboardText };
