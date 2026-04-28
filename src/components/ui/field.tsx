import * as React from "react";
import { cn } from "@/lib/utils";

type FieldProps = React.ComponentProps<"div"> & {
  orientation?: "vertical" | "horizontal";
};

function Field({
  className,
  orientation = "vertical",
  ...props
}: FieldProps) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-md border border-neutral-200 bg-surface p-3 transition dark:border-neutral-700",
        orientation === "horizontal"
          ? "items-start justify-between"
          : "flex-col",
        className,
      )}
      {...props}
    />
  );
}

function FieldContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("min-w-0 flex-1", className)} {...props} />;
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("mt-1 text-xs font-normal text-ink-500", className)}
      {...props}
    />
  );
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("block cursor-pointer text-sm", className)}
      {...props}
    />
  );
}

function FieldTitle({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("block text-sm font-semibold text-ink-900", className)}
      {...props}
    />
  );
}

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
};
