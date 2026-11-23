export class PdfCopyHistory {
  async keep(_path: string): Promise<string> { throw new Error('PDF copy Undo is not yet implemented.'); }
  async show(_id: string, _visible: boolean): Promise<boolean> { throw new Error('PDF copy Undo is not yet implemented.'); }
}
