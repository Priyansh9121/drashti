import { expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { makeTestPdf } from '../main/import/testing/make-pdf';
import { cropPdfCopy } from './pdf-crop-copy';
it('writes a true CropBox, retaining MediaBox, content outside it and every uncropped page', async()=>{
 const data=new Uint8Array(makeTestPdf([
  {width:400,height:600,color:[50,70,90],text:'Placeholder outside crop'},
  {width:600,height:400,color:[90,70,50],text:'Placeholder whole page'},
 ]));
 const before=data.slice();
 const copy=await cropPdfCopy(data,[{x:0.25,y:0.1,w:0.5,h:0.2},undefined]);
 expect(data).toEqual(before);
 const loading=getDocument({data:copy.slice(),useSystemFonts:false});
 try {
  const doc=await loading.promise;
  expect(doc.numPages).toBe(2);
  const first=await doc.getPage(1),second=await doc.getPage(2);
  expect(first.view).toEqual([100,420,300,540]);
  expect(first.getViewport({scale:1}).width).toBe(200);
  expect(first.getViewport({scale:1}).height).toBe(120);
  expect(second.view).toEqual([0,0,600,400]);
  expect((await first.getTextContent()).items.filter(i=>'str' in i).map(i=>'str' in i?i.str:'').join(' ')).toContain('Placeholder outside crop');
  // PDF.js public view honors CropBox; the saved page still has its original media extents in the output.
  expect(new TextDecoder().decode(copy)).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+400\s+600\s*\]/);
 } finally {await loading.destroy();}
});
