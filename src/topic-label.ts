/** Invalid display metadata is ignored, never a reason to retry classification. */
export function normalizeTopicLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const label = value.normalize('NFKC').trim().replace(/ +/g, ' ')
  if (/^\p{Script=Han}{2,4}$/u.test(label)) return label
  // Bound long English words as well as the word count so the label fits a bubble.
  if ([...label].length <= 24 && /^\p{Script=Latin}+(?: \p{Script=Latin}+)?$/u.test(label)) return label
  return undefined
}
