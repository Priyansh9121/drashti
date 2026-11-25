import { describe, expect, it } from 'vitest';
import { PAGE_GROUPS } from '../../../preload/page-groups';

/*
 * The chat (QA23-CHAT-1) is the operator window's alone: never an audience or stage screen's, the stream's, a node's
 * or any other window's page, so none of them can read its words (src/main/release-checks/page-groups.test.ts checks
 * each page's groups against its code).
 */
describe('the chat’s pages', () => {
  it('is in the operator window’s bridge only', () => {
    const withChat = Object.entries(PAGE_GROUPS)
      .filter(([, groups]) => groups.includes('chat'))
      .map(([page]) => page);
    expect(withChat).toEqual(['index']);
  });
});
