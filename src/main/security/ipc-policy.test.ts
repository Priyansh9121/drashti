import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { bridgeFor, PAGE_GROUPS } from '../../preload/page-groups';
import { IPC, allChannels } from '../../shared/ipc';
import { bridgeMethodAllowed, ipcChannelAllowed, PAGE_METHODS, type IpcPage } from '../../shared/ipc-policy';

/** Independently read the actual preload, so adding or remapping a method cannot silently widen Main's table. */
function preloadMethods(): Map<string, string[]> {
  const file = join(__dirname, '../../preload/index.ts');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const methods = new Map<string, string[]>();
  const walk = (node: ts.Node, visit: (node: ts.Node) => void) => {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
  };
  const valueOf = (node: ts.Expression): string => {
    const names = node.getText(source).split('.').slice(1);
    let value: unknown = IPC;
    for (const name of names) value = (value as Record<string, unknown>)[name];
    if (typeof value !== 'string') throw new Error('An IPC reference is not a known channel.');
    return value;
  };
  const object = (node: ts.ObjectLiteralExpression, prefix: string) => {
    for (const member of node.properties) {
      if (!ts.isPropertyAssignment(member))
        throw new Error('Review this bridge member before giving authority.');
      const method = `${prefix}${member.name.getText(source)}`;
      if (ts.isObjectLiteralExpression(member.initializer)) object(member.initializer, `${method}.`);
      else {
        const channels: string[] = [];
        walk(member.initializer, (child) => {
          if (ts.isCallExpression(child) && child.expression.getText(source) === 'invoke') {
            const channel = child.arguments[0];
            if (!channel) throw new Error('A preload invoke is missing its channel.');
            channels.push(valueOf(channel));
          }
        });
        methods.set(method, channels);
      }
    }
  };
  walk(source, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === 'bridge' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    )
      object(node.initializer, '');
  });
  return methods;
}

describe('alpha.24 explicit window/channel policy', () => {
  it('matches the actual preload method channels for every role and fails closed on all others', () => {
    const methods = preloadMethods();
    expect(methods.size).toBeGreaterThan(600);
    const assigned = new Set<string>(Object.values(PAGE_METHODS).flat());
    expect([...methods.keys()].filter((method) => !assigned.has(method))).toEqual([]);
    for (const page of Object.keys(PAGE_METHODS) as IpcPage[]) {
      const expected = new Set<string>([IPC.appearance.now]);
      for (const method of PAGE_METHODS[page]) {
        expect(methods.has(method), `${page}: ${method}`).toBe(true);
        expect(PAGE_GROUPS[page]).toContain(method.split('.')[0]);
        for (const channel of methods.get(method) ?? []) expected.add(channel);
      }
      for (const channel of [...allChannels(), 'placeholder:unlisted', '__proto__', 'toString'])
        expect(ipcChannelAllowed(page, channel), `${page}: ${channel}`).toBe(expected.has(channel));
    }
  });

  it('keeps quit at the operator and access lock, and every worker at its own service', () => {
    for (const page of Object.keys(PAGE_METHODS) as IpcPage[]) {
      expect(ipcChannelAllowed(page, IPC.access.quit), page).toBe(page === 'index' || page === 'lock');
      expect(ipcChannelAllowed(page, IPC.sharpen.next), page).toBe(page === 'sharpen');
      expect(ipcChannelAllowed(page, IPC.displayCopies.next), page).toBe(page === 'display-copy');
      expect(ipcChannelAllowed(page, IPC.pictures.page), page).toBe(page === 'pdf');
      expect(ipcChannelAllowed(page, IPC.pdfExport.capture), page).toBe(page === 'pdf-export');
      expect(ipcChannelAllowed(page, IPC.accessList.approve), page).toBe(page === 'access-list');
      expect(ipcChannelAllowed(page, IPC.engine.command), page).toBe(page === 'index');
    }
  });

  it('retains drawing, cue acknowledgements, media reports and stream page methods without operator mutations', () => {
    for (const page of ['output', 'stream', 'node'] as const) {
      for (const method of [
        'engine.subscribe',
        'engine.snapshot',
        'engine.videoCueReady',
        'media.looks',
        'media.cannotPlay',
        'media.reportLength',
        'liveWindow.ask',
        'liveWindow.ended',
        'videoInputs.list',
        'videoInputs.report',
      ])
        expect(bridgeMethodAllowed(page, method), `${page}: ${method}`).toBe(true);
      for (const channel of [IPC.media.remove, IPC.media.setPlayback, IPC.app.setMode, IPC.stream.goLive])
        expect(ipcChannelAllowed(page, channel), `${page}: ${channel}`).toBe(false);
    }
    const context = () => undefined;
    const goLive = () => undefined;
    const bridge = bridgeFor({ stream: { goLive, page: { context } } }, 'stream');
    expect(bridge.stream?.page.context).toBe(context);
    expect(bridge.stream).not.toHaveProperty('goLive');
  });
});
