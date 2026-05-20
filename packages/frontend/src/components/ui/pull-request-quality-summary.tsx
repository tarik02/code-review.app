import type { PullRequestQualityFinding, PullRequestQualityReport } from '../../types/forge';
import { cx } from '../../lib/cx';

type PullRequestQualitySummaryProps = {
  report: PullRequestQualityReport | null;
  isLoading: boolean;
  error: string;
  displayedInlineCount: number;
  displayedFileCount: number;
  unmappedFindings: PullRequestQualityFinding[];
};

function statusTone(status: PullRequestQualityReport['status'] | 'loading') {
  switch (status) {
    case 'ok':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'warning':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
    case 'failed':
      return 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300';
    case 'pending':
      return 'bg-canvas text-ink-700';
    case 'unavailable':
      return 'bg-canvas text-ink-600';
    case 'loading':
      return 'bg-canvas text-ink-600';
  }
}

function statusLabel(status: PullRequestQualityReport['status'] | 'loading') {
  switch (status) {
    case 'ok':
      return 'No issues';
    case 'warning':
      return 'Issues found';
    case 'failed':
      return 'Checks failed';
    case 'pending':
      return 'Processing';
    case 'unavailable':
      return 'Unavailable';
    case 'loading':
      return 'Loading';
  }
}

function PullRequestQualitySummary({
  report,
  isLoading,
  error,
  displayedInlineCount,
  displayedFileCount,
  unmappedFindings,
}: PullRequestQualitySummaryProps) {
  if (isLoading) {
    return (
      <div className="text-sm text-ink-500">
        Loading checks and code quality...
      </div>
    );
  }

  if (error && !report) {
    return <div className="text-sm text-danger-600">{error}</div>;
  }

  if (!report) {
    return null;
  }

  const notes = report.summary.notes ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink-900">{report.summary.providerLabel}</span>
        <span
          className={cx('rounded-full px-2 py-0.5 text-xs font-medium', statusTone(report.status))}
        >
          {statusLabel(report.status)}
        </span>
        <span className="text-xs text-ink-500">{report.summary.totalFindings} total</span>
        <span className="text-xs text-ink-500">{displayedInlineCount} inline</span>
        <span className="text-xs text-ink-500">{displayedFileCount} file-level</span>
        {unmappedFindings.length > 0 ? (
          <span className="text-xs text-ink-500">{unmappedFindings.length} unmapped</span>
        ) : null}
        {report.summary.detailsUrl ? (
          <a
            className="text-xs font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
            href={report.summary.detailsUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open provider report
          </a>
        ) : null}
      </div>

      {notes.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1 text-xs text-ink-500">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}

      {unmappedFindings.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-ink-200 pt-3">
          <p className="text-xs font-medium text-ink-700">Unmapped findings</p>
          <div className="flex flex-col gap-2">
            {unmappedFindings.slice(0, 5).map((finding) => (
              <div
                className="rounded-md border border-ink-200 bg-canvas px-3 py-2 text-xs"
                key={finding.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-900">{finding.title}</span>
                  <span className="text-ink-500">{finding.sourceName}</span>
                </div>
                <p className="mt-1 text-ink-600">{finding.path || 'No file path provided'}</p>
              </div>
            ))}
            {unmappedFindings.length > 5 ? (
              <p className="text-xs text-ink-500">
                {unmappedFindings.length - 5} more unmapped findings not shown.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { PullRequestQualitySummary };
export type { PullRequestQualitySummaryProps };
