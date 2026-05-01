import { FileCode2Icon, PanelsTopLeftIcon, SearchIcon } from 'lucide-react';
import { useEnabledProviderAccounts } from '../hooks/use-enabled-provider-accounts';
import { useCommandPaletteStore } from './store';
import { Button } from '../components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';

type CommandPaletteLauncherScope = 'home' | 'settings';

type LauncherConfig = {
  id: string;
  icon: typeof FileCode2Icon;
  label: string;
  onClick: () => void;
  shortcut: string;
};

function CommandPaletteLaunchers({ scope }: { scope: CommandPaletteLauncherScope }) {
  const { enabledAccountIds } = useEnabledProviderAccounts();
  const openBrowse = useCommandPaletteStore((state) => state.openBrowse);
  const openContent = useCommandPaletteStore((state) => state.openContent);
  const openWorkflow = useCommandPaletteStore((state) => state.openWorkflow);

  const launchers: LauncherConfig[] =
    scope === 'home'
      ? [
          {
            id: 'content',
            icon: FileCode2Icon,
            label: 'PR files and comments',
            onClick: openContent,
            shortcut: 'Mod+P',
          },
          {
            id: 'workflow',
            icon: PanelsTopLeftIcon,
            label: 'Sections and actions',
            onClick: openWorkflow,
            shortcut: 'Mod+Shift+P',
          },
          {
            id: 'browse',
            icon: SearchIcon,
            label: 'Browse profiles, repos, and PRs',
            onClick: () => openBrowse(enabledAccountIds),
            shortcut: 'Mod+K',
          },
        ]
      : [
          {
            id: 'workflow',
            icon: PanelsTopLeftIcon,
            label: 'Settings sections and actions',
            onClick: openWorkflow,
            shortcut: 'Mod+Shift+P',
          },
          {
            id: 'browse',
            icon: SearchIcon,
            label: 'Browse profiles, repos, and PRs',
            onClick: () => openBrowse(enabledAccountIds),
            shortcut: 'Mod+K',
          },
        ];

  return (
    <TooltipProvider closeDelay={0} delay={350}>
      <div className="flex items-center gap-1.5">
        {launchers.map((launcher) => {
          const Icon = launcher.icon;

          return (
            <Tooltip key={launcher.id}>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`${launcher.label} (${launcher.shortcut})`}
                    className="text-ink-500 hover:bg-canvasDark hover:text-ink-900"
                    onClick={launcher.onClick}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Icon className="size-4" />
                  </Button>
                }
              />
              <TooltipContent>
                <div className="flex items-center gap-2">
                  <span>{launcher.label}</span>
                  <span className="text-ink-500">{launcher.shortcut}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

export { CommandPaletteLaunchers };
export type { CommandPaletteLauncherScope };
