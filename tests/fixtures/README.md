# Test fixtures

Everything here was written for Drashti's tests. The lyrics are placeholder
text, not kirtan or scripture. Real files from the mandir machines never go
in this repository (they belong in `migration-samples/`, outside it).

`media/placeholder.heic` is a 64 × 48 picture of one flat colour, generated with
FFmpeg and saved as HEIC with macOS `sips` (FFmpeg cannot write HEIC), for the
conversion tests on every platform. It holds no camera, place or date details.

`half-forms.txt` holds Devanagari and Gujarati letters joined into half-forms with ZWJ and ZWNJ, as
characters, so `scripts/unicode-check.mjs` is seen to pass them (Sessions 31–36, I18N-3).

`decks/placeholder-keynote-copy.pptx` is the PowerPoint copy that Keynote 14.4 wrote of a three-slide
deck our tests generate (placeholder words and notes, flat colours, one shape, no pictures), kept byte
for byte so the editable reader is tested against the way Keynote writes text boxes and lines
(Session 57's Keynote round trip). Its document details are empty.

`captions/` holds generated speech for the captions bench (scripts/captions-bench.mjs, the Performance workflow's
`captions` input): 48 short clips of 12 placeholder sentences, in Gujarati and Hindi, each by two synthetic voices
(Indic Tiny TTS, CC-BY-4.0), 16 kHz mono WAV, about 5 MB. Nobody real speaks them; `captions/CREDITS.md` names the
voices, their training data and licences, and `captions/manifest.json` each clip's words, voice, seed and SHA-256.
English is spoken by CI's Windows runner at run time and never stored.

`translation/indictrans-python.json` is what x74's Python translation pipeline (IndicTransToolkit 1.1.1 with the
original indic-nlp-library 0.92, the IndicTrans2 models' tokenizer decode and the trial's clock-spacing repair)
gave for generated inputs: x74's placeholder sentences and words, and random characters. It holds no model and no
real text; every character above ASCII is written as `\uXXXX`. The Translation… engine's port is checked against it.
