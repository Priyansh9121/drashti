import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { settled, expectNoSeriousA11yIssues } from './a11y';
import { rawContent } from './deck-edit-fixtures';
import { slideEditorClosed, slideEditorWindow } from './helpers';
import { openGeneratedPdf, PDF_PAGES, savePdfCopy, usePdfTools } from './pdf-tools-fixtures';
import { inspectPdf } from './pdf-export-oracle';

for (const [choice, indices] of [['This page',[0]],['Every page',[0,1,2]],['Odd pages',[0,2]],['Even pages',[1]]] as const) {
 test(`Crop page applies to ${choice}, fits thumbnails and retains underlying PDF content`, async () => {
  const s = await openGeneratedPdf();
  try {
   await usePdfTools(s.ed);
   await s.ed.getByRole('button',{name:'Crop page…',exact:true}).click();
   const dialog = s.ed.getByTestId('pdf-crop-dialog');
   await settled(s.ed);
   await expectNoSeriousA11yIssues(s.ed,'Crop page');
   const box = dialog.getByTestId('pdf-crop-box');
   const whole = await box.boundingBox();
   const corner = await box.locator('[data-edge="se"]').boundingBox();
   if (!whole || !corner) throw new Error('Generated page crop box missing');
   const from = {x:corner.x+corner.width/2,y:corner.y+corner.height/2};
   await s.ed.mouse.move(from.x,from.y); await s.ed.mouse.down();
   await s.ed.mouse.move(from.x-whole.width/2,from.y-whole.height/2,{steps:10}); await s.ed.mouse.up();
   await expect(dialog.getByTestId('crop-readout')).toContainText('right 50%');
   await expect(dialog.getByTestId('crop-readout')).toContainText('bottom 50%');
   await dialog.getByRole('combobox',{name:'Apply to',exact:true}).selectOption(choice);
   await dialog.getByRole('button',{name:'Keep crop',exact:true}).click();
   await expect(dialog).toHaveCount(0);
   for(let i=0;i<3;i++) await expect(s.editor.getByTestId('editor-slide-thumb').nth(i).locator('[data-page-crop]')).toHaveCount((indices as readonly number[]).includes(i)?1:0);
   await s.ed.getByRole('button',{name:'Undo',exact:true}).click();
   await expect(s.editor.locator('[data-page-crop]')).toHaveCount(0);
   await s.ed.getByRole('button',{name:'Redo',exact:true}).click();
   for(const i of indices) await expect(s.editor.getByTestId('editor-slide-thumb').nth(i).locator('[data-page-crop]')).toHaveCount(1);
   const output=join(s.folder,'Placeholder cropped copy.pdf');
   await savePdfCopy(s.app,s.ed,output);
   const copied=await inspectPdf(output);
   expect(copied).toHaveLength(3);
   for(const [i,paper] of PDF_PAGES.entries()) {
    const cropped=(indices as readonly number[]).includes(i);
    expect(copied[i]?.width).toBeCloseTo(paper.width*(cropped?0.5:1),1);
    expect(copied[i]?.height).toBeCloseTo(paper.height*(cropped?0.5:1),1);
    // This footer is outside the kept top-left quarter: still searchable underneath its CropBox.
    expect(copied[i]?.words).toContain(paper.marker);
   }
   await s.editor.getByTestId('save-slides').click(); await slideEditorClosed(s.app);
   const stored=rawContent(s.userData,s.id);
   for(const [i,row] of stored.slides.entries()) {
    const ref=JSON.parse(String(row.document_page)) as {crop?:{w:number;h:number};edited?:boolean};
    expect(ref.edited).not.toBe(true);
    if((indices as readonly number[]).includes(i)) { expect(ref.crop?.w).toBeCloseTo(0.5,3); expect(ref.crop?.h).toBeCloseTo(0.5,3); }
    else expect(ref.crop).toBeUndefined();
   }
   await s.win.getByTestId('edit-slides').click();
   const reopened=await slideEditorWindow(s.app);
   for(const i of indices) await expect(reopened.editor.getByTestId('editor-slide-thumb').nth(i).locator('[data-page-crop]')).toHaveCount(1);
   s.unchanged();
  } finally { await s.app.close(); s.unchanged(); }
 });
}

test('Crop page waits through stream and recording transitions, and Main refusal uses crop words',async()=>{
 const s=await openGeneratedPdf(undefined,undefined,{DRASHTI_TEST_ON_AIR_HOOK:'1'});
 try {
  await usePdfTools(s.ed);
  const status=await s.win.evaluate(()=> (globalThis as import('./helpers').PageGlobals).drashti.stream.status());
  const crop=s.ed.getByRole('button',{name:'Crop page…',exact:true});
  for(const [live,recording] of [['starting','off'],['off','starting'],['off','off']] as const) {
   await s.app.evaluate(({BrowserWindow},payload)=>{
    const ed=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===payload.url);
    if(!ed) throw new Error('Missing generated editor');
    ed.webContents.send('stream:changed',payload.status);
   },{url:s.ed.url(),status:{...status,live:{...status.live,state:live},recording:{...status.recording,state:recording}}});
   if(live==='off'&&recording==='off') await expect(crop).toBeEnabled();
   else { await expect(crop).toBeDisabled(); await expect(s.ed.getByTestId('pdf-crop-wait')).toHaveText('Crop page waits until the stream and recording are off.'); }
  }
  await s.app.evaluate(()=>{
   const hook=(globalThis as {drashtiTestOnAir?:(on:boolean)=>void}).drashtiTestOnAir;
   if(!hook) throw new Error('On-air hook missing'); hook(true);
  });
  await crop.click();
  await expect(s.ed.getByTestId('pdf-crop-dialog')).toHaveCount(0);
  await expect(s.ed.getByTestId('editor-note')).toHaveText('Crop page waits until the stream and recording are off.');
  s.unchanged();
 } finally {await s.app.close();s.unchanged();}
});
