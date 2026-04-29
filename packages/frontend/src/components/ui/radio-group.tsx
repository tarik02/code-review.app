import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "@/lib/utils";

function RadioGroup<Value>({ className, ...props }: RadioGroupPrimitive.Props<Value>) {
  return <RadioGroupPrimitive className={cn("grid gap-2", className)} {...props} />;
}

function RadioGroupItem<Value>({ className, ...props }: Radio.Root.Props<Value>) {
  return (
    <Radio.Root
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-surface text-ink-900 outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:border-ink-900 dark:border-neutral-600 dark:data-[checked]:border-ink-200",
        className,
      )}
      {...props}
    >
      <Radio.Indicator className="size-2 rounded-full bg-ink-900 dark:bg-ink-200" />
    </Radio.Root>
  );
}

export { RadioGroup, RadioGroupItem };
