// Reciprocal rank fusion: merges several best-first rankings into one
// without needing their scores to be comparable (a cosine similarity and a
// BM25 rank are not). Each list contributes 1 / (k + rank) per key; k = 60
// is the conventional damping constant.
export function reciprocalRankFusion(rankings: string[][], k = 60): { key: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((key, index) => {
      scores.set(key, (scores.get(key) ?? 0) + 1 / (k + index + 1));
    });
  }
  return Array.from(scores, ([key, score]) => ({ key, score })).sort((a, b) => b.score - a.score);
}
