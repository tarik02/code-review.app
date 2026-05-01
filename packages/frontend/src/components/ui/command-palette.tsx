import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import Fuse, { type FuseOptionKey } from 'fuse.js';
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
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
};

type CommandPaletteProps = {
  accessory?: ReactNode;
  dialogClassName?: string;
  emptyDescription?: string;
  emptyTitle: string;
  filterQuery?: string;
  filterMode?: 'fuse' | 'none';
  footer?: ReactNode;
  inputFooter?: ReactNode;
  items: CommandPaletteItem[];
  numberedShortcuts?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder: string;
  query?: string;
  searchKeys?: ReadonlyArray<FuseOptionKey<CommandPaletteItem>>;
  onQueryChange?: (value: string) => void;
};

const DEFAULT_SEARCH_KEYS: ReadonlyArray<FuseOptionKey<CommandPaletteItem>> = [
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

function matchesShortcut(event: KeyboardEvent<HTMLDivElement>, shortcut: string) {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const key = parts.at(-1);
  if (!key) {
    return false;
  }

  const wantsMod = parts.includes('mod');
  const wantsCtrl = parts.includes('ctrl');
  const wantsMeta = parts.includes('meta') || parts.includes('cmd');
  const wantsShift = parts.includes('shift');
  const wantsAlt = parts.includes('alt') || parts.includes('option');

  if (wantsMod && !(event.metaKey || event.ctrlKey)) {
    return false;
  }
  if (wantsCtrl && !event.ctrlKey) {
    return false;
  }
  if (wantsMeta && !event.metaKey) {
    return false;
  }
  if (event.shiftKey !== wantsShift) {
    return false;
  }
  if (event.altKey !== wantsAlt) {
    return false;
  }

  return event.key.toLowerCase() === key;
}

function isMacPlatform() {
  const platform = navigator.platform.toLowerCase();
  return platform.includes('mac') || platform.includes('iphone') || platform.includes('ipad');
}

function formatShortcut(shortcut: string) {
  const isMac = isMacPlatform();
  return shortcut
    .split('+')
    .map((part) => {
      const normalized = part.trim().toLowerCase();
      if (normalized === 'mod') return isMac ? '⌘' : 'Ctrl';
      if (normalized === 'cmd' || normalized === 'meta') return '⌘';
      if (normalized === 'ctrl') return 'Ctrl';
      if (normalized === 'shift') return isMac ? '⇧' : 'Shift';
      if (normalized === 'alt' || normalized === 'option') return isMac ? '⌥' : 'Alt';
      return part.trim().toUpperCase();
    })
    .join(isMac ? '' : '+');
}

function CommandPalette({
  accessory,
  dialogClassName,
  emptyDescription,
  emptyTitle,
  filterQuery,
  filterMode = 'fuse',
  footer,
  inputFooter,
  items,
  numberedShortcuts = false,
  open,
  onOpenChange,
  placeholder,
  query,
  searchKeys = DEFAULT_SEARCH_KEYS,
  onQueryChange,
}: CommandPaletteProps) {
  const [uncontrolledQuery, setUncontrolledQuery] = useState('');
  const currentQuery = query ?? uncontrolledQuery;
  const currentFilterQuery = filterQuery ?? currentQuery;

  useEffect(() => {
    if (open) {
      return;
    }

    if (query !== undefined) {
      onQueryChange?.('');
      return;
    }

    window.setTimeout(() => setUncontrolledQuery(''), 0);
  }, [onQueryChange, open, query]);

  const filteredItems = useMemo(() => {
    if (filterMode === 'none' || !currentFilterQuery.trim()) {
      return items;
    }

    const fuse = new Fuse(items, {
      includeScore: true,
      keys: [...searchKeys],
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 1,
    });

    return fuse.search(currentFilterQuery.trim()).map((result) => result.item);
  }, [currentFilterQuery, filterMode, items, searchKeys]);

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

  function selectItem(item: CommandPaletteItem) {
    if (item.disabled) {
      return;
    }

    item.onSelect();
  }

  function handleKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    handleEscapeKeyDown(event, onOpenChange);

    const shortcutItem = filteredItems.find(
      (item) => item.shortcut && !item.disabled && matchesShortcut(event, item.shortcut),
    );
    if (shortcutItem) {
      event.preventDefault();
      event.stopPropagation();
      selectItem(shortcutItem);
      return;
    }

    if (!numberedShortcuts || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
      return;
    }

    const numericKey = event.key === '0' ? 10 : Number.parseInt(event.key, 10);
    if (!Number.isInteger(numericKey) || numericKey < 1 || numericKey > 9) {
      return;
    }

    const item = filteredItems[numericKey - 1];
    if (!item || item.disabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectItem(item);
  }

  function getItemShortcut(item: CommandPaletteItem, index: number) {
    if (item.shortcut) {
      return item.shortcut;
    }

    if (numberedShortcuts && !item.disabled && index < 9) {
      return `Mod+${index + 1}`;
    }

    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cx(
          'max-h-[calc(100vh-2rem)] max-w-[760px] overflow-hidden border border-neutral-400 p-0 dark:border-neutral-700',
          dialogClassName,
        )}
        onKeyDownCapture={handleKeyDownCapture}
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
            viewportClassName="h-auto max-h-[calc(100vh-12rem)] bg-surface"
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
                    <div
                      className={cx(
                        'px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500',
                        groupIndex === 0 ? 'pt-1' : 'pt-3',
                      )}
                    >
                      {group.group}
                    </div>
                    {group.entries.map(({ index, item }) => {
                      const shortcut = getItemShortcut(item, index);

                      return (
                        <Autocomplete.Item
                          className={cx(
                            'flex items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition hover:bg-canvas hover:text-ink-900 data-[highlighted]:bg-canvas dark:hover:bg-canvasDark dark:data-[highlighted]:bg-canvasDark',
                            item.disabled && 'pointer-events-none opacity-50',
                          )}
                          disabled={item.disabled}
                          index={index}
                          key={item.id}
                          value={item}
                          onClick={() => selectItem(item)}
                        >
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-canvas text-ink-600 dark:bg-canvasDark">
                            {item.icon}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="select-none truncate text-sm font-medium text-ink-900">
                                {renderHighlightedText(item.title, currentFilterQuery)}
                              </p>
                              {item.badge ? <div className="shrink-0">{item.badge}</div> : null}
                            </div>
                            {item.subtitle ? (
                              <p className="select-none truncate text-xs text-ink-500">
                                {renderHighlightedText(item.subtitle, currentFilterQuery)}
                              </p>
                            ) : null}
                          </div>

                          {shortcut ? (
                            <div className="shrink-0 select-none rounded border border-neutral-300 bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-500 dark:border-neutral-700">
                              {formatShortcut(shortcut)}
                            </div>
                          ) : null}
                        </Autocomplete.Item>
                      );
                    })}
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
