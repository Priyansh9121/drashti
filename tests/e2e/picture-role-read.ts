import type { ElectronApplication } from '@playwright/test';

/** Read the exact registered picture role without changing the operator page's connect-src policy. */
export async function readPictureRole(app: ElectronApplication, url: string): Promise<Buffer> {
  const encoded = await app.evaluate(async ({ net }, url) => {
    const response = await net.fetch(url);
    if (!response.ok) throw new Error('The picture role could not be read.');
    return Buffer.from(await response.arrayBuffer()).toString('base64');
  }, url);
  return Buffer.from(encoded, 'base64');
}
