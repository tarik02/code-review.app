import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import Fuse from 'fuse.js';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog, DialogContent } from './dialog';
import { ScrollArea } from './scroll-area';
import { cx } from '../../lib/cx';

type CommandPaletteItem = {
  id: string;
  group: string;
  title: string;
  subtitle?: string | null;
  keywords?: string[];
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

type CommandPaletteProps = {
  accessory?: ReactNode;
  dialogClassName?: string;
  emptyDescription?: string;
  emptyTitle: string;
  filterMode?: 'fuse' | 'none';
  footer?: ReactNode;
  inputFooter?: ReactNode;
  items: CommandPaletteItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder: string;
  query?: string;
  searchKeys?: ReadonlyArray<Fuse.FuseOptionKey<CommandPaletteItem>>;
  onQueryChange?: (value: string) => void;
};

const DEFAULT_SEARCH_KEYS: ReadonlyArray<Fuse.FuseOptionKey<CommandPaletteItem>> = [
  { name: 'title', weight: 0.7 },
  { name: 'keywords', weight: 0.5 },
  { name: 'subtitle', weight: 0.2 },
];

function renderHighlightedText(value: string, query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return value;
  }

  const normalizedValue = value.toLowerCase();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const matchIndex = normalizedValue.indexOf(normalizedQuery);
  if (matchIndex < 0) {
    return value;
  }

  const matchEnd = matchIndex + trimmedQuery.length;

  return (
    <>
      {value.slice(0, matchIndex)}
      <mark className="rounded-sm bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-500/25">
        {value.slice(matchIndex, matchEnd)}
      </mark>
      {value.slice(matchEnd)}
    </>
  );
}

function handleEscapeKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  onOpenChange: (open: boolean) => void,
) {
  if (event.key !== 'Escape') {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  onOpenChange(false);
}

function CommandPalette({
  accessory,
  dialogClassName,
  emptyDescription,
  emptyTitle,
  filterMode = 'fuse',
  footer,
  inputFooter,
  items,
  open,
  onOpenChange,
  placeholder,
  query,
  searchKeys = DEFAULT_SEARCH_KEYS,
  onQueryChange,
}: CommandPaletteProps) {
  const [uncontrolledQuery, setUncontrolledQuery] = useState('');
  const currentQuery = query ?? uncontrolledQuery;

  useEffect(() => {
    if (open) {
      return;
    }

    if (query !== undefined) {
      onQueryChange?.('');
      return;
    }

    setUncontrolledQuery('');
  }, [onQueryChange, open, query]);

  const filteredItems = useMemo(() => {
    if (filterMode === 'none' || !currentQuery.trim()) {
      return items;
    }

    const fuse = new Fuse(items, {
      includeScore: true,
      keys: searchKeys,
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 1,
    });

    return fuse.search(currentQuery.trim()).map((result) => result.item);
  }, [currentQuery, filterMode, items, searchKeys]);

  const groupedItems = useMemo(() => {
    const groups = new Map<
      string,
      { group: string; entries: Array<{ index: number; item: CommandPaletteItem }> }
    >();

    for (let index = 0; index < filteredItems.length; index += 1) {
      const item = filteredItems[index];
      const existing = groups.get(item.group);
      if (existing) {
        existing.entries.push({ index, item });
        continue;
      }

      groups.set(item.group, {
        group: item.group,
        entries: [{ index, item }],
      });
    }

    return [...groups.values()];
  }, [filteredItems]);

  function handleQueryChange(value: string) {
    if (query !== undefined) {
      onQueryChange?.(value);
      return;
    }

    setUncontrolledQuery(value);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cx(
          'max-w-[760px] overflow-hidden border border-neutral-400 p-0 dark:border-neutral-700',
          dialogClassName,
        )}
        onKeyDownCapture={(event) => handleEscapeKeyDown(event, onOpenChange)}
      >
        <Autocomplete.Root<CommandPaletteItem>
          autoHighlight="always"
          items={filteredItems}
          mode="none"
          value={currentQuery}
          onValueChange={handleQueryChange}
        >
          <div className="border-b border-neutral-300 bg-surface px-3 py-3 dark:border-neutral-700">
            <Autocomplete.InputGroup className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-canvas px-3 py-2 shadow-sm transition focus-within:border-neutral-400 dark:border-neutral-700">
              <Autocomplete.Input
                aria-label={placeholder}
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-500"
                placeholder={placeholder}
                onKeyDown={(event) => event.stopPropagation()}
              />
              {accessory ? <div className="shrink-0">{accessory}</div> : null}
            </Autocomplete.InputGroup>
            {inputFooter ? <div className="mt-2">{inputFooter}</div> : null}
          </div>

          <ScrollArea
            className="bg-surface"
            contentClassName="p-2"
            orientation="vertical"
            viewportClassName="max-h-[60vh] h-auto bg-surface"
          >
            {filteredItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-300 bg-canvas px-4 py-8 text-center dark:border-neutral-700">
                <p className="text-sm font-medium text-ink-800">{emptyTitle}</p>
                {emptyDescription ? (
                  <p className="mt-1 text-sm text-ink-500">{emptyDescription}</p>
                ) : null}
              </div>
            ) : (
              <Autocomplete.List className="flex flex-col gap-1">
                {groupedItems.map((group, groupIndex) => (
                  <div key={group.group}>
                    <div className={cx(
                      'px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500',
                      groupIndex === 0 ? 'pt-1' : 'pt-3',
                    )}>
                      {group.group}
                    </div>
                    {group.entries.map(({ index, item }) => (
                      <Autocomplete.Item
                        className={cx(
                          'flex items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition hover:bg-canvas hover:text-ink-900 data-[highlighted]:bg-canvas dark:hover:bg-canvasDark dark:data-[highlighted]:bg-canvasDark',
                          item.disabled && 'pointer-events-none opacity-50',
                        )}
                        disabled={item.disabled}
                        index={index}
                        key={item.id}
                        value={item}
                        onClick={() => {
                          if (item.disabled) {
                            return;
                          }

                          item.onSelect();
                        }}
                      >
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-canvas text-ink-600 dark:bg-canvasDark">
                          {item.icon}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-ink-900">
                              {renderHighlightedText(item.title, currentQuery)}
                            </p>
                            {item.badge ? <div className="shrink-0">{item.badge}</div> : null}
                          </div>
                          {item.subtitle ? (
                            <p className="truncate text-xs text-ink-500">
                              {renderHighlightedText(item.subtitle, currentQuery)}
                            </p>
                          ) : null}
                        </div>
                      </Autocomplete.Item>
                    ))}
                  </div>
                ))}
              </Autocomplete.List>
            )}
          </ScrollArea>

          {footer ? (
            <div className="border-t border-neutral-300 bg-surface px-3 py-3 dark:border-neutral-700">
              {footer}
            </div>
          ) : null}
        </Autocomplete.Root>
      </DialogContent>
    </Dialog>
  );
}

export { CommandPalette, renderHighlightedText };
export type { CommandPaletteItem, CommandPaletteProps };
