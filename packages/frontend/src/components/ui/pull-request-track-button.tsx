import { StarIcon as SolidStarIcon } from '@heroicons/react/24/solid';
import { StarIcon as OutlineStarIcon } from '@heroicons/react/24/outline';
import { Button } from './button';
import { cx } from '../../lib/cx';

type PullRequestTrackButtonProps = {
  tracked: boolean;
  className?: string;
  onClick: () => void;
};

function PullRequestTrackButton({ tracked, className, onClick }: PullRequestTrackButtonProps) {
  const Icon = tracked ? SolidStarIcon : OutlineStarIcon;

  return (
    <Button
      aria-label={tracked ? 'Remove from tracked' : 'Add to tracked'}
      className={cx(
        'text-ink-500 hover:text-amber-600',
        tracked && 'text-amber-500 hover:text-amber-500',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      size="icon-xs"
      type="button"
      variant="ghost"
    >
      <Icon className="size-4 shrink-0" />
    </Button>
  );
}

export { PullRequestTrackButton };
