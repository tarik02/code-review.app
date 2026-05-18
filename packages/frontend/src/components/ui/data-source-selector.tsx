import { create } from 'zustand';
import { PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import type {
  NamespaceSummary,
  ProviderAccount,
  PullRequestDataSource,
  PullRequestDataSourcesSettings,
  PullRequestDataSourceSort,
  PullRequestDataSourceStatus,
  RepoSummary,
} from '../../types/forge';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Combobox } from './combobox';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { Input } from './input';
import { ScrollArea } from './scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

const STATUS_OPTIONS: Array<{
  value: PullRequestDataSourceStatus;
  label: string;
}> = [
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Draft' },
  { value: 'closed', label: 'Closed' },
  { value: 'merged', label: 'Merged' },
];

const RESOURCE_KIND_LABELS = {
  account: 'Account',
  namespace: 'Group/org',
  repo: 'Repository/project',
} as const;

const SORT_OPTIONS: Array<{ value: PullRequestDataSourceSort; label: string }> = [
  { value: 'updated_desc', label: 'Updated newest' },
  { value: 'updated_asc', label: 'Updated oldest' },
  { value: 'created_desc', label: 'Created newest' },
  { value: 'created_asc', label: 'Created oldest' },
];

const RESOURCE_SEARCH_DEBOUNCE_MS = 200;

type DataSourceSelectorProps = {
  accounts: ProviderAccount[];
  settings: PullRequestDataSourcesSettings;
  activeDataSource: PullRequestDataSource | null;
  disabled?: boolean;
  onSettingsChange: (settings: PullRequestDataSourcesSettings) => void | Promise<void>;
};

type DataSourceSelectorStore = {
  draft: PullRequestDataSource | null;
  isEditorOpen: boolean;
  namespaceRows: NamespaceSummary[];
  repoRows: RepoSummary[];
  resourceQuery: string;
  closeEditor(): void;
  openEditor(draft: PullRequestDataSource, resourceQuery: string): void;
  setDraft(draft: PullRequestDataSource | null): void;
  setEditorOpen(open: boolean): void;
  setResourceQuery(query: string): void;
  setResourceRows(rows: { namespaces?: NamespaceSummary[]; repos?: RepoSummary[] }): void;
};

function resourceSearchInputKey(state: DataSourceSelectorStore) {
  const draft = state.draft;
  const kind = draft?.resource.kind ?? 'account';
  return JSON.stringify({
    open: state.isEditorOpen,
    accountId: draft?.accountId ?? null,
    kind,
    query: state.resourceQuery,
  });
}

const useDataSourceSelectorStore = create<DataSourceSelectorStore>()((set, get) => {
  let resourceSearchKey = '';
  let resourceSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  let resourceSearchRun = 0;

  function clearResourceSearchTimeout() {
    if (resourceSearchTimeout) {
      clearTimeout(resourceSearchTimeout);
      resourceSearchTimeout = null;
    }
  }

  function setResourceRows(rows: { namespaces?: NamespaceSummary[]; repos?: RepoSummary[] }) {
    set((state) => ({
      namespaceRows: rows.namespaces ?? state.namespaceRows,
      repoRows: rows.repos ?? state.repoRows,
    }));
  }

  function startResourceSearch() {
    const state = get();
    const draft = state.draft;
    const kind = draft?.resource.kind ?? 'account';
    const key = resourceSearchInputKey(state);
    if (!state.isEditorOpen || !draft || kind === 'account') {
      resourceSearchKey = key;
      clearResourceSearchTimeout();
      if (state.namespaceRows.length > 0 || state.repoRows.length > 0) {
        setResourceRows({ namespaces: [], repos: [] });
      }
      return;
    }
    if (key === resourceSearchKey) return;

    resourceSearchKey = key;
    clearResourceSearchTimeout();
    const runId = ++resourceSearchRun;
    resourceSearchTimeout = setTimeout(() => {
      const nextState = get();
      const nextDraft = nextState.draft;
      const nextKind = nextDraft?.resource.kind ?? 'account';
      const nextKey = resourceSearchInputKey(nextState);
      if (!nextState.isEditorOpen || !nextDraft || nextKind === 'account') return;

      const query = nextState.resourceQuery;
      const search =
        nextKind === 'namespace'
          ? trpc.repos.searchNamespaces.query({
              accountId: nextDraft.accountId,
              query,
              limit: 20,
            })
          : trpc.repos.search.query({
              accountId: nextDraft.accountId,
              query,
              limit: 20,
            });

      void search
        .then((rows) => {
          if (runId !== resourceSearchRun || resourceSearchInputKey(get()) !== nextKey) {
            return;
          }
          if (nextKind === 'namespace') {
            setResourceRows({
              namespaces: rows as NamespaceSummary[],
              repos: [],
            });
            return;
          }
          setResourceRows({
            namespaces: [],
            repos: rows as RepoSummary[],
          });
        })
        .catch(() => {
          if (runId === resourceSearchRun && resourceSearchInputKey(get()) === nextKey) {
            setResourceRows({ namespaces: [], repos: [] });
          }
        });
    }, RESOURCE_SEARCH_DEBOUNCE_MS);
  }

  return {
    draft: null,
    isEditorOpen: false,
    namespaceRows: [],
    repoRows: [],
    resourceQuery: '',
    closeEditor() {
      set({
        draft: null,
        isEditorOpen: false,
        namespaceRows: [],
        repoRows: [],
        resourceQuery: '',
      });
      startResourceSearch();
    },
    openEditor(draft, resourceQuery) {
      set({
        draft,
        isEditorOpen: true,
        resourceQuery,
      });
      startResourceSearch();
    },
    setDraft(draft) {
      set({ draft });
      startResourceSearch();
    },
    setEditorOpen(open) {
      set(() =>
        open
          ? { isEditorOpen: true }
          : {
              draft: null,
              isEditorOpen: false,
              namespaceRows: [],
              repoRows: [],
              resourceQuery: '',
            },
      );
      startResourceSearch();
    },
    setResourceQuery(query) {
      set({ resourceQuery: query });
      startResourceSearch();
    },
    setResourceRows,
  };
});

