import { create } from 'zustand';

type CommandPaletteStore = {
  browseOpen: boolean;
  contentOpen: boolean;
  workflowOpen: boolean;
  closeAll(): void;
  openBrowse(): void;
  openContent(): void;
  openWorkflow(): void;
  setBrowseOpen(open: boolean): void;
  setContentOpen(open: boolean): void;
  setWorkflowOpen(open: boolean): void;
};

function withExclusiveOpenState(next: Partial<Pick<CommandPaletteStore, 'browseOpen' | 'contentOpen' | 'workflowOpen'>>) {
  return {
    browseOpen: false,
    contentOpen: false,
    workflowOpen: false,
    ...next,
  };
}

const useCommandPaletteStore = create<CommandPaletteStore>()((set) => ({
  browseOpen: false,
  contentOpen: false,
  workflowOpen: false,
  closeAll() {
    set(withExclusiveOpenState({}));
  },
  openBrowse() {
    set(withExclusiveOpenState({ browseOpen: true }));
  },
  openContent() {
    set(withExclusiveOpenState({ contentOpen: true }));
  },
  openWorkflow() {
    set(withExclusiveOpenState({ workflowOpen: true }));
  },
  setBrowseOpen(open) {
    set(open ? withExclusiveOpenState({ browseOpen: true }) : { browseOpen: false });
  },
  setContentOpen(open) {
    set(open ? withExclusiveOpenState({ contentOpen: true }) : { contentOpen: false });
  },
  setWorkflowOpen(open) {
    set(open ? withExclusiveOpenState({ workflowOpen: true }) : { workflowOpen: false });
  },
}));

export { useCommandPaletteStore };
