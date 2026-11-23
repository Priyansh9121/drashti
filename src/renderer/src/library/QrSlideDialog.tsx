import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { QrChoices } from '../../../shared/qr-picture';
import { QR_TEXT_MAX, qrPlan, qrSvg } from '../../../shared/qr-picture';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Textarea } from '../ui/Field';
import { Download, ImagePlus } from '../ui/icons';
import { Checkbox, Toggle } from '../ui/Toggle';
import { clickPresentation, loadLibrary } from './library-store';
import { logoCopy } from './qr-logo-copy';

/*
 * New › QR code… (Session 55, Part 8, the owner's idea G): paste a link or type words, see the code with the words
 * under it as the slide will have them, and Make the slide: one slide in the library, chosen there, so one click on
 * its row puts it up. Made offline by the main process (main/library/qr-slide.ts). Pro Mode's (Simple Mode refuses it).
 *
 * Since alpha.20 (Q60-28, the owner's words of 20 Nov 2026: "we also want to use a download QR code option here. the
 * QR code generated should consist of akshar deri logo, no text just logo, which can be used as well."):
 * - Logo in the middle: Choose a Picture… (the system's open dialog; a PNG or JPEG, such as the logo from the private
 *   opening pack or the setup kit) puts a picture in the middle of the code, on a small white patch; this window draws
 *   its copy (at most 1024 pixels a side) and Drashti keeps and remembers it (main/library/qr-service.ts).
 * - Download… saves the code (and the logo) as a PNG of about 2048 pixels and an SVG, no words, where the person
 *   chooses in the system's save dialog.
 * - Words under the code: the slide's words are a choice, remembered.
 * The preview is the very SVG Download… saves. Every picture is read back by a QR reader before it is saved or put on
 * a slide (main/library/qr-maker.ts), and made off Main's thread: nothing in this window touches the show.
 */

const MAX = QR_TEXT_MAX;
/** The preview's side, in pixels. */
const PREVIEW = 180;

const useQrSlide = create<{ open: boolean }>(() => ({ open: false }));

export function openQrSlide(): void {
  useQrSlide.setState({ open: true });
}

function close(): void {
  useQrSlide.setState({ open: false });
}

/** A file's name from its path (a Mac's or Windows'). */
const nameOf = (path: string): string => path.split(/[\\/]/u).pop() ?? path;

/** The code as the SVG Download… saves, for an <img>: the logo in it when one is given. */
function QrPreview({ words, logo }: { words: string; logo: string | null }) {
  const src = useMemo(() => {
    const plan = qrPlan(words, logo !== null);
    // The SVG holds only ASCII: its shapes and the logo's base64.
    return plan ? `data:image/svg+xml;base64,${btoa(qrSvg(plan, logo, PREVIEW))}` : null;
  }, [words, logo]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={`The QR code of ${words}`}
      width={PREVIEW}
      height={PREVIEW}
      className="rounded-md"
      data-testid="qr-code"
      data-logo={logo !== null ? 'true' : 'false'}
    />
  );
}

type Busy = 'logo' | 'download' | 'make' | null;