function dataSourceLabel(source: PullRequestDataSource, accounts: ProviderAccount[]) {
  const name = source.name?.trim();
  if (name) return name;

  const account = accounts.find((entry) => entry.id === source.accountId);
  const accountLabel = account ? providerAccountLabel(account) : source.accountId;
  if (source.resource.kind === 'account') return `${accountLabel} / involving me`;
  if (source.resource.kind === 'namespace') return `${accountLabel} / ${source.resource.path}`;
  return `${accountLabel} / ${source.resource.repo.nameWithOwner}`;
}

function providerAccountLabel(account: ProviderAccount) {
  if (account.viewerLogin) return `${account.viewerLogin} @ ${account.host}`;
  return account.label === account.id ? `${account.provider} @ ${account.host}` : account.label;
}

function createDefaultSource(accountId: string): PullRequestDataSource {
  return {
    id: `source:${Date.now()}`,
    accountId,
    resource: { kind: 'account' },
    statuses: ['open', 'draft'],
    sortBy: 'updated_desc',
    groupByProject: true,
  };
}

function DataSourceSelector({
  accounts,
  settings,
  activeDataSource,
  disabled,
  onSettingsChange,
}: DataSourceSelectorProps) {
  const openEditor = useDataSourceSelectorStore((state) => state.openEditor);

  function openCreateEditor() {
    const accountId = accounts[0]?.id;
    if (!accountId) return;
    openEditor(createDefaultSource(accountId), '');
  }

  function openEditEditor(source: PullRequestDataSource) {
    openEditor(
      source,
      source.resource.kind === 'namespace'
        ? source.resource.path
        : source.resource.kind === 'repo'
          ? source.resource.repo.nameWithOwner
          : '',
    );
  }

  async function selectActive(id: string | null) {
    await onSettingsChange({ ...settings, activeDataSourceId: id });
  }

  const activeLabel = activeDataSource
    ? dataSourceLabel(activeDataSource, accounts)
    : 'Create a data source';

  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <Select
          disabled={disabled || settings.sources.length === 0}
          value={settings.activeDataSourceId ?? ''}
          onValueChange={(value) => void selectActive(value || null)}
        >
          <SelectTrigger className="min-w-0 flex-1 bg-surface text-xs" size="sm">
            <SelectValue>{activeLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {settings.sources.map((source) => (
              <SelectItem key={source.id} value={source.id}>
                {dataSourceLabel(source, accounts)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          aria-label="Edit data source"
          disabled={!activeDataSource}
          onClick={() => activeDataSource && openEditEditor(activeDataSource)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <PencilIcon />
        </Button>
        <Button
          aria-label="Add data source"
          disabled={accounts.length === 0}
          onClick={openCreateEditor}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <PlusIcon />
        </Button>
      </div>

      <DataSourceEditorDialog
        accounts={accounts}
        onSettingsChange={onSettingsChange}
        settings={settings}
      />
    </>
  );
}

function DataSourceEditorDialog({
  accounts,
  settings,
  onSettingsChange,
}: Pick<DataSourceSelectorProps, 'accounts' | 'settings' | 'onSettingsChange'>) {
  const closeEditor = useDataSourceSelectorStore((state) => state.closeEditor);
  const draft = useDataSourceSelectorStore((state) => state.draft);
  const isEditorOpen = useDataSourceSelectorStore((state) => state.isEditorOpen);
  const namespaceRows = useDataSourceSelectorStore((state) => state.namespaceRows);
  const repoRows = useDataSourceSelectorStore((state) => state.repoRows);
  const resourceQuery = useDataSourceSelectorStore((state) => state.resourceQuery);
  const setDraft = useDataSourceSelectorStore((state) => state.setDraft);
  const setEditorOpen = useDataSourceSelectorStore((state) => state.setEditorOpen);
  const setResourceQuery = useDataSourceSelectorStore((state) => state.setResourceQuery);
  const selectedAccount = accounts.find((account) => account.id === draft?.accountId) ?? null;
  const resourceKind = draft?.resource.kind ?? 'account';
  const canDelete = settings.sources.length > 1 && draft !== null;
  const namespaceOptions = namespaceRows.map((namespace) => ({
    label: namespace.path,
    value: `${namespace.kind}:${namespace.path}`,
  }));
  const repoOptions = repoRows.map((repo) => ({
    label: repo.nameWithOwner,
    value: repo.repoKey,
  }));

  async function saveDraft() {
    if (!draft || draft.statuses.length === 0) return;
    const exists = settings.sources.some((source) => source.id === draft.id);
    const sources = exists
      ? settings.sources.map((source) => (source.id === draft.id ? draft : source))
      : [...settings.sources, draft];
    await onSettingsChange({
      activeDataSourceId: draft.id,
      sources,
    });
    closeEditor();
  }

  async function deleteDraft() {
    if (!draft || !canDelete) return;
    const sources = settings.sources.filter((source) => source.id !== draft.id);
    await onSettingsChange({
      activeDataSourceId:
        settings.activeDataSourceId === draft.id
          ? (sources[0]?.id ?? null)
          : settings.activeDataSourceId,
      sources,
    });
    closeEditor();
  }

  return (
    <Dialog open={isEditorOpen} onOpenChange={setEditorOpen}>
      <DialogContent className="w-full max-w-lg overflow-hidden p-0">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <DialogTitle>Data source</DialogTitle>
          <Button
            aria-label="Close"
            onClick={closeEditor}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </div>

        {draft ? (
          <>
            <ScrollArea
              className="min-h-0 flex-1"
              contentClassName="grid gap-4 px-5 pb-4"
              orientation="vertical"
              viewportClassName="max-h-[min(62vh,32rem)]"
            >
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-medium text-ink-500">Name</span>
                <Input
                  placeholder="Generated from scope"
                  value={draft.name ?? ''}
                  onChange={(event) => {
                    const name = event.currentTarget.value;
                    setDraft({
                      ...draft,
                      name: name.trim().length > 0 ? name : undefined,
                    });
                  }}
                />
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-medium text-ink-500">Account</span>
                <Select
                  value={draft.accountId}
                  onValueChange={(accountId) => {
                    if (!accountId) return;
                    setDraft({
                      ...draft,
                      accountId,
                      resource: { kind: 'account' },
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {selectedAccount ? providerAccountLabel(selectedAccount) : draft.accountId}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {providerAccountLabel(account)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-medium text-ink-500">Resource</span>
                <Select
                  value={draft.resource.kind}
                  onValueChange={(kind) => {
                    setResourceQuery('');
                    setDraft({
                      ...draft,
                      resource:
                        kind === 'namespace'
                          ? {
                              kind: 'namespace',
                              path: '',
                              namespaceKind: 'namespace',
                            }
                          : kind === 'repo'
                            ? { kind: 'repo', repo: emptyRepo(draft.accountId) }
                            : { kind: 'account' },
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{RESOURCE_KIND_LABELS[draft.resource.kind]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="account">Account</SelectItem>
                    <SelectItem value="namespace">Group/org</SelectItem>
                    <SelectItem value="repo">Repository/project</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              {resourceKind === 'namespace' || resourceKind === 'repo' ? (
                <div className="grid gap-1.5 text-sm">
                  <span className="text-xs font-medium text-ink-500">
                    {resourceKind === 'namespace' ? 'Group/org' : 'Repository/project'}
                  </span>
                  <Combobox
                    className="h-8 w-full"
                    inputValue={resourceQuery}
                    options={resourceKind === 'namespace' ? namespaceOptions : repoOptions}
                    placeholder={
                      resourceKind === 'namespace' ? 'Search groups or orgs' : 'Search repositories'
                    }
                    value={
                      draft.resource.kind === 'namespace'
                        ? `${draft.resource.namespaceKind}:${draft.resource.path}`
                        : draft.resource.kind === 'repo'
                          ? draft.resource.repo.repoKey
                          : null
                    }
                    onInputValueChange={setResourceQuery}
                    onValueChange={(value) => {
                      if (!value) return;
                      if (resourceKind === 'namespace') {
                        const [namespaceKind, ...pathParts] = value.split(':');
                        setDraft({
                          ...draft,
                          resource: {
                            kind: 'namespace',
                            path: pathParts.join(':'),
                            namespaceKind:
                              namespaceKind === 'user' ||
                              namespaceKind === 'organization' ||
                              namespaceKind === 'group'
                                ? namespaceKind
                                : 'namespace',
                          },
                        });
                        setResourceQuery(pathParts.join(':'));
                        return;
                      }
                      const repo = repoRows.find((entry) => entry.repoKey === value);
                      if (repo) {
                        setDraft({
                          ...draft,
                          resource: { kind: 'repo', repo },
                        });
                        setResourceQuery(repo.nameWithOwner);
                      }
                    }}
                  />
                </div>
              ) : null}

              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-medium text-ink-500">Sort</span>
                <Select
                  value={draft.sortBy}
                  onValueChange={(sortBy) => {
                    setDraft({
                      ...draft,
                      sortBy: sortBy && isDataSourceSort(sortBy) ? sortBy : 'updated_desc',
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {SORT_OPTIONS.find((option) => option.value === draft.sortBy)?.label ??
                        'Updated newest'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <StatusMultiSelect
                statuses={draft.statuses}
                onStatusesChange={(statuses) => setDraft({ ...draft, statuses })}
              />

              <label className="inline-flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.groupByProject}
                  onCheckedChange={() =>
                    setDraft({
                      ...draft,
                      groupByProject: !draft.groupByProject,
                    })
                  }
                />
                Group by project
              </label>
            </ScrollArea>

            <div className="flex shrink-0 justify-between gap-2 border-t border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <Button
                disabled={!canDelete}
                onClick={() => void deleteDraft()}
                type="button"
                variant="destructive"
              >
                <Trash2Icon />
                Delete
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={closeEditor}>
                  Cancel
                </Button>
                <Button disabled={!isDraftSavable(draft)} onClick={() => void saveDraft()}>
                  Save
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StatusMultiSelect({
  statuses,
  onStatusesChange,
}: {
  statuses: PullRequestDataSourceStatus[];
  onStatusesChange(statuses: PullRequestDataSourceStatus[]): void;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-ink-500">Statuses</span>
      <Combobox
        className="h-8 w-full"
        filter={null}
        inputValue={statusSummary(statuses)}
        multiple
        options={STATUS_OPTIONS}
        value={statuses}
        onInputValueChange={() => undefined}
        onValueChange={(values) => onStatusesChange(values.filter(isDataSourceStatus))}
      />
    </div>
  );
}

function emptyRepo(accountId: string): RepoSummary {
  return {
    providerId: '',
    repoKey: '',
    provider: 'github',
    host: '',
    providerAccountId: accountId,
    providerAccountLabel: '',
    name: '',
    nameWithOwner: '',
    description: null,
    isPrivate: null,
    avatarUrl: null,
  };
}

function isDraftSavable(source: PullRequestDataSource) {
  if (source.statuses.length === 0) return false;
  if (source.resource.kind === 'namespace') return source.resource.path.trim().length > 0;
  if (source.resource.kind === 'repo') return source.resource.repo.repoKey.trim().length > 0;
  return true;
}

function isDataSourceSort(value: string): value is PullRequestDataSourceSort {
  return (
    value === 'updated_desc' ||
    value === 'updated_asc' ||
    value === 'created_desc' ||
    value === 'created_asc'
  );
}

function isDataSourceStatus(value: string): value is PullRequestDataSourceStatus {
  return value === 'open' || value === 'draft' || value === 'closed' || value === 'merged';
}

function statusSummary(statuses: PullRequestDataSourceStatus[]) {
  if (statuses.length === 0) return 'Select statuses';
  return STATUS_OPTIONS.filter((option) => statuses.includes(option.value))
    .map((option) => option.label)
    .join(', ');
}

export { DataSourceSelector, dataSourceLabel };
