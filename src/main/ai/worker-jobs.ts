import { suggestLyrics, applyLyricSuggestions } from '../../shared/ai-lyrics';
import { spellingScore } from '../../shared/ai-spelling';
import type { AiSearchHint } from '../../shared/search';
import type { BookHint } from '../../shared/ai-speech';
import type { WorkerJob } from './protocol';
import { MeaningEncoder, cosine } from './runtime';
import { BookCorpus, LibraryCorpus, VectorCache, topHints } from './corpus';
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
  if (job.kind === 'books') {
    const corpus = new BookCorpus(job.context.libraryFile);
    const hints: BookHint[] = [];
    let after = job.after ?? { row: 0, part: 0 };
    const began = Date.now();
    const best = () => {
      const seen = new Set<string>();
      return hints
        .sort((a, b) => b.score - a.score)
        .filter((hint) => {
          const key = hint.itemId + ':' + hint.lang;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 50);
    };
    try {
      for (const candidate of corpus.candidates(job.after)) {
        await idle();
        const key = vectors.key(candidate);
        let vector = vectors.get(key);
        if (!vector) {
          vector = await model.embed(candidate.text, 'passage');
          vectors.put(key, vector);
        }
        const score = cosine(query, vector);
        if (score >= 0.84)
          hints.push({
            itemId: candidate.itemId,
            lang: candidate.lang,
            stamp: candidate.stamp,
            score: Math.min(1, score),
          });
        if (hints.length > 100) {
          const bounded = best();
          hints.length = 0;
          hints.push(...bounded);
        }
        after = candidate.after;
        // A bounded page of inference; Main can refresh exact hits and yield between pages.
        if (Date.now() - began >= 1000) return { hints: best(), after, finished: false };
      }
      return { hints: best(), after, finished: true };
    } finally {
      corpus.close();
    }
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
