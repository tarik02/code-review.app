import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '../../components/ui/field';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { reviewEditorSettingsQueryOptions, setReviewEditorSettings } from '../../queries/forge';
import type { ReviewEditorMode, ReviewEditorSettings } from '../../types/forge';

const reviewEditorModeOptions: { value: ReviewEditorMode; label: string }[] = [
  { value: 'rich-text', label: 'Rich text' },
  { value: 'source', label: 'Source' },
];

const reviewEditorModeDescriptions: Record<ReviewEditorMode, string> = {
  'rich-text': 'Start with formatting controls visible.',
  source: 'Start in plain Markdown source.',
};

function ReviewRoute() {
  const queryClient = useQueryClient();
  const reviewEditorSettingsOptions = reviewEditorSettingsQueryOptions();
  const reviewEditorSettingsQuery = useQuery(reviewEditorSettingsOptions);
  const reviewEditorSettingsQueryKey = reviewEditorSettingsOptions.queryKey;
  const fallbackReviewEditorSettings = {
    defaultMode: 'rich-text',
    floatingControls: false,
  } satisfies ReviewEditorSettings;
  const reviewEditorSettings = reviewEditorSettingsQuery.data ?? fallbackReviewEditorSettings;
  const reviewEditorSettingsMutation = useMutation({
    mutationFn: setReviewEditorSettings,
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: reviewEditorSettingsQueryKey,
      });
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(reviewEditorSettingsQueryKey, settings);
    },
  });
  const defaultMode = reviewEditorSettings.defaultMode;
  const error = reviewEditorSettingsMutation.error ?? reviewEditorSettingsQuery.error;
  const isSaving = reviewEditorSettingsMutation.isPending;

  function updateReviewEditorSettings(settings: Partial<ReviewEditorSettings>) {
    reviewEditorSettingsMutation.mutate({
      ...reviewEditorSettings,
      ...settings,
    });
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-8">
      <div>
        <h2 className="text-xl font-semibold text-ink-900">Review</h2>
        <p className="mt-1 text-sm text-ink-500">Manage review comment preferences.</p>
      </div>

      <section className="rounded-md border border-neutral-200 bg-surface p-4 dark:border-neutral-700">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Review editor</h3>
            <p className="mt-1 text-sm text-ink-500">
              Choose the starting mode for new comment editors.
            </p>
          </div>
          <RadioGroup<ReviewEditorMode>
            className="h-fit max-w-sm self-start md:justify-self-end"
            disabled={isSaving}
            value={defaultMode}
            onValueChange={(mode) => {
              if (mode !== defaultMode) {
                updateReviewEditorSettings({ defaultMode: mode });
              }
            }}
          >
            {reviewEditorModeOptions.map((option) => {
              const isSelected = defaultMode === option.value;
              const id = `review-editor-${option.value}`;
              return (
                <FieldLabel
                  className={isSaving ? 'cursor-not-allowed opacity-60' : ''}
                  htmlFor={id}
                  key={option.value}
                >
                  <Field
                    className={[
                      'min-h-20',
                      isSaving ? '' : 'hover:bg-canvasDark',
                      isSelected ? 'border-ink-900 dark:border-ink-200' : '',
                    ].join(' ')}
                    orientation="horizontal"
                  >
                    <FieldContent>
                      <FieldTitle>{option.label}</FieldTitle>
                      <FieldDescription>
                        {reviewEditorModeDescriptions[option.value]}
                      </FieldDescription>
                    </FieldContent>
                    <RadioGroupItem value={option.value} id={id} />
                  </Field>
                </FieldLabel>
              );
            })}
          </RadioGroup>
        </div>

        <div className="mt-4 grid gap-3 border-t border-ink-200 pt-4 md:grid-cols-[minmax(0,1fr)_240px] md:items-start">
          <div>
            <h4 className="text-sm font-semibold text-ink-900">Floating controls</h4>
            <p className="mt-1 text-sm text-ink-500">
              Show editor toolbar and submit actions as hover/focus overlays.
            </p>
          </div>
          <ToggleGroup<'off' | 'on'>
            className="grid w-full grid-cols-2 bg-canvasDark md:justify-self-end"
            disabled={isSaving}
            value={[reviewEditorSettings.floatingControls ? 'on' : 'off']}
            onValueChange={(nextValue) => {
              const floatingControlsValue = nextValue[0];
              if (!floatingControlsValue) {
                return;
              }

              updateReviewEditorSettings({
                floatingControls: floatingControlsValue === 'on',
              });
            }}
          >
            <ToggleGroupItem value="off">Off</ToggleGroupItem>
            <ToggleGroupItem value="on">On</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {error ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger-600 dark:border-red-900/40 dark:bg-red-950/30">
            {error.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export const Route = createFileRoute('/settings/review')({
  component: ReviewRoute,
});
