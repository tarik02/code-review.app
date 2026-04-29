import type { CSSProperties, ReactNode, UIEvent } from "react";
import { useCallback, useState } from "react";
import { Virtualizer as PierreVirtualizer, type VirtualizerConfig } from "@pierre/diffs";
import { VirtualizerContext } from "@pierre/diffs/react";

type PatchScrollVirtualizerProps = {
  children: ReactNode;
  className?: string;
  config?: Partial<VirtualizerConfig>;
  contentClassName?: string;
  contentStyle?: CSSProperties;
  onRootChange?: (node: HTMLDivElement | null) => void;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  style?: CSSProperties;
};

function PatchScrollVirtualizer({
  children,
  className,
  config,
  contentClassName,
  contentStyle,
  onRootChange,
  onScroll,
  style,
}: PatchScrollVirtualizerProps) {
  const [instance] = useState(() =>
    typeof window !== "undefined" ? new PierreVirtualizer(config) : undefined,
  );

  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        instance?.setup(node);
        onRootChange?.(node);
        return;
      }

      onRootChange?.(null);
      instance?.cleanUp();
    },
    [instance, onRootChange],
  );

  return (
    <VirtualizerContext.Provider value={instance}>
      <div className={className} onScroll={onScroll} ref={setRoot} style={style}>
        <div className={contentClassName} style={contentStyle}>
          {children}
        </div>
      </div>
    </VirtualizerContext.Provider>
  );
}

export { PatchScrollVirtualizer };
