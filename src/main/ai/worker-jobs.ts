import { suggestLyrics, applyLyricSuggestions } from '../../shared/ai-lyrics';
import { spellingScore } from '../../shared/ai-spelling';
import type { AiSearchHint } from '../../shared/search';
import type { WorkerJob } from './protocol';
import { MeaningEncoder, cosine } from './runtime';
import { LibraryCorpus, VectorCache, topHints } from './corpus';
let encoder: MeaningEncoder | null = null;
let cache: VectorCache | null = null;
let contextKey = '';
export async function closeJobs(): Promise<void> {
  await encoder?.close();
  encoder = null;
  cache?.close();
  cache = null;
  contextKey = '';
}
export async function runJob(
  job: WorkerJob,
  progress: (hints: AiSearchHint[]) => void,
  idle: () => Promise<void>,
): Promise<unknown> {
  if (job.kind === 'lyrics') return suggestLyrics(job.request);
  if (job.kind === 'apply-lyrics') return applyLyricSuggestions(job.text, job.proposal, job.selected);
  const key = job.context.assetsRoot + '\0' + job.context.cacheFile;
  if (contextKey !== key) {
    await closeJobs();
    contextKey = key;
    encoder = new MeaningEncoder(job.context.assetsRoot);
    cache = new VectorCache(job.context.cacheFile);
  }
  const model = encoder;
  const vectors = cache;
  if (!model || !vectors) throw new Error('MODEL_UNAVAILABLE');
  await idle();
  const query = await model.embed(job.query, 'query');
  if (job.kind === 'rank') {
    const ranked: { id: string; score: number }[] = [];
    for (const row of job.rows) {
      await idle();
      const vector = await model.embed(row.text, 'passage');
      ranked.push({ id: row.id, score: Math.max(0, Math.min(1, cosine(query, vector))) });
    }
    return ranked.sort((a, b) => b.score - a.score);
  }
  const corpus = new LibraryCorpus(job.context.libraryFile);
  let hints: AiSearchHint[] = [];
  let count = 0;
  try {
    for (const candidate of corpus.candidates()) {
      await idle();
      const spelling = spellingScore(job.query, candidate.text);
      let kind: AiSearchHint['kind'] = 'spelling';
      let score = spelling >= 0.65 ? 0.9 + spelling * 0.09 : 0;
      const cacheKey = vectors.key(candidate);
      let vector = vectors.get(cacheKey);
      if (!vector) {
        vector = await model.embed(candidate.text, 'passage');
        vectors.put(cacheKey, vector);
      }
      const meaning = cosine(query, vector);
      if (meaning >= 0.78 && meaning > score) {
        kind = 'meaning';
        score = Math.min(1, meaning);
      }
      if (score > 0)
        hints.push({
          presentationId: candidate.presentationId,
          slideId: candidate.slideId,
          stamp: candidate.stamp,
          kind,
          score,
        });
      if (hints.length > 100) hints = topHints(hints);
      if (++count % 8 === 0) {
        progress(topHints(hints));
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
    }
    return topHints(hints);
  } finally {
    corpus.close();
  }
}
