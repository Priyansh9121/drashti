import { writeFile } from 'node:fs/promises';
import { readZipEntries } from '../zip';
import { makeZip } from './zip-writer';

export async function addTestPptxShadow(file: string): Promise<void> {
  const parts = await readZipEntries(file, () => true);
  const slidePart = 'ppt/slides/slide1.xml';
  const slide = parts.get(slidePart);
  if (!slide) throw new Error('The fixture slide is missing.');
  const xml = slide
    .toString()
    .replace(
      '</p:spPr>',
      '<a:effectLst><a:outerShdw><a:srgbClr val="000000"/></a:outerShdw></a:effectLst></p:spPr>',
    );
  parts.set(slidePart, Buffer.from(xml));
  await writeFile(file, makeZip(Array.from(parts, ([name, data]) => ({ name, data }))));
}
