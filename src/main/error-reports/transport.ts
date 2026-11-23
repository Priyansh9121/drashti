import type { AccessTransport } from '../access/client';
import { configSchema, type ErrorReportConfig } from './protocol';

/** Only Google's response redirect, fetched without the POST body. Never follows a login or arbitrary URL. */
function responseUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'script.googleusercontent.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/macros/echo' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

export async function sendErrorReport(
  transport: AccessTransport,
  config: ErrorReportConfig,
  body: string,
  stop: AbortSignal,
): Promise<boolean> {
  if (!configSchema.safeParse(config).success || stop.aborted) return false;
  const envelope = JSON.parse(body) as { payload: string };
  const report = JSON.parse(envelope.payload) as { id: string };
  const signal = AbortSignal.any([stop, AbortSignal.timeout(15_000)]);
  let url = config.endpoint;
  let method: 'POST' | 'GET' = 'POST';
  for (let hop = 0; hop < 3; hop++) {
    const answer = await transport({ url, method, body: method === 'POST' ? body : null, signal });
    try {
      if (answer.status === 200) {
        const receipt: unknown = JSON.parse(await answer.text(1024));
        return (
          typeof receipt === 'object' &&
          receipt !== null &&
          'ok' in receipt &&
          receipt.ok === true &&
          'id' in receipt &&
          receipt.id === report.id
        );
      }
      if (
        (answer.status !== 302 && answer.status !== 303) ||
        !answer.location ||
        !responseUrl(answer.location)
      )
        return false;
      url = answer.location;
      method = 'GET';
    } finally {
      answer.cancel();
    }
  }
  return false;
}
