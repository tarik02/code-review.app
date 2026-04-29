import { trpc } from "./trpc";

const WINDOW_FULLSCREEN_CLASS_NAME = "window-fullscreen";

export function syncDocumentWindowFullscreenClass(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const update = (isFullScreen: boolean) => {
    document.documentElement.classList.toggle(WINDOW_FULLSCREEN_CLASS_NAME, isFullScreen);
  };

  const subscription = trpc.window.fullScreenStatus.subscribe(undefined, {
    onData: update,
    onError() {
      update(false);
    },
  });

  return () => subscription.unsubscribe();
}
