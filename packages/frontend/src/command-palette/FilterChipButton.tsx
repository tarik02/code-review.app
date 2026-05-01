import type { ReactNode } from 'react';

function FilterChipButton({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <button
      className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-canvas px-2 py-1 text-[11px] font-medium text-ink-700 transition hover:border-neutral-400 dark:border-neutral-700"
      onClick={onClear}
      type="button"
    >
      <span>{children}</span>
      <span aria-hidden="true" className="text-ink-500">
        x
      </span>
    </button>
  );
}

export { FilterChipButton };
