/** Native blank and edited pages retain paper geometry without inventing a source identity. */
export const up = `ALTER TABLE slides ADD COLUMN page_size TEXT;`;
