import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';

type ComboboxOption = {
  label: string;
  value: string;
};

type ComboboxBaseProps = {
  'aria-label'?: string;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  filter?: null | ((option: ComboboxOption, query: string) => boolean);
  options: ComboboxOption[];
  placeholder?: string;
  inputValue?: string;
  portalContainer?: ComponentProps<typeof ComboboxPrimitive.Portal>['container'];
  onOpenChange?: (open: boolean) => void;
  onInputValueChange?: (value: string) => void;
};

type SingleComboboxProps = ComboboxBaseProps & {
  multiple?: false;
  value: string | null;
  onValueChange: (value: string | null) => void;
};

type MultipleComboboxProps = ComboboxBaseProps & {
  multiple: true;
  value: string[];
  onValueChange: (value: string[]) => void;
};

type ComboboxProps = SingleComboboxProps | MultipleComboboxProps;

function Combobox({
  'aria-label': ariaLabel,
  className,
  contentClassName,
  disabled,
  filter,
  options,
  placeholder,
  inputValue,
  portalContainer,
  multiple,
  value,
  onOpenChange,
  onInputValueChange,
  onValueChange,
}: ComboboxProps) {
  if (multiple) {
    const selectedValue = options.filter((option) => value.includes(option.value));
    return (
      <ComboboxPrimitive.Root<ComboboxOption, true>
        disabled={disabled}
        filter={filter}
        inputValue={inputValue}
        highlightItemOnHover
        isItemEqualToValue={(option, selected) => option.value === selected.value}
        itemToStringLabel={(option) => option.label}
        itemToStringValue={(option) => option.value}
        multiple
        items={options}
        value={selectedValue}
        onInputValueChange={(nextValue) => onInputValueChange?.(nextValue)}
        onOpenChange={(open) => onOpenChange?.(open)}
        onValueChange={(nextValue) => onValueChange(nextValue.map((option) => option.value))}
      >
        <ComboboxParts
          ariaLabel={ariaLabel}
          className={className}
          contentClassName={contentClassName}
          disabled={disabled}
          placeholder={placeholder}
          portalContainer={portalContainer}
        />
      </ComboboxPrimitive.Root>
    );
  }

  const selectedValue = options.find((option) => option.value === value) ?? null;
  return (
    <ComboboxPrimitive.Root<ComboboxOption>
      disabled={disabled}
      filter={filter}
      inputValue={inputValue}
      highlightItemOnHover
      isItemEqualToValue={(option, selected) => option.value === selected.value}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
      items={options}
      value={selectedValue}
      onInputValueChange={(nextValue) => onInputValueChange?.(nextValue)}
      onOpenChange={(open) => onOpenChange?.(open)}
      onValueChange={(nextValue) => onValueChange(nextValue?.value ?? null)}
    >
      <ComboboxParts
        ariaLabel={ariaLabel}
        className={className}
        contentClassName={contentClassName}
        disabled={disabled}
        placeholder={placeholder}
        portalContainer={portalContainer}
      />
    </ComboboxPrimitive.Root>
  );
}

function ComboboxParts({
  ariaLabel,
  className,
  contentClassName,
  disabled,
  placeholder,
  portalContainer,
}: Pick<
  ComboboxBaseProps,
  'className' | 'contentClassName' | 'disabled' | 'placeholder' | 'portalContainer'
> & {
  ariaLabel?: string;
}) {
  return (
    <>
      <ComboboxPrimitive.InputGroup
        className={cn(
          'flex h-7 w-fit min-w-32 items-center rounded-[min(var(--radius-md),10px)] border border-input bg-transparent text-sm text-foreground transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-open:bg-accent',
          className,
        )}
      >
        <ComboboxPrimitive.Input
          aria-label={ariaLabel}
          className="min-w-0 flex-1 bg-transparent px-2 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          disabled={disabled}
          placeholder={placeholder}
          onKeyDown={(event) => event.stopPropagation()}
          onKeyDownCapture={(event) => event.stopPropagation()}
        />
        <ComboboxPrimitive.Trigger
          aria-label={ariaLabel}
          className="flex size-7 shrink-0 items-center justify-center rounded-[min(var(--radius-md),10px)] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed"
          disabled={disabled}
        >
          <ChevronsUpDownIcon className="size-3.5" />
        </ComboboxPrimitive.Trigger>
      </ComboboxPrimitive.InputGroup>
      <ComboboxPrimitive.Portal container={portalContainer}>
        <ComboboxPrimitive.Positioner align="start" className="isolate z-50" sideOffset={4}>
          <ComboboxPrimitive.Popup
            className={cn(
              'relative isolate z-50 max-h-(--available-height) min-w-(--anchor-width) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
              contentClassName,
            )}
            initialFocus={false}
          >
            <ComboboxPrimitive.Empty className="px-2 py-1.5 text-sm text-muted-foreground">
              No results
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List>
              {(option: ComboboxOption, index: number) => (
                <ComboboxPrimitive.Item
                  key={option.value}
                  className="relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  index={index}
                  value={option}
                >
                  <span className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
                    {option.label}
                  </span>
                  <ComboboxPrimitive.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                    <CheckIcon className="size-4" />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </>
  );
}

export { Combobox, type ComboboxOption };
