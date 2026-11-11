import type { Locator, Page } from '@playwright/test';

/*
 * Folders dropped from the Finder or Explorer (Session 56): Playwright's setInputFiles takes files only (a folder only
 * into a webkitdirectory input, which gives its files), so the page is given what the system's drop gives it, a File
 * whose path is the folder's, through Chromium's own DOM.setFileInputFiles. The drop is then sent as dropFiles
 * (helpers.ts) sends one: dragenter, dragover and drop on the target, with a DataTransfer of those files.
 */

/** Drop `paths` (folders, files, or both, in this order) on `target`, as the system's drag and drop does. */
export async function dropPaths(page: Page, target: Locator, paths: string[]): Promise<void> {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = 'e2e-folder-source';
    input.style.display = 'none';
    document.body.appendChild(input);
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', {});
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#e2e-folder-source',
    });
    await cdp.send('DOM.setFileInputFiles', { nodeId, files: paths });
  } finally {
    await cdp.detach();
  }
  const dataTransfer = await page.evaluateHandle(() => {
    const input = document.getElementById('e2e-folder-source') as HTMLInputElement;
    const dt = new DataTransfer();
    for (const file of Array.from(input.files ?? [])) dt.items.add(file);
    input.remove();
    return dt;
  });
  await target.dispatchEvent('dragenter', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
}
