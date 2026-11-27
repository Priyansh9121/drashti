import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { bounded, OutboundPolicy, type Authority, type Resolve } from '../network/outbound-policy';
import { openChecked, type PinnedRequest } from '../network/pinned-request';

type Kind = 'playlist' | 'media';
const PLAYLIST_BYTES = 1024 * 1024;
const RESOURCE_BYTES = 64 * 1024 * 1024;
const URI_TAGS: Record<string, Kind> = {
  '#EXT-X-KEY': 'media',
  '#EXT-X-SESSION-KEY': 'media',
  '#EXT-X-MAP': 'media',
  '#EXT-X-MEDIA': 'playlist',
  '#EXT-X-I-FRAME-STREAM-INF': 'playlist',
  '#EXT-X-IMAGE-STREAM-INF': 'playlist',
  '#EXT-X-RENDITION-REPORT': 'playlist',
  '#EXT-X-PART': 'media',
  '#EXT-X-PRELOAD-HINT': 'media',
};

/** A private loopback gateway. FFmpeg sees only rewritten local URLs; it never receives upstream playlist bytes. */
export class CheckedHls {
  private readonly secret = randomBytes(32);
  private readonly nonce = randomBytes(24).toString('hex');
  private readonly abort = new AbortController();
  private readonly policy: OutboundPolicy;
  private server: Server | null = null;
  private base = '';
  private active = 0;
  constructor(
    authority: Authority,
    private readonly options: { guard?: boolean; resolve?: Resolve; request?: PinnedRequest } = {},
  ) {
    this.policy = new OutboundPolicy(authority, options.guard, options.resolve);
  }

