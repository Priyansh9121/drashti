/* Placeholder-only helpers for controller and engine unit tests. */
import type { EngineCommand } from '../../shared/engine/commands';
import { openDatabase } from '../db/database';
import { NodeRepo } from '../db/nodes';
import { ScreenRepo } from '../db/screens';
import { SettingsRepo } from '../db/settings';
import { ShowEngine, type EngineOptions } from '../engine/show-engine';
import { makeSource } from '../engine/testing';
import { NodeService, type NodeServiceDeps } from './node-service';
import type { LinkWorker } from './link-worker';
import type { FromLinkWorker, ToLinkWorker } from './worker/protocol';

export function controllerTest(options: EngineOptions = {}) {
  const db = openDatabase(':memory:');
  const nodes = new NodeRepo(db);
  const screens = new ScreenRepo(db);
  const settings = new SettingsRepo(db);
  const node = nodes.add({
    name: 'Placeholder second computer',
    tokenHash: 'a'.repeat(64),
    address: '127.0.0.1',
    version: '1.0.0-test',
  });
  const messages: ToLinkWorker[] = [];
  const actions: EngineCommand[] = [];
  let refusal: string | null = null;
  let receive: (message: FromLinkWorker) => void = () => undefined;
  let service: NodeService;
  let now = 1000;
  const engine = new ShowEngine(
    makeSource(),
    {
      broadcast: (message) => service.broadcast(message),
    },
    () => ++now,
    undefined,
    options,
  );
  const deps: NodeServiceDeps = {
    nodes,
    screens,
    settings,
    pointed: () => null,
    spawn: (): LinkWorker => ({
      send: (message) => {
        messages.push(structuredClone(message));
        if (message.type === 'stop') receive({ type: 'stopped' });
      },
      onMessage: (listener) => {
        receive = listener;
      },
      onExit: () => undefined,
      kill: () => undefined,
    }),
    identity: () => ({
      cert: 'placeholder',
      key: 'placeholder',
      fingerprint: 'placeholder',
      id: 'main',
      name: 'Placeholder Main',
    }),
    newIdentity: () => undefined,
    version: '1.0.0-test',
    addresses: () => ['127.0.0.1'],
    bind: '127.0.0.1',
    engine: {
      snapshot: () => engine.snapshot(),
      state: () => engine.current,
      rev: () => engine.rev,
      acceptsPress: (rev, session) => engine.acceptsPress(rev, session),
      session: engine.session,
    },
    runShowAction: (command: EngineCommand) => {
      actions.push(command);
      if (refusal) return { status: 403, body: { ok: false, message: refusal } };
      const result = engine.dispatch(command);
      return { status: result.ok ? 200 : 409, body: result };
    },
    wanted: () => [],
    mediaFile: () => null,
    onAir: () => false,
    changed: () => undefined,
    screensChanged: () => undefined,
    thumbs: () => undefined,
    localOutputs: () => [],
    log: () => undefined,
    now: () => now,
  };
  const start = () => {
    service = new NodeService(deps);
    service.tellAccess(true);
    service.resume();
    return service;
  };
  start();
  return {
    get service() {
      return service;
    },
    engine,
    messages,
    actions,
    refuse: (message: string | null) => {
      refusal = message;
    },
    node,
    nodes,
    screens,
    emit: (message: FromLinkWorker) => receive(message),
    online: () => receive({ type: 'online', nodeId: node.id, address: '127.0.0.1', version: '1.0.0-test' }),
    restart: async () => {
      await service.close();
      start();
    },
    close: async () => {
      await service.close();
      db.close();
    },
  };
}
