// Intended destination: src/renderer/src/editor/SourceIssues.tsx.
// External draft. Main supplies sanitized explanations, never source paths.
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';

export function SourceIssues({
  issues,
  onLink,
  blocked,
}: {
  issues: readonly string[];
  onLink?: () => void;
  blocked?: boolean;
}) {
  const unique = [...new Set(issues.filter((issue) => issue.trim().length > 0))];
  if (unique.length === 0) return null;
  return (
    <Notice tone="warning" title="Source document limits" className="m-2" data-testid="editor-source-issues">
      <p>Review these limits before changing the source objects.</p>
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
