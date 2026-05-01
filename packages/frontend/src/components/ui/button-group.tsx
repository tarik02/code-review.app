import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

function ButtonGroup({
  className,
  orientation = 'horizontal',
  ...props
}: ComponentProps<'div'> & {
  orientation?: 'horizontal' | 'vertical';
}) {
  return (
    <div
      data-orientation={orientation}
      data-slot="button-group"
      className={cn(
        'inline-flex items-stretch',
        orientation === 'horizontal'
          ? '[&>*+*]:-ml-px [&>*:first-child]:rounded-r-none [&>*:last-child]:rounded-l-none [&>*:not(:first-child):not(:last-child)]:rounded-none'
          : 'flex-col [&>*+*]:-mt-px [&>*:first-child]:rounded-b-none [&>*:last-child]:rounded-t-none [&>*:not(:first-child):not(:last-child)]:rounded-none',
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup };
