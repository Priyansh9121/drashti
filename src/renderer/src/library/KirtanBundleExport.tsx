import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { KIRTAN_BUNDLE_LIMIT } from '../../../shared/kirtan-bundles';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Notice } from '../ui/Notice';
import { Checkbox } from '../ui/Toggle';
import { Download } from '../ui/icons';
import { useLibrary } from './library-store';

interface BundleExportView {
  open: boolean;
  busy: boolean;
  chosen: string[];
  includeMedia: boolean;
  notice: { message: string; tone: 'success' | 'warning' } | null;
}

// Kept while the Library sheet is shut: closing a box never loses an export's result.
const useBundleExport = create<BundleExportView>(() => ({
  open: false,
  busy: false,
  chosen: [],
  includeMedia: false,
  notice: null,
}));
const close = () => useBundleExport.setState({ open: false });
const open = () => useBundleExport.setState({ open: true, notice: null });

async function saveBundle(presentationIds: string[], includeMedia: boolean): Promise<void> {
  if (useBundleExport.getState().busy) return;
  useBundleExport.setState({ busy: true, chosen: presentationIds, includeMedia, notice: null });
  try {
    const result = await window.drashti.kirtans.exportBundle({ presentationIds, includeMedia });
    if (result.ok) {
      useBundleExport.setState({
        busy: false,
        open: false,
        notice: {
          tone: 'success',
          message: `Saved ${String(result.kirtans)} ${result.kirtans === 1 ? 'kirtan' : 'kirtans'} in a bundle.`,
        },
      });
    } else {
      useBundleExport.setState({
        busy: false,
        notice: result.cancelled ? null : { tone: 'warning', message: result.message },
      });
    }
  } catch {
    useBundleExport.setState({
      busy: false,
      notice: { tone: 'warning', message: 'The bundle could not be saved. Try again.' },
    });
  }
}

/** An explicit Library action; no file or media is shared until the operator chooses it. */
export function KirtanBundleButton() {
  const opened = useBundleExport((s) => s.open);
  return (
    <>
      <IconButton
        icon={Download}
        label="Export kirtan bundle…"
        size="sm"
        data-testid="kirtan-bundle-export"
        onClick={open}
      />
      {opened && <KirtanBundleForm />}
    </>
  );
}

export function KirtanBundleStatus() {
  const busy = useBundleExport((s) => s.busy);
  const opened = useBundleExport((s) => s.open);
  const notice = useBundleExport((s) => s.notice);
  if (opened) return null;
  if (busy)
    return (
      <Notice
        compact
        className="mx-3 mb-2 shrink-0"
        role="status"
        actions={
          <Button size="sm" variant="ghost" onClick={open}>
            Details…
          </Button>
        }
      >
        Saving kirtan bundle… Copies wait while on air or recording.
      </Notice>
    );
  return notice ? (
    <Notice
      compact
      tone={notice.tone}
      className="mx-3 mb-2 shrink-0"
      onDismiss={() => useBundleExport.setState({ notice: null })}
    >
      {notice.message}
    </Notice>
  ) : null;
}

function KirtanBundleForm() {
  const presentations = useLibrary((s) => s.presentations);
  const busy = useBundleExport((s) => s.busy);
  const notice = useBundleExport((s) => s.notice);
  const kirtans = useMemo(() => presentations.filter((p) => p.kirtanTracks !== null), [presentations]);
  const [selected, setSelected] = useState(() => {
    const view = useBundleExport.getState();
    const wanted = view.busy ? view.chosen : useLibrary.getState().marked;
    return new Set(wanted.filter((id) => kirtans.some((p) => p.id === id)));
  });
  const [query, setQuery] = useState('');
  const [includeMedia, setIncludeMedia] = useState(
    () => useBundleExport.getState().busy && useBundleExport.getState().includeMedia,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const matching = useMemo(() => {
    const words = query.trim().toLocaleLowerCase();
    return kirtans.filter((p) => p.name.toLocaleLowerCase().includes(words));
  }, [kirtans, query]);
  const shown = matching.slice(0, 200);
  const choose = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    if (on && next.size > KIRTAN_BUNDLE_LIMIT) {
      setProblem('Share up to 1,000 kirtans in one bundle.');
      return;
    }
    setProblem(null);
    setSelected(next);
  };
  return (
    <Dialog
      title="Export kirtan bundle"
      subtitle="Choose kirtans to share with another library"
      onClose={close}
      testId="kirtan-bundle-export-dialog"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          <Button
            variant="primary"
            disabled={busy || selected.size === 0 || selected.size > KIRTAN_BUNDLE_LIMIT}
            onClick={() => void saveBundle([...selected], includeMedia)}
          >
            {busy ? 'Saving…' : 'Save bundle…'}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Find kirtans
          <input
            type="search"
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 rounded-md border border-field bg-field px-3 py-2 font-normal text-fg"
          />
        </label>
        <div
          className="max-h-56 min-h-16 overflow-y-auto rounded-md border border-line p-2"
          role="group"
          aria-label="Kirtans to share"
        >
          {shown.map((p) => (
            <div key={p.id} className="flex min-w-0 flex-col gap-0.5 rounded px-1 py-1.5">
              <Checkbox
                label={<span className="break-words">{p.name}</span>}
                checked={selected.has(p.id)}
                disabled={busy}
                onChange={(e) => choose(p.id, e.target.checked)}
              />
              <span className="pl-6 text-xs text-muted">{p.libraryName}</span>
            </div>
          ))}
          {shown.length === 0 && (
            <p className="p-2 text-sm text-muted">
              {kirtans.length === 0
                ? 'There are no kirtans in this library yet.'
                : 'No kirtans match that name.'}
            </p>
          )}
        </div>
        {matching.length > shown.length && (
          <p className="text-xs text-muted">
            Showing the first 200 matches. Type more of the name to find a kirtan.
          </p>
        )}
        <p className="text-sm text-muted" role="status">
          {String(selected.size)} chosen
        </p>
        <Checkbox
          label="Include media files"
          checked={includeMedia}
          disabled={busy}
          onChange={(e) => setIncludeMedia(e.target.checked)}
        />
        <p className="text-xs text-muted">
          Pictures, videos and recordings used by these kirtans. Leave unticked to share words and slides
          alone.
        </p>
        {busy && (
          <Notice compact role="status">
            Saving bundle… Copies wait while the stream is on air or recording. You can close this box and
            keep running the show.
          </Notice>
        )}
        {problem && (
          <Notice compact tone="warning">
            {problem}
          </Notice>
        )}
        {notice && (
          <Notice compact tone={notice.tone}>
            {notice.message}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
