import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import type { ReactNode } from 'react';
import { buttonVariants } from './button';
import { cx } from '../../lib/cx';

type AppToastData = {
  action?: 'refresh-pull-request';
};

const appToastManager = ToastPrimitive.createToastManager<AppToastData>();

function AppToastProvider({ children }: { children: ReactNode }) {
  return (
    <ToastPrimitive.Provider limit={3} timeout={8000} toastManager={appToastManager}>
      {children}
    </ToastPrimitive.Provider>
  );
}

function AppToaster({ onRefreshPullRequest }: { onRefreshPullRequest: () => void }) {
  const { close, toasts } = ToastPrimitive.useToastManager<AppToastData>();

  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-50 flex w-[min(420px,calc(100vw-32px))] flex-col gap-2 outline-none">
        {toasts.map((toast) => {
          const hasRefreshAction = toast.data?.action === 'refresh-pull-request';
          const shouldRenderActions = hasRefreshAction || toast.type === 'error';

          return (
            <ToastPrimitive.Root
              className={cx(
                'rounded-md border border-neutral-200 bg-surface px-3 py-2 text-sm text-ink-700 shadow-lg dark:border-neutral-700',
                toast.type === 'error' &&
                  'border-red-200 shadow-[inset_3px_0_0_rgb(185_28_28)] dark:border-red-900/50',
              )}
              key={toast.id}
              swipeDirection="right"
              toast={toast}
            >
              <ToastPrimitive.Content>
                {toast.title ? (
                  <ToastPrimitive.Title className="text-sm font-medium text-ink-900">
                    {toast.title}
                  </ToastPrimitive.Title>
                ) : null}
                {toast.description ? (
                  <ToastPrimitive.Description className={cx('text-ink-600', toast.title && 'mt-1')}>
                    {toast.description}
                  </ToastPrimitive.Description>
                ) : null}
                {shouldRenderActions ? (
                  <div className="mt-2 flex justify-end gap-2">
                    {hasRefreshAction ? (
                      <ToastPrimitive.Action
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        onClick={() => {
                          close(toast.id);
                          onRefreshPullRequest();
                        }}
                        type="button"
                      >
                        Refresh
                      </ToastPrimitive.Action>
                    ) : null}
                    <ToastPrimitive.Close
                      className={buttonVariants({
                        variant: 'ghost',
                        size: 'sm',
                        className: 'text-ink-600 hover:text-ink-900',
                      })}
                      type="button"
                    >
                      Dismiss
                    </ToastPrimitive.Close>
                  </div>
                ) : null}
              </ToastPrimitive.Content>
            </ToastPrimitive.Root>
          );
        })}
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  );
}

export { AppToaster, AppToastProvider, appToastManager };