function QrSlideForm() {
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<QrChoices | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const words = text.trim();
  const fits = words !== '' && words.length <= MAX;
  const logo = choices?.logo ?? null;
  const useLogo = choices?.useLogo === true && logo !== null;
  const wordsUnder = choices?.wordsUnder !== false;

  useEffect(() => {
    let live = true;
    void window.drashti.library.qrChoices().then((got) => {
      if (live) setChoices(got);
    });
    return () => {
      live = false;
    };
  }, []);

  const change = async (wanted: { useLogo?: boolean; wordsUnder?: boolean }) => {
    // Shown at once, then as Drashti kept it.
    setChoices((c) => (c ? { ...c, ...wanted } : c));
    const kept = await window.drashti.library.setQrChoices(wanted);
    if (kept.ok) setChoices(kept.choices);
    else setProblem(kept.message);
  };

  const choose = async () => {
    if (busy) return;
    setBusy('logo');
    setProblem(null);
    setSaid('');
    try {
      const picked = await window.drashti.library.pickQrLogo();
      if (!picked.ok) {
        if ('message' in picked) setProblem(picked.message);
        return;
      }
      const png = await logoCopy(picked.bytes);
      if (!png) {
        setProblem(`“${picked.name}” could not be read as a picture: choose another.`);
        return;
      }
      const kept = await window.drashti.library.keepQrLogo(picked.name, png);
      if (kept.ok) setChoices(kept.choices);
      else setProblem(kept.message);
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!fits || busy) return;
    setBusy('download');
    setProblem(null);
    setSaid('');
    const saved = await window.drashti.library.downloadQr(words, { logo: useLogo });
    setBusy(null);
    if (saved.ok) setSaid(`Saved ${saved.files.map((f) => `“${nameOf(f)}”`).join(' and ')}.`);
    else if ('message' in saved) setProblem(saved.message);
  };

  const make = async () => {
    if (!fits || busy) return;
    setBusy('make');
    setProblem(null);
    setSaid('');
    const result = await window.drashti.library.newQrSlide(words, { logo: useLogo, words: wordsUnder });
    if (!result.ok) {
      setBusy(null);
      setProblem(result.message);
      return;
    }
    close();
    await loadLibrary();
    clickPresentation(result.id, { toggle: false, range: false });
  };

  return (
    <Dialog
      title="QR code"
      subtitle="A large code of a link or words: a slide, or a picture to save"
      onClose={close}
      testId="qr-dialog"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button icon={Download} disabled={!fits || busy !== null} onClick={() => void download()}>
            Download…
          </Button>
          <Button variant="primary" disabled={!fits || busy !== null} onClick={() => void make()}>
            Make the slide
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-3">
          <Field
            label="Link or words"
            hint={`A web link, or words up to ${String(MAX)} letters. The code is made on this computer: no internet is needed.`}
            error={
              words.length > MAX ? `That is ${String(words.length)} letters: ${String(MAX)} at most.` : null
            }
          >
            <Textarea
              rows={3}
              value={text}
              maxLength={2000}
              placeholder="https://"
              className="w-full resize-none"
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Toggle
                label="Logo in the middle"
                checked={useLogo}
                disabled={choices === null || busy !== null}
                onChange={(on) => {
                  if (on && !logo) void choose();
                  else void change({ useLogo: on });
                }}
              />
              <Button size="sm" icon={ImagePlus} disabled={busy !== null} onClick={() => void choose()}>
                Choose a Picture…
              </Button>
            </div>
            {logo ? (
              <p data-testid="qr-logo" className="flex min-w-0 items-center gap-2 text-xs text-muted">
                <img
                  src={logo.dataUrl}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded-sm bg-white object-contain"
                />
                <span className="min-w-0 truncate" title={logo.name}>
                  {logo.name}
                </span>
              </p>
            ) : (
              <p className="text-xs text-faint">
                A PNG or JPEG picture, such as the mandir’s logo, on a white patch.
              </p>
            )}
          </div>
          <Checkbox
            label="Words under the code (on the slide)"
            checked={wordsUnder}
            disabled={choices === null}
            onChange={(e) => void change({ wordsUnder: e.target.checked })}
          />
          <p className="text-xs text-faint">
            Download… saves the code{useLogo ? ' and the logo' : ''} as a PNG and an SVG picture, without
            words.
          </p>
          <p role="status" className="text-sm text-muted">
            {said}
          </p>
          {problem && (
            <p role="alert" className="text-sm text-danger-fg">
              {problem}
            </p>
          )}
        </div>
        {/* Dark enough under white words on any appearance's surface (axe's 4.5:1; black/40 left a mid-grey on light ones). */}
        <figure className="flex w-[204px] flex-col items-center gap-2 self-start rounded-lg bg-black/70 p-3">
          {fits ? (
            // With the words as they are typed (as before), so the code is there the moment they are.
            <QrPreview words={words} logo={useLogo ? logo.dataUrl : null} />
          ) : (
            <div
              aria-hidden="true"
              className="h-[180px] w-[180px] rounded-md border border-dashed border-line"
            />
          )}
          {/* The words whole, as the slide has them (shrunk to fit there; alpha.21's fit pass: a long link was cut
              after four lines here, and a link's unbroken words ran past the box). */}
          {fits && wordsUnder && (
            <figcaption
              className="max-w-full text-center text-sm [overflow-wrap:anywhere] text-white"
              data-testid="qr-words"
            >
              {words}
            </figcaption>
          )}
        </figure>
      </div>
    </Dialog>
  );
}

/** Mounted once in Pro Mode's window; the form starts empty each time it opens. */
export function QrSlideDialog() {
  const open = useQrSlide((s) => s.open);
  return open ? <QrSlideForm /> : null;
}