  async start(url: string): Promise<string> {
    this.abort.signal.throwIfAborted();
    await bounded(this.policy.target(url), this.abort.signal);
    const server = createServer((req, res) => {
      void this.serve(req, res);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    this.abort.signal.throwIfAborted();
    this.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return this.local(url, 'playlist');
  }

  async close(): Promise<void> {
    this.abort.abort();
    const s = this.server;
    this.server = null;
    if (s) {
      s.closeAllConnections();
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  }

  private sign(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('hex');
  }
  private local(url: string, kind: Kind): string {
    const data = Buffer.from(JSON.stringify({ url, kind })).toString('base64url');
    const suffix =
      kind === 'playlist' ? 'm3u8' : (/\.([a-z0-9]{1,8})$/iu.exec(new URL(url).pathname)?.[1] ?? 'ts');
    return `${this.base}/${this.nonce}/${data}/${this.sign(data)}.${suffix}`;
  }

  /** Replace every fetchable URI; unsupported URI-bearing tags and variable substitutions fail closed. */
  async rewrite(text: string, base: string, signal: AbortSignal = this.abort.signal): Promise<string> {
    const lines = text
      .replace(/^\uFEFF/u, '')
      .split(/\r?\n/u)
      .map((s) => s.trim());
    if (lines[0] !== '#EXTM3U' || text.includes('{$')) throw new Error('Unsupported HLS');
    let variant = false;
    const output: string[] = [];
    const link = async (raw: string, kind: Kind) => {
      if (
        raw.length > 5000 ||
        Array.from(raw).some((c) => (c.codePointAt(0) ?? 0) <= 32 || c.codePointAt(0) === 127)
      )
        throw new Error('Invalid HLS URI');
      const url = new URL(raw, base).href;
      await bounded(this.policy.target(url), signal);
      return this.local(url, kind);
    };
    for (const line of lines) {
      signal.throwIfAborted();
      if (!line) {
        output.push('');
        continue;
      }
      if (!line.startsWith('#')) {
        output.push(await link(line, variant ? 'playlist' : 'media'));
        variant = false;
        continue;
      }
      const colon = line.indexOf(':');
      const tag = line.split(':', 1)[0] ?? line;
      if (tag === '#EXT-X-DEFINE' || tag === '#EXT-X-CONTENT-STEERING')
        throw new Error('Unsupported HLS indirection');
      if (tag === '#EXT-X-STREAM-INF') variant = true;
      if (!/(?:^|[, :])(?:[A-Z0-9-]*URI)\s*=/u.test(line)) {
        output.push(line);
        continue;
      }
      const kind = URI_TAGS[tag];
      if (!kind) throw new Error('Unsupported HLS URI tag');
      const attrs = line.slice(colon + 1);
      const re = /([A-Z0-9-]+)=("[^"\r\n]*"|[^,"\r\n]*)(?:,|$)/gy;
      let at = 0;
      const pairs: string[] = [];
      while (at < attrs.length) {
        re.lastIndex = at;
        const m = re.exec(attrs);
        if (!m || re.lastIndex <= at) throw new Error('Invalid HLS attributes');
        at = re.lastIndex;
        const name = m[1] ?? '',
          value = m[2] ?? '';
        if (name.endsWith('URI')) {
          if (name !== 'URI' || !value.startsWith('"') || !value.endsWith('"'))
            throw new Error('Invalid HLS URI attribute');
          pairs.push(`${name}="${await link(value.slice(1, -1), kind)}"`);
        } else pairs.push(`${name}=${value}`);
      }
      output.push(`${tag}:${pairs.join(',')}`);
    }
    return output.join('\n');
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const m = new RegExp(`^/${this.nonce}/([A-Za-z0-9_-]+)/([a-f0-9]{64})\\.[a-z0-9]{1,8}$`, 'iu').exec(
      req.url ?? '',
    );
    if (
      req.method !== 'GET' ||
      req.headers.host !== new URL(this.base).host ||
      req.headers.origin ||
      !m ||
      this.active >= 8
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = m[1] ?? '',
      signature = m[2] ?? '';
    if (data.length > 12_000 || !timingSafeEqual(Buffer.from(signature), Buffer.from(this.sign(data)))) {
      res.writeHead(403);
      res.end();
      return;
    }
    const cancelled = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, cancelled.signal, AbortSignal.timeout(30_000)]);
    res.once('close', () => cancelled.abort());
    this.active++;
    let response: IncomingMessage | null = null;
    try {
      const route = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as {
        url: string;
        kind: Kind;
      };
      const range = req.headers.range;
      if (range && !/^bytes=\d+-\d*$/u.test(range)) throw new Error('Invalid range');
      const got = await openChecked(
        route.url,
        (url) => this.policy.target(url),
        signal,
        range ? { Range: range } : {},
        this.options.request,
      );
      response = got.response;
      if (response.statusCode !== 200 && response.statusCode !== 206) throw new Error('Upstream refused');
      const iterator = response[Symbol.asyncIterator]();
      const prefix: Buffer[] = [];
      let size = 0,
        ended = false;
      while (size < 1024 && !ended) {
        const next = await iterator.next();
        ended = next.done === true;
        if (!next.done) {
          const b = next.value as Buffer;
          size += b.length;
          prefix.push(b);
        }
      }
      const first = Buffer.concat(prefix);
      const playlist =
        route.kind === 'playlist' ||
        first
          .toString('utf8', 0, 64)
          .replace(/^\uFEFF/u, '')
          .trimStart()
          .startsWith('#EXTM3U') ||
        /mpegurl/iu.test(response.headers['content-type'] ?? '');
      if (playlist) {
        const chunks = prefix;
        if (size > PLAYLIST_BYTES) throw new Error('Playlist too large');
        while (!ended) {
          const next = await iterator.next();
          ended = next.done === true;
          if (!next.done) {
            const b = next.value as Buffer;
            size += b.length;
            if (size > PLAYLIST_BYTES) throw new Error('Playlist too large');
            chunks.push(b);
          }
        }
        const text = await bounded(
          this.rewrite(Buffer.concat(chunks).toString('utf8'), got.url, signal),
          signal,
        );
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
        res.end(text);
      } else {
        res.writeHead(response.statusCode, {
          'Content-Type': 'application/octet-stream',
          ...(response.headers['content-range']
            ? { 'Content-Range': response.headers['content-range'] }
            : {}),
        });
        if (!res.write(first)) await once(res, 'drain', { signal });
        while (!ended) {
          const next = await iterator.next();
          ended = next.done === true;
          if (!next.done) {
            const b = next.value as Buffer;
            size += b.length;
            if (size > RESOURCE_BYTES) throw new Error('Resource too large');
            if (!res.write(b)) await once(res, 'drain', { signal });
          }
        }
        res.end();
      }
    } catch {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    } finally {
      response?.destroy();
      this.active--;
    }
  }
}
