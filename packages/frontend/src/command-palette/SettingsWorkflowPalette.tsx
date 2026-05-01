import { useNavigate } from '@tanstack/react-router';
import { EyeIcon, MessageSquareMoreIcon, PaintbrushIcon, UserCircle2Icon } from 'lucide-react';
import { CommandPalette, type CommandPaletteItem } from '../components/ui/command-palette';
import { useCommandPaletteStore } from './store';

type SettingsCommandPalettesProps = {
  handleBackToPrs: () => void;
};

function SettingsWorkflowPalette({ handleBackToPrs }: SettingsCommandPalettesProps) {
  const navigate = useNavigate();
  const open = useCommandPaletteStore((state) => state.workflowOpen);
  const setWorkflowOpen = useCommandPaletteStore((state) => state.setWorkflowOpen);
  const workflowQuery = useCommandPaletteStore((state) => state.workflowQuery);
  const setWorkflowQuery = useCommandPaletteStore((state) => state.setWorkflowQuery);

  const items: CommandPaletteItem[] = [
    {
      id: 'settings-appearance',
      group: 'Sections',
      title: 'Appearance',
      icon: <PaintbrushIcon className="size-4" />,
      onSelect: () => {
        void navigate({ to: '/settings/appearance' });
        setWorkflowOpen(false);
      },
    },
    {
      id: 'settings-profiles',
      group: 'Sections',
      title: 'Profiles',
      icon: <UserCircle2Icon className="size-4" />,
      onSelect: () => {
        void navigate({ to: '/settings/profiles' });
        setWorkflowOpen(false);
      },
    },
    {
      id: 'settings-review',
      group: 'Sections',
      title: 'Review',
      icon: <MessageSquareMoreIcon className="size-4" />,
      onSelect: () => {
        void navigate({ to: '/settings/review' });
        setWorkflowOpen(false);
      },
    },
    {
      id: 'settings-back',
      group: 'Sections',
      title: 'Back to PRs',
      icon: <EyeIcon className="size-4" />,
      onSelect: () => {
        handleBackToPrs();
        setWorkflowOpen(false);
      },
    },
  ];

  return (
    <CommandPalette
      emptyTitle="No settings destinations available"
      items={items}
      open={open}
      onOpenChange={setWorkflowOpen}
      placeholder="Jump between settings sections"
      query={workflowQuery}
      onQueryChange={setWorkflowQuery}
    />
  );
}

export { SettingsWorkflowPalette };
export type { SettingsCommandPalettesProps };
