import { Deliveries, type OutEvent, type TryResult } from './delivery';
import { checkTarget, type Resolve } from './policy';
import type { PostRequest } from './post';
import type { FromEventsWorker, ToEventsWorker, WorkerAddress } from './protocol';
import { githubStyleSignature, standardSignature } from './signing';

/*
 * The events worker's work (Session 28), apart from the process it runs in so tests run it alone: each
 * address's queue (delivery.ts), each try checked against the policy at the moment it goes (policy.ts) and
 * signed then (a retry has a new timestamp, the same id).
 */

export interface SenderDeps {
  post: (request: PostRequest) => Promise<TryResult>;
  resolve: Resolve;
  now: () => number;
  later: (ms: number, wake: () => void) => () => void;
  random: () => number;
}

export function eventsSender(
  reply: (message: FromEventsWorker) => void,
  deps: SenderDeps,
): (message: ToEventsWorker) => void {
  const addresses = new Map<string, WorkerAddress>();
  // Until the main process says otherwise, the strictest: nowhere but this computer.
  let onlyThisComputer = true;

  const send = async (addressId: string, event: OutEvent): Promise<TryResult> => {
    const address = addresses.get(addressId);
    if (!address) return { error: 'removed' };
    const target = await checkTarget(address.url, {
      allowInternet: address.allowInternet,
      onlyThisComputer,
      resolve: deps.resolve,
    });
    if (!target.ok) {
      if (target.loud) reply({ type: 'guard', message: target.reason });
      return { error: target.reason };
    }
    const now = deps.now();
    const timestamp = Math.floor(now / 1000);
    const signatures = [standardSignature(address.secret, event.id, timestamp, event.body)];
    // After Rotate, the old secret signs too for a day, so a receiver changing over accepts either.
    if (address.oldSecret && now < address.oldSecret.until)
      signatures.push(standardSignature(address.oldSecret.secret, event.id, timestamp, event.body));
    return deps.post({
      url: target.url,
      ip: target.ip,
      family: target.family,
      headers: {
        'webhook-id': event.id,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': signatures.join(' '),
        'x-drashti-signature-256': githubStyleSignature(address.secret, event.body),
        'x-drashti-event': event.type,
      },
      body: event.body,
    });
  };

  const deliveries = new Deliveries({
    now: deps.now,
    send,
    report: (addressId, event, outcome) => {
      reply({ type: 'outcome', addressId, eventType: event.type, outcome });
    },
    later: deps.later,
    random: deps.random,
  });

  return (message) => {
    switch (message.type) {
      case 'start':
        onlyThisComputer = message.onlyThisComputer;
        return;
      case 'addresses': {
        const kept = new Set(message.list.map((a) => a.id));
        for (const id of addresses.keys()) if (!kept.has(id)) deliveries.reset(id);
        addresses.clear();
        for (const a of message.list) addresses.set(a.id, a);
        return;
      }
      case 'event':
        if (addresses.has(message.addressId)) deliveries.add(message.addressId, message.event);
        return;
      case 'test':
        void send(message.addressId, message.event).then((result) => {
          reply({ type: 'test-result', requestId: message.requestId, result });
        });
        return;
      case 'reset':
        deliveries.reset(message.addressId);
        return;
    }
  };
}
