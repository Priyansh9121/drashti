import { useEffect, useState } from 'react';
import type { Lang } from '../../../shared/model';
import { LANGS } from '../../../shared/model';
import type { ShastraTextInfo } from '../../../shared/shastra';
import type { Theme } from '../../../shared/themes';
import { LANG_NAMES, LANG_SHORT } from '../../../shared/themes';
import { importWithDialog } from '../library/import-store';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Select } from '../ui/Field';
import { BookOpen, Trash2, Upload } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { EmptyState } from '../ui/States';
import { plural } from '../ui/text';
import { loadTexts, openTexts, useShastra } from './shastra-store';

/*
 * The loaded Shastra texts (Pro Mode; roles come in Session 14): load one
 * (a file an admin prepares from a source BAPS or the mandir has authorised,
 * docs/shastra-format.md), choose the theme each text's passages are drawn
 * with, or remove one.
 */

function Languages({ text }: { text: ShastraTextInfo }) {
  return (
    <span className="flex flex-wrap gap-1">
      {LANGS.filter((l) => (text.languages[l] ?? 0) > 0).map((l: Lang) => (
        <Badge key={l} title={`${LANG_NAMES[l]}: ${plural(text.languages[l] ?? 0, 'item')}`}>
          {LANG_SHORT[l]}
        </Badge>
      ))}
    </span>
  );
}

export function TextsDialog() {
  const open = useShastra((s) => s.textsOpen);
  const texts = useShastra((s) => s.texts);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ShastraTextInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    void window.drashti.themes.list().then((r) => {
      setThemes(r.themes);
    });
  }, [open]);

  if (!open) return null;
  const close = () => {
    openTexts(false);
    setProblem(null);
  };

  return (
    <Dialog
      title="Shastra texts"
      subtitle="Load only texts that BAPS or the mandir has authorised. Each text's passages are drawn with its theme."
      onClose={close}
      closeLabel="Close Shastra texts"
      size="lg"
      testId="shastra-texts-dialog"
      headerActions={
        <Button icon={Upload} data-testid="load-shastra-text" onClick={() => void importWithDialog('files')}>
          Load a text…
        </Button>
      }
    >
      {problem && (
        <Notice tone="warning" compact className="mb-3" onDismiss={() => setProblem(null)}>
          {problem}
        </Notice>
      )}
      {texts.length === 0 ? (
        <EmptyState icon={BookOpen} title="No texts loaded">
          Load a text with Load a text…, or drag its file onto the library. The file format is in Drashti's
          guide (docs/shastra-format.md).
        </EmptyState>
      ) : (
        <table className="w-full text-sm" data-testid="shastra-texts-table">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 font-medium">Text</th>
              <th className="font-medium">Items</th>
              <th className="font-medium">Languages</th>
              <th className="font-medium">Theme</th>
              <th className="font-medium">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {texts.map((t) => (
              <tr key={t.id} data-testid="shastra-text-row" className="border-t border-line align-top">
                <td className="py-2 pr-3">
                  <span className="block font-medium">{t.name}</span>
                  <span className="block text-xs text-muted">
                    Type “{t.abbreviation}”{t.sectionCount > 0 ? ', a section' : ''} and a number · loaded{' '}
                    {new Date(t.loadedAt).toLocaleDateString()}
                  </span>
                </td>
                <td className="py-2 pr-3 text-muted tabular-nums">
                  {t.itemCount}
                  {t.sectionCount > 0 && (
                    <span className="block text-xs">{plural(t.sectionCount, 'section')}</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <Languages text={t} />
                </td>
                <td className="py-2 pr-3">
                  <Select
                    aria-label={`Theme for ${t.name}`}
                    data-testid="shastra-text-theme"
                    value={t.themeId ?? ''}
                    onChange={(e) => {
                      const themeId = e.target.value === '' ? null : e.target.value;
                      void window.drashti.shastra.setTheme(t.id, themeId).then((r) => {
                        if (r.ok) useShastra.setState({ texts: r.texts });
                        else setProblem(r.message);
                      });
                    }}
                  >
                    <option value="">Drashti default</option>
                    {themes.map((th) => (
                      <option key={th.id} value={th.id}>
                        {th.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-2 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    aria-label={`Remove ${t.name}`}
                    onClick={() => {
                      setRemoving(t);
                    }}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {removing && (
        <Dialog
          title={`Remove ${removing.name}?`}
          role="alertdialog"
          size="sm"
          onClose={() => {
            setRemoving(null);
          }}
          closeButton={false}
          testId="shastra-remove-confirm"
          footer={
            <>
              <Button
                data-autofocus
                onClick={() => {
                  setRemoving(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const text = removing;
                  setRemoving(null);
                  void window.drashti.shastra.remove(text.id).then((r) => {
                    if (r.ok) useShastra.setState({ texts: r.texts });
                    else setProblem(r.message);
                    void loadTexts();
                  });
                }}
              >
                Remove
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            Its {plural(removing.itemCount, 'item')} leave the library. Playlists that name its passages show
            them as missing until the text is loaded again.
          </p>
        </Dialog>
      )}
    </Dialog>
  );
}
