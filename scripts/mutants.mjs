#!/usr/bin/env node
// Mutation catalogue for scripts/test-properties.mjs — every check there names the mutant
// that must turn it red. A check that stays green on its mutant proves nothing.
//
//   node scripts/mutants.mjs            run all (one at a time; never alongside `npm test`)
//   node scripts/mutants.mjs 7 12       run ATQ-periferia-7 and -12
//
// The tests run against dist/, so every mutant is compiled (tsc) before the suite runs and
// dist/ is rebuilt from the restored source at the end.
// Verdict is by the NAME of the paired check, not by the exit code:
//   KILLED        every paired check printed ✗
//   SURVIVED      the suite reached its summary line and a paired check stayed green
//   INCONCLUSIVE  the build failed, or the suite crashed or timed out before the summary
//   STALE         `old` does not occur exactly once in the file (the source moved)
// The source file is restored after every run; the script fails if src/ is left dirty.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const SUITE = ['node', 'scripts/test-properties.mjs'];
const BUILD = ['npx', 'tsc'];
const T = 'src/text.ts';
const S = 'src/server.ts';
/** The source spells its ranges as escapes; `u('200b')` is that spelling, backslash included. */
const u = (h) => `\\u${h}`;
const CC = 'tokenText: every control character (Unicode Cc)';
const DIR = 'tokenText: every direction mark, embedding, override and isolate';
const ZW = 'tokenText: the zero-width space, joiners';
const TAG = 'tokenText: every tag character';
const WS = 'tokenText: any run of whitespace becomes one space';
const CAP = 'tokenText: the cap is exact';
const URLS = 'scrubUrls: path, query, fragment and userinfo are gone';
const FAULTS = ['get_quote', 'build_swap', 'simulate_swap', 'get_token_info', 'check_solvency'].map((t) => `faults: ${t} answers an error envelope`);

/** [file, old, new, paired check name prefix(es), opt?] — the id is the position, 1-based. */
const M = [
  // text.ts — tokenText: one mutant per boundary of every range it removes
  [T, `${u('0000')}-${u('001f')}`, `${u('0001')}-${u('001f')}`, CC],
  [T, `${u('0000')}-${u('001f')}`, `${u('0000')}-${u('001e')}`, CC],
  [T, `${u('007f')}-${u('009f')}`, `${u('0080')}-${u('009f')}`, CC],
  [T, `${u('007f')}-${u('009f')}`, `${u('007f')}-${u('009e')}`, CC],
  [T, `${u('200b')}-${u('200f')}`, `${u('200b')}-${u('200d')}`, DIR],
  [T, `${u('200b')}-${u('200f')}`, `${u('200e')}-${u('200f')}`, ZW],
  [T, `${u('2028')}-${u('202e')}`, `${u('2028')}-${u('202d')}`, DIR],
  [T, `${u('2028')}-${u('202e')}`, `${u('202b')}-${u('202e')}`, DIR],
  [T, `${u('2066')}-${u('2069')}`, `${u('2067')}-${u('2069')}`, DIR],
  [T, `${u('2066')}-${u('2069')}`, `${u('2066')}-${u('2068')}`, DIR],
  [T, `    .replace(/[\\u{E0000}-\\u{E007F}]/gu, '') //`, '    //', TAG],
  [T, `[\\u{E0000}-\\u{E007F}]/gu, '')`, `[\\u{E0000}-\\u{E007F}]/gu, ' ')`, TAG],
  [T, `\\u{E0000}-\\u{E007F}`, `\\u{E0001}-\\u{E007F}`, TAG],
  [T, `\\u{E0000}-\\u{E007F}`, `\\u{E0000}-\\u{E007E}`, TAG],
  [T, `    .replace(/\\s+/g, ' ')\n`, '', WS],
  [T, `.replace(/\\s+/g, ' ')`, `.replace(/\\s/g, ' ')`, WS],
  [T, '    .trim();', '    ;', WS],
  [T, `${u('007f')}-${u('009f')}`, `${u('007f')}-${u('00ff')}`, 'tokenText: visible text within the cap is returned as written'],
  [T, 't.length > max ?', 't.length >= max ?', CAP],
  [T, 't.slice(0, max)', 't.slice(0, max + 1)', CAP],
  [T, 'max = 64', 'max = 65', 'tokenText: the default cap is 64 units'],
  [T, "String(s ?? '')", 'String(s)', 'tokenText: what is not a string becomes text'],
  // text.ts — scrubUrls
  [T, '(?:https?|wss?)', '(?:https?)', URLS],
  [T, '(?:https?|wss?)', '(?:https|wss?)', URLS],
  [T, ']+/gi, (m)', ']+/g, (m)', URLS],
  [T, "u.pathname.length > 1 ? '/…' : ''", 'u.pathname', URLS],
  [T, '${u.protocol}//${u.host}', '${u.protocol}//${u.username}:${u.password}@${u.host}', URLS],
  [T, ']+/gi, (m)', ']+/i, (m)', 'scrubUrls: every URL in the text is scrubbed, not only the first'],
  [T, "u.pathname.length > 1 ? '/…' : ''", "'/…'", 'scrubUrls: a URL with nothing after the host is left whole'],
  [T, "return '<url>';", 'return m;', 'scrubUrls: a URL the parser refuses is replaced whole'],
  [T, '\\b(?:https?|wss?):\\/\\/', '\\b', 'scrubUrls: text without a URL comes back as given'],
  // server.ts — what reaches the agent
  [S, "(k === 'symbol' || k === 'name')", "(k === 'symbol')", 'get_token_info: a symbol and a name chosen by the token'],
  [S, "(k === 'symbol' || k === 'name')", "(k === 'name')", 'get_token_info: a symbol and a name chosen by the token'],
  [S, "if (typeof x === 'bigint') return x.toString();", "if (typeof x === 'bigint') return Number(x).toString();", 'get_quote: amount "1" is 10^d base units'],
  [S, "typeof err.code === 'string' ? err.code : 'error'", "'error'", ['get_quote: more fractional digits', 'chain id: a node that answers chain 1', 'amounts: amount and amountIn together']],
  [S, 'if (a.amount && a.amountIn) {', 'if (false) {', 'amounts: amount and amountIn together'],
  [S, 'if (!a.amount && !a.amountIn) {', 'if (!a.amount) {', 'faults: between the two sweeps the same node, healthy, quotes'],
  [S, 'isError: true,', 'isError: false,', FAULTS],
  [S, 'stringify({ ok: false, code,', 'stringify({ ok: true, code,', FAULTS],
  // The server scrubs every error once more on its way out. The SDK it is built on already
  // answers without the URL, so whether any check can see this second wall is measured here.
  [S, 'error: scrubUrls(error)', 'error: error', FAULTS, { measure: 'second wall behind the SDK: SURVIVED means no fault in this suite gets a URL past the SDK' }],
];

