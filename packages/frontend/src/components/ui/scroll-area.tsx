import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';
import type { ComponentProps, Ref } from 'react';
import { forwardRef } from 'react';
import { cx } from '../../lib/cx';

type ScrollAreaOrientation = 'vertical' | 'horizontal' | 'both';

type ScrollAreaProps = ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  contentClassName?: string;
  contentStyle?: ComponentProps<typeof ScrollAreaPrimitive.Content>['style'];
  orientation?: ScrollAreaOrientation;
  viewportClassName?: string;
  viewportProps?: Omit<
    ComponentProps<typeof ScrollAreaPrimitive.Viewport>,
    'className' | 'children' | 'ref'
  >;
  viewportRef?: Ref<HTMLDivElement>;
};

const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  (
    {
      children,
      className,
      contentClassName,
      contentStyle,
      orientation = 'both',
      viewportClassName,
      viewportProps,
      viewportRef,
      ...props
    },
    ref,
  ) => {
    const isVertical = orientation === 'vertical';
    const isHorizontal = orientation === 'horizontal';
    const orientationContentStyle =
      orientation === 'vertical'
        ? { minWidth: '100%', width: '100%' }
        : orientation === 'horizontal'
          ? { minHeight: '100%', height: '100%' }
          : undefined;

    return (
      <ScrollAreaPrimitive.Root
        className={cx('relative overflow-hidden', className)}
        ref={ref}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport
          className={cx(
            'h-full w-full rounded-[inherit]',
            isVertical && 'overflow-x-hidden',
            isHorizontal && 'overflow-y-hidden',
            viewportClassName,
          )}
          ref={viewportRef}
          {...viewportProps}
        >
          <ScrollAreaPrimitive.Content
            className={cx('block', contentClassName)}
            style={{ ...orientationContentStyle, ...contentStyle }}
          >
            {children}
          </ScrollAreaPrimitive.Content>
        </ScrollAreaPrimitive.Viewport>
        {!isHorizontal ? <ScrollBar orientation="vertical" /> : null}
        {!isVertical ? <ScrollBar orientation="horizontal" /> : null}
        {orientation === 'both' ? <ScrollAreaPrimitive.Corner /> : null}
      </ScrollAreaPrimitive.Root>
    );
  },
);

ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cx(
        'z-20 flex touch-none p-px opacity-0 transition-[opacity,colors] duration-150 select-none data-[hovering]:opacity-100 data-[scrolling]:opacity-100',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
        className,
      )}
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-ink-300/80 transition-colors duration-150 hover:bg-ink-400 dark:bg-ink-600/80 dark:hover:bg-ink-500" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
