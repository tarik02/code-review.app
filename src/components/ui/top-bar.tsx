import { ReactNode } from "react";
import {} from "tailwind-merge";
import { cx } from "../../lib/cx";
import { trpc } from "../../lib/trpc";

interface Props {
  position: "left" | "middle" | "right";
  children?: ReactNode;
  className?: string;
}

export function TopBar(props: Props) {
  const { position, children, className } = props;

  return (
    <div
      className={cx(
        "macos:h-[40px] macos:data-[position=left]:pl-[72px]",
        "wco:h-[calc(env(titlebar-area-y)+env(titlebar-area-height))]",
        "wco:data-[position=left]-pl-[env(titlebar-area-x)]",
        "wco:data-[position=right]-pr-[calc(env(titlebar-area-width)-env(titlebar-area-x))]",
        className,
      )}
      data-position={position}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (event.detail === 2) {
          void trpc.window.toggleMaximize.mutate();
        }
      }}
    >
      {children}
    </div>
  );
}
