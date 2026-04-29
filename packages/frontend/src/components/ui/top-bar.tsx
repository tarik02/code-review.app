import { ReactNode } from "react";
import { cx } from "../../lib/cx";
import { trpc } from "../../lib/trpc";

const TOP_BAR_MACOS_HEIGHT = "40px";
const TOP_BAR_WCO_HEIGHT =
  "calc(env(titlebar-area-y) + env(titlebar-area-height))";

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
        "macos:h-[40px] macos:not-fullscreen:data-[position=left]:pl-[calc(72px+1em)]",
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

export { TOP_BAR_MACOS_HEIGHT, TOP_BAR_WCO_HEIGHT };
