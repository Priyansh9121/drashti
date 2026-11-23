import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { EditDoc } from '../../shared/slide-edit';
import type { PdfCopyJob } from '../../shared/pdf-copy';
import { openDatabase } from '../db/database';
import { PdfEditor } from './pdf-editor';
import type { PdfCopySession } from './pdf-copy-session';

const doc: EditDoc = {
  presentationId: 'placeholder',
  name: 'Placeholder',
  width: 400,
  height: 300,
  transition: null,
  loop: false,
  groups: [
    {
      id: 'g',
      name: '',
      color: null,
      slides: [0, 1, 2].map((n) => ({
        id: `page-${n}`,
        label: '',
        notes: '',
        background: null,
        darken: null,
        enabled: true,
        transition: null,
        autoAdvanceMs: null,
        macroId: null,
        elements: [],
        cues: [],
      })),
    },
  ],
};
describe('selected PDF copy validation and assembly', () => {
  it('validates the whole editor document before planning only the chosen pages in order', async () => {
    const db = openDatabase(':memory:');
    try {
      const plans: Omit<PdfCopyJob, 'id'>[] = [];
      const validate = vi.fn(() => ({ ok: true as const, doc }));
      const session = {
        run: (plan: Omit<PdfCopyJob, 'id'>) => {
          plans.push(plan);
          return Promise.resolve(null);
        },
        stop: () => undefined,
      } as unknown as PdfCopySession;
      const editor = new PdfEditor({
        db,
        mediaDir: '/placeholder',
        session,
        allowed: () => true,
        stamp: () => 'stamp',
        validate,
        chooseOutput: () => Promise.resolve('/placeholder-copy.pdf'),
      });
      const event = { sender: Object.assign(new EventEmitter(), { isDestroyed: () => false }) } as never;
      await editor.export(event, doc.presentationId, doc, 'stamp', [0, 2]);
      expect(validate).toHaveBeenCalledWith(doc.presentationId, doc, 'stamp');
      expect(plans[0]?.pages.map((p) => (p.kind === 'native' ? p.slide.id : null))).toEqual([
        'page-0',
        'page-2',
      ]);
      for (const pages of [[], [3], [2, 0], [0, 0], [-1], [0.5]]) {
        const result = await editor.export(event, doc.presentationId, doc, 'stamp', pages);
        expect(result.ok).toBe(false);
      }
      expect(plans).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
