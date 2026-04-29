import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cx } from "../../lib/cx";

function toClassName(className: unknown) {
  return typeof className === "string" ? className : undefined;
}

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger {...props} />;
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-slate-950/50" />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <DialogPrimitive.Popup
          className={cx(
            "flex max-h-[80vh] w-full max-w-[520px] flex-col rounded-xl bg-surface shadow-dialog",
            toClassName(className),
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cx("m-0 text-lg font-bold", toClassName(className))}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cx("m-0 text-sm text-ink-600", toClassName(className))}
      {...props}
    />
  );
}

function DialogClose({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close
      className={cx(
        "rounded-xl border border-ink-300 bg-surface px-3.5 py-2.5 text-ink-900 transition hover:border-zinc-400 hover:bg-canvas disabled:cursor-default disabled:opacity-60",
        toClassName(className),
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
};
