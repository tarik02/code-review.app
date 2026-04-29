import type { CSSProperties } from "react";
import type { AppearanceBackgroundSettings } from "../../types/forge";

type AppearanceBackgroundProps = {
  background: AppearanceBackgroundSettings | undefined;
  className?: string;
  imageClassName?: string;
};

function AppearanceBackground({
  background,
  className = "",
  imageClassName = "h-full w-full object-cover",
}: AppearanceBackgroundProps) {
  if (background?.kind === "solid") {
    return (
      <div
        aria-hidden="true"
        className={className}
        style={{ backgroundColor: background.color } satisfies CSSProperties}
      />
    );
  }

  const src =
    background?.kind === "customFile" && background.dataUrl
      ? background.dataUrl
      : "./outerworld.jpg";

  return (
    <img alt="" aria-hidden="true" className={`${className} ${imageClassName}`.trim()} src={src} />
  );
}

export { AppearanceBackground };
export type { AppearanceBackgroundProps };
