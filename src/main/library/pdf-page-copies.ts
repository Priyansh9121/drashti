import type { EditDoc } from '../../shared/slide-edit';
import type { Db } from '../db/database';
import type { PresentationRepo } from '../db/presentations';
export function keepPdfPages(_db: Db, _repo: PresentationRepo, _doc: EditDoc, _indices: number[]): { id: string; name: string } {
  throw new Error('PDF presentation extraction is not yet implemented.');
}
