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

/** A string a token contract chose (its name or symbol): control, zero-width and
 *  direction-override characters removed, whitespace collapsed, length capped. */
export function tokenText(s: unknown, max = 64): string {
  const t = String(s ?? '')
    .replace(/[\u{E0000}-\u{E007F}]/gu, '') // tag characters: invisible text a model still reads
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
