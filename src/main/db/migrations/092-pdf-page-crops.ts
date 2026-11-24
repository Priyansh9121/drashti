/**
 * Page crops live in document_page JSON, absent for whole pages. No rows need rewriting.
 * The schema floor prevents older apps, whose validators discard crop, from saving this library.
 */
export const up = `SELECT 1;`;
