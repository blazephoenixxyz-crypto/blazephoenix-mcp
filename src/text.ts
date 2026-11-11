// Text that leaves this server goes to an AI agent's transcript. Two kinds of it are not
// ours to trust: a transport's error text, which quotes the URL it called (key and all),
// and the strings a token contract chooses for itself.

/** Every URL inside a message, reduced to its host. */
export function scrubUrls(text: string): string {
  return text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, (m) => {
    try {
      const u = new URL(m);
      return `${u.protocol}//${u.host}${u.pathname.length > 1 ? '/…' : ''}`;
    } catch {
      return '<url>';
    }
  });
}

/** A string a token contract chose (its name, its symbol, a revert text): what a reader
 *  cannot see is removed, whitespace collapsed, length capped. "Cannot see" is three Unicode
 *  properties, not a list: control characters (Cc), format characters (Cf: direction marks,
 *  embeddings, overrides and isolates, the Arabic letter mark, joiners) and every
 *  default-ignorable code point (soft hyphen, fillers, word joiner, variation selectors, tags). */
export function tokenText(s: unknown, max = 64): string {
  const t = String(s ?? '')
    .replace(/[\u{E0000}-\u{E007F}]/gu, '') // tag characters: invisible text a model still reads
    .replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
