import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../operator/Layout', () => ({ Columns: ({ right }: { right: ReactNode }) => createElement('div', null, right) }));
vi.mock('./practice-store', () => ({ usePractice: (select: (state: unknown) => unknown) => select({ source: { playlist: null, slides: [], labels: [] }, practice: { index: 0 } }), runPractice: vi.fn(), stopPractice: vi.fn() }));

vi.mock('../operator/LivePreview', () => ({ LivePreview: () => createElement('div', { 'data-testid': 'practice-live-picture' }) }));
vi.mock('../operator/NextBack', () => ({ NextBack: () => createElement('button', { 'data-testid': 'practice-next' }, 'Next') }));
vi.mock('../setup/Welcome', () => ({ openWelcome: vi.fn() }));
vi.mock('../render/SlideView', () => ({ SlideView: () => null }));

import { PracticeShow } from './PracticeShow';

describe('the practice show’s notices', () => {
  it('gives notices the show’s capped live-column foot, outside the controls’ scroller', () => {
    const html = renderToStaticMarkup(createElement(PracticeShow, { platform: 'darwin', run: vi.fn() }));
    expect(html).toContain('data-testid="live-column"');
    expect(html).toMatch(/data-testid="live-still"[^>]*>[\s\S]*data-testid="practice-live-picture"[\s\S]*data-testid="practice-next"/u);
    expect(html).toMatch(/data-testid="live-rest"[^>]*><\/div><\/div><div[^>]*overflow-y-auto[^>]*data-testid="notice-place"/u);
  });
});
