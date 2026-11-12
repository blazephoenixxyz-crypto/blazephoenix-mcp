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

/** What a reader cannot see, removed from any string on its way out. "Cannot see" is Unicode
 *  properties, not a list: control characters (Cc), format characters (Cf: direction marks,
 *  embeddings, overrides and isolates, the Arabic letter mark, joiners), every default-ignorable
 *  code point (soft hyphen, fillers, word joiner and U+2060-206F, variation selectors, tags) and a
 *  lone surrogate (half a character: no text encodes one). Tags go without a trace, the rest
 *  becomes a space. Line feed and tab stay: JSON writes them as the visible escapes \n and \t,
 *  and the text that has them (several lines of an error, a table) needs them. Nothing here can
 *  touch an address, calldata or a number: none of them holds any of these. */
export function visibleText(s: string): string {
  return s
    .replace(/[\u{E0000}-\u{E007F}]/gu, '') // tag characters: invisible text a model still reads
    .replace(/(?![\t\n])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, ' ')
    .replace(/\p{Cs}/gu, ' ');
}

/** A string a token contract chose (its name, its symbol, a revert text): `visibleText`, then
 *  whitespace collapsed and length capped; a cap inside a surrogate pair drops the half. */
export function tokenText(s: unknown, max = 64): string {
  const t = visibleText(String(s ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max).replace(/\p{Cs}$/u, '')}…` : t;
}

/** The text every tool answers with: JSON that survives bigint, in which every string, under any
 *  key and at any depth, is `visibleText` (the data decides, not the name of the key). A token's
 *  `symbol`, `name` and a `reason` are text its own contract chose: also one line and capped.
 *  Keys are left as written: renaming one could make two keys collide. */
export const stringify = (v: unknown) =>
  JSON.stringify(v, (k, x) => {
    if (typeof x === 'bigint') return x.toString();
    if (typeof x !== 'string') return x;
    if (k === 'symbol' || k === 'name') return tokenText(x);
    if (k === 'reason') return tokenText(x, 200);
    return visibleText(x);
  }, 2);
