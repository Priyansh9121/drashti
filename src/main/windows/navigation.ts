/**
 * True when `url` is one of our own renderer pages: the Vite dev server in
 * development, or a file inside the built renderer folder in production.
 */
export function isAppUrl(
  url: string,
  opts: { devServerUrl?: string | undefined; rendererDir: string },
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (opts.devServerUrl) {
    const dev = new URL(opts.devServerUrl);
    if (parsed.origin === dev.origin) return true;
  }
  // A file on this computer only: a host names another computer's (a network share on Windows).
  if (parsed.protocol !== 'file:' || parsed.host !== '') return false;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }
  path = path.replace(/\\/g, '/').replace(/^\/([A-Za-z]:)/, '$1');
  // The address parser leaves an encoded separator inside its segment ("..%2F"), but decoded it is a step
  // out: no dot segment and no NUL once decoded, as the phones' server refuses them (network/web-files.ts).
  if (path.includes('\0') || path.split('/').some((part) => part === '..' || part === '.')) return false;
  const dir = opts.rendererDir.replace(/\\/g, '/').replace(/\/+$/, '');
  return path.startsWith(dir + '/');
}
