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
import { getErrorMessage } from '../../hooks/use-forge-queries';
import { reviewEditorSettingsQueryOptions, setReviewEditorDefaultMode } from '../../queries/forge';
import type { ReviewEditorMode } from '../../types/forge';

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
  const reviewEditorModeMutation = useMutation({
    mutationFn: setReviewEditorDefaultMode,
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: reviewEditorSettingsQueryKey,
      });
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(reviewEditorSettingsQueryKey, settings);
    },
  });
  const defaultMode = reviewEditorSettingsQuery.data?.defaultMode ?? 'rich-text';
  const error = reviewEditorModeMutation.error ?? reviewEditorSettingsQuery.error;
  const isSaving = reviewEditorModeMutation.isPending;

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
                reviewEditorModeMutation.mutate(mode);
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

        {error ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger-600 dark:border-red-900/40 dark:bg-red-950/30">
            {getErrorMessage(error)}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export const Route = createFileRoute('/settings/review')({
  component: ReviewRoute,
});
