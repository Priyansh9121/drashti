import { editablePptxFixture, slideXml, wordsShape } from './editable-pptx-fixture';

export function deckWithOldFonts(): Buffer {
  const text =
    '<a:p><a:r><a:rPr><a:latin typeface="Kruti Dev 010"/><a:cs typeface="kruti dev 010"/></a:rPr><a:t>Placeholder words</a:t></a:r></a:p>';
  const theme =
    '<d:theme xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/main"><d:themeElements><d:fontScheme name="Placeholder"><d:majorFont><d:latin typeface="Arial"/><d:font script="Gujr" typeface="Gopika"/></d:majorFont></d:fontScheme></d:themeElements></d:theme>';
  return editablePptxFixture({
    slides: [slideXml(wordsShape(text))],
    parts: { 'ppt/theme/theme1.xml': theme },
  });
}
