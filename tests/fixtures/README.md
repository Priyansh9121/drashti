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