const only = process.argv.slice(2).map(Number);
const rows = [];
const dead = new Set();   // paired name prefixes with a killed mutant
const build = () => spawnSync(BUILD[0], BUILD.slice(1), { encoding: 'utf8', timeout: 180_000 });
const suite = () => spawnSync(SUITE[0], SUITE.slice(1), { encoding: 'utf8', timeout: 180_000 });
if (build().status !== 0) { console.error('the clean source does not build'); process.exit(2); }
const clean = only.length ? '' : suite().stdout ?? '';
if (!only.length && !/^properties: \d+ passed, 0 failed$/m.test(clean)) { console.error('the suite is not green before any mutant — fix that first'); process.exit(2); }
for (const [i, [file, old, neu, tests, opt]] of M.entries()) {
  const id = `ATQ-periferia-${i + 1}`;
  if (only.length && !only.includes(i + 1)) continue;
  const names = [tests].flat();
  const src = readFileSync(file, 'utf8');
  let verdict, note = '';
  if (src.split(old).length !== 2) { verdict = 'STALE'; } else {
    try {
      // the marker goes on the first line, or right under a shebang (tsc refuses `#!` anywhere else)
      const out = src.replace(old, () => neu);
      const nl = out.startsWith('#!') ? out.indexOf('\n') + 1 : 0;
      writeFileSync(file, `${out.slice(0, nl)}// MUTANT ${id}\n${out.slice(nl)}`);
      const b = build();
      if (b.status !== 0) { verdict = 'INCONCLUSIVE'; note = `the mutant does not build: ${`${b.stdout}`.trim().split('\n')[0]?.slice(0, 160)}`; } else {
        const run = suite();
        const text = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
        const red = text.split('\n').filter((l) => l.startsWith('  ✗ ')).map((l) => l.slice(4));
        const reached = /^properties: \d+ passed, \d+ failed$/m.test(text);
        const hit = names.filter((n) => red.some((l) => l.startsWith(n)));
        verdict = !reached ? 'INCONCLUSIVE' : hit.length === names.length ? 'KILLED' : 'SURVIVED';
        if (verdict !== 'KILLED') note = reached ? `green: ${names.filter((n) => !hit.includes(n)).join(' | ')}; red elsewhere: ${red.length}` : `rc ${run.status} ${run.signal ?? ''} ${text.trim().split('\n').pop()?.slice(0, 160)}`;
      }
    } finally { writeFileSync(file, src); }
  }
  if (opt?.measure) { note = `${opt.measure} — got ${verdict}${note ? ` (${note})` : ''}`; verdict = verdict === 'KILLED' || verdict === 'SURVIVED' ? `MEASURED-${verdict}` : verdict; }
  rows.push({ id, verdict });
  if (verdict.endsWith('KILLED')) names.forEach((x) => dead.add(x));
  console.log(`${verdict.padEnd(17)} ${id.padEnd(18)} ${file.padEnd(14)} ${names[0].slice(0, 60)}${names.length > 1 ? ` (+${names.length - 1})` : ''}${note ? `\n                  ${note}` : ''}`);
}
const rebuilt = build().status === 0;
const dirty = spawnSync('git', ['status', '--porcelain', '--', 'src'], { encoding: 'utf8' }).stdout.trim();
const marker = spawnSync('grep', ['-rl', '// MUTANT', 'src', 'dist'], { encoding: 'utf8' }).stdout.trim();
const n = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`\n${rows.length} mutants: ${n('KILLED')} killed, ${n('SURVIVED')} survived, ${n('INCONCLUSIVE')} inconclusive, ${n('STALE')} stale, measured ${n('MEASURED-KILLED')} killed / ${n('MEASURED-SURVIVED')} survived`);
// Completeness: every check of the clean run must be the paired check of a killed mutant.
const orphans = clean.split('\n').filter((l) => l.startsWith('  ✓ ')).map((l) => l.slice(4)).filter((c) => ![...dead].some((p) => c.startsWith(p)));
if (!only.length) console.log(`checks without a dead mutant: ${orphans.length}${orphans.map((o) => `\n  - ${o}`).join('')}`);
if (!rebuilt || dirty || marker) { console.error(`not clean after the run (rebuilt: ${rebuilt}):\n${dirty}\n${marker}`); process.exit(2); }
process.exit(rows.every((r) => r.verdict === 'KILLED' || r.verdict.startsWith('MEASURED-')) && orphans.length === 0 ? 0 : 1);
