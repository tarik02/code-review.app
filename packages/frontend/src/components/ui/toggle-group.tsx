import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';

import { cn } from '@/lib/utils';

function ToggleGroup<Value extends string>({
  className,
  ...props
}: ToggleGroupPrimitive.Props<Value>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn(
        'inline-flex items-center rounded-lg bg-muted p-0.5 text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem<Value extends string>({ className, ...props }: Toggle.Props<Value>) {
  return (
    <Toggle
      data-slot="toggle-group-item"
      className={cn(
        'inline-flex h-8 min-w-0 flex-1 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[pressed]:bg-background data-[pressed]:text-foreground data-[pressed]:shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
