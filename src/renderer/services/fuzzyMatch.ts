/**
 * Lightweight fuzzy-match scoring for the command palette.
 *
 * Algorithm: walk each character of `query` through `target`.
 *  - Each matching character scores 1 / (position-in-target + 1) so early
 *    matches are worth more.
 *  - Consecutive matches receive a +0.5 bonus each — this rewards contiguous
 *    substrings heavily.
 *  - Characters that start a new "word" (preceded by space, hyphen, slash, or
 *    are the first character) receive a +0.3 word-start bonus — this rewards
 *    matching the initials of multi-word labels.
 *
 * The ~20 commands in the palette don't need a Levenshtein automaton or
 * Smith-Waterman — this greedy approach is fast and good enough.
 */

/* ── Types ────────────────────────────────────────────────── */

export interface FuzzyMatchResult {
  /** Overall match score (higher = better). 0 when there is no match. */
  score: number;
  /** Indices into `target` that were matched — useful for highlight rendering. */
  matchedIndices: number[];
}

/* ── Word-boundary detection ──────────────────────────────── */

const WORD_SEPARATORS = new Set([" ", "-", "/", "_", "."]);

function isWordStart(target: string, index: number): boolean {
  if (index === 0) return true;
  return WORD_SEPARATORS.has(target[index - 1]);
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Score `query` against `target` using a greedy fuzzy-match.
 *
 * Returns `{ score: 0, matchedIndices: [] }` when the query characters cannot
 * all be found in order inside the target.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatchResult {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (q.length === 0) return { score: 1, matchedIndices: [] };
  if (q.length > t.length) return { score: 0, matchedIndices: [] };

  const matchedIndices: number[] = [];
  let score = 0;
  let qi = 0;
  let lastMatchIndex = -2; // -2 so the first match is never "consecutive"

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Base positional score: earlier positions in the target score more.
      score += 1 / (ti + 1);

      // Consecutive bonus
      if (ti === lastMatchIndex + 1) {
        score += 0.5;
      }

      // Word-start bonus
      if (isWordStart(target, ti)) {
        score += 0.3;
      }

      matchedIndices.push(ti);
      lastMatchIndex = ti;
      qi++;
    }
  }

  // All query characters must have been consumed for a valid match.
  if (qi < q.length) {
    return { score: 0, matchedIndices: [] };
  }

  return { score, matchedIndices };
}

/**
 * Score a query against multiple searchable fields (label + description) and
 * return the best score. Label matches receive a 1.5× multiplier since they
 * are more salient.
 */
export function fuzzyMatchCommand(
  query: string,
  label: string,
  description: string
): FuzzyMatchResult {
  const labelResult = fuzzyMatch(query, label);
  const descResult = fuzzyMatch(query, description);

  // Apply label multiplier
  const boostedLabel: FuzzyMatchResult = {
    score: labelResult.score * 1.5,
    matchedIndices: labelResult.matchedIndices,
  };

  return boostedLabel.score >= descResult.score ? boostedLabel : descResult;
}
