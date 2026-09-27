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
  if (parsed.protocol !== 'file:') return false;
  const toPath = (p: string) =>
    decodeURIComponent(p)
      .replace(/\\/g, '/')
      .replace(/^\/([A-Za-z]:)/, '$1');
  const dir = opts.rendererDir.replace(/\\/g, '/').replace(/\/+$/, '');
  return toPath(parsed.pathname).startsWith(dir + '/');
}
