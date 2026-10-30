import { useState } from 'react';
import { create } from 'zustand';
import { QrCode } from '../network/QrCode';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Textarea } from '../ui/Field';
import { clickPresentation, loadLibrary } from './library-store';

/*
 * New › QR code… (Session 55, Part 8, the owner's idea G): paste a link or type words, see the code with the words
 * under it as the slide will have them, and Make the slide: one slide in the library, chosen there, so one click on
 * its row puts it up. Made offline by the main process (main/library/qr-slide.ts). Pro Mode's (Simple Mode refuses it).
 */

/** At most this many letters (the main process says the same): a longer code is too dense to read across a hall. */
const MAX = 300;

const useQrSlide = create<{ open: boolean }>(() => ({ open: false }));

export function openQrSlide(): void {
  useQrSlide.setState({ open: true });
}

function close(): void {
  useQrSlide.setState({ open: false });
}

function QrSlideForm() {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const words = text.trim();
  const make = async () => {
    if (words === '' || making) return;
    setMaking(true);
    setProblem(null);
    const result = await window.drashti.library.newQrSlide(words);
    if (!result.ok) {
      setMaking(false);
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
      subtitle="A slide with a large code of a link or words, and the words under it"
      onClose={close}
      testId="qr-dialog"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={words === '' || words.length > MAX || making}
            onClick={() => void make()}
          >
            Make the slide
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field
          label="Link or words"
          hint={`A web link, or words up to ${String(MAX)} letters. The code is made on this computer: no internet is needed.`}
          error={
            problem ??
            (words.length > MAX ? `That is ${String(words.length)} letters: ${String(MAX)} at most.` : null)
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
        {words !== '' && words.length <= MAX && (
          <figure className="flex flex-col items-center gap-2 rounded-lg bg-black/40 p-3">
            <QrCode text={words} label={`The QR code of ${words}`} size={180} />
            <figcaption className="max-w-full text-center text-sm break-words" data-testid="qr-words">
              {words}
            </figcaption>
          </figure>
        )}
      </div>
    </Dialog>
  );
}

/** Mounted once in Pro Mode's window; the form starts empty each time it opens. */
export function QrSlideDialog() {
  const open = useQrSlide((s) => s.open);
  return open ? <QrSlideForm /> : null;
}
