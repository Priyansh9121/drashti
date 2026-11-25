// The editor's notes on an imported original, in Main's own plain words (never a file's path).
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';

/** The notes said, each once, none blank. */
export const sourceNotes = (issues: readonly string[]): string[] => [
  ...new Set(issues.filter((issue) => issue.trim().length > 0)),
];

export function SourceIssues({
  issues,
  onLink,
  blocked,
  className = 'm-2',
}: {
  issues: readonly string[];
  onLink?: () => void;
  blocked?: boolean;
  /** Where it sits: above the slides (as it always has), or over the slide in a short window (a22-ribbonfold). */
  className?: string;
}) {
  const unique = sourceNotes(issues);
  if (unique.length === 0) return null;
  return (
    <Notice
      tone="warning"
      title="Source document limits"
      className={className}
      data-testid="editor-source-issues"
    >
      <p>Read these notes before you change the original’s words and shapes.</p>
      <ul className="max-h-28 list-disc space-y-1 overflow-y-auto pl-5">
        {unique.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
      {onLink && (
        <Button size="sm" className="mt-2" disabled={blocked} onClick={onLink}>
          Link source page…
        </Button>
      )}
    </Notice>
  );
}
