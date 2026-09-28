/**
 * Migration 3: removing presentations with Undo.
 *
 * A removed presentation keeps its rows with deleted_at set, so Undo can
 * bring it back exactly. Drashti purges removed presentations 30 days later.
 */
export const up = `
ALTER TABLE presentations ADD COLUMN deleted_at TEXT;
CREATE INDEX presentations_removed ON presentations(deleted_at) WHERE deleted_at IS NOT NULL;
`;
