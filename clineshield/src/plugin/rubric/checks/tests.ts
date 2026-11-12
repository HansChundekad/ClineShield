/**
 * tests.ts
 *
 * Weakening-safety categories with per-language pattern packs
 * (JS/TS, Python, Go, Java/Kotlin, Rust, Ruby).
 */

import { isTestPath, languageOf, testStem } from '../paths';
import type { Language } from '../paths';
import type { Check, FileChange, RawFinding } from '../types';

type Pack = Record<Language, RegExp>;

const SKIP: Pack = {
  js: /\b(it|test|describe)\.(skip|todo)\s*\(|\bx(it|test|describe)\s*\(/,
  py: /@(pytest\.mark\.skip(if)?|unittest\.skip\w*)|\bpytest\.skip\s*\(/,
  go: /\bt\.Skip(f|Now)?\s*\(/,
  java: /@(Ignore|Disabled)\b/,
  rs: /#\[ignore\]/,
  rb: /^\s*(xit|xdescribe|xcontext)\b|\bskip\s*(\(|['"]|$)/,
};

const DISABLE: Pack = {
  js: /eslint-disable|@ts-(ignore|nocheck|expect-error)/,
  py: /#\s*(noqa|type:\s*ignore|pylint:\s*disable)/,
  go: /\/\/\s*nolint/,
  java: /@SuppressWarnings\b/,
  rs: /#!?\[allow\(/,
  rb: /rubocop:disable/,
};

const TEST_DECL: Pack = {
  js: /\b(it|test)\s*\(\s*['"`]/,
  py: /^\s*(async\s+)?def\s+test_\w*/,
  go: /^func\s+Test\w*\s*\(/,
  java: /@Test\b/,
  rs: /#\[(tokio::)?test\]/,
  rb: /^\s*(it|test)\s+['"]/,
};

const ASSERT: Pack = {
  js: /\bexpect\s*\(|\bassert(\.\w+)?\s*\(/,
  py: /^\s*assert\b|\bself\.assert\w+\s*\(/,
  go: /\b(assert|require)\.\w+\s*\(|\bt\.(Error|Fatal)f?\s*\(/,
  java: /\bassert\w*\s*\(/,
  rs: /\bassert(_eq|_ne)?!\s*\(/,
  rb: /\bexpect\s*\(|\bassert(_\w+)?\b/,
};

const STRONG: Partial<Pack> = {
  js: /\.(toBe|toEqual|toStrictEqual|toThrow\w*|toHaveBeenCalledWith|toMatch\w*)\s*\(/,
  py: /\bassert(Equal|Raises|In|Is|DictEqual|ListEqual)\b|==/,
};
const WEAK: Partial<Pack> = {
  js: /\.(toBeDefined|toBeTruthy|toBeFalsy|not\.toBeNull|not\.toThrow)\s*\(\s*\)|\.toBeGreaterThan(OrEqual)?\s*\(\s*0\s*\)/,
  py: /\bassert(True|IsNotNone|False)\b/,
};

const LANGS_FALLBACK: Language[] = ['js', 'py'];
const packFor = (p: Pack, lang: Language | undefined) => (lang ? [p[lang]] : LANGS_FALLBACK.map(l => p[l]));
const count = (lines: string[], rs: RegExp[]) => lines.filter(l => rs.some(r => r.test(l))).length;
const LITERAL = /(['"`])(?:\\.|(?!\1).)*\1|\b\d+(\.\d+)?\b/g;

export const testsCheck: Check = {
  name: 'tests',
  kind: 'signal',
  run(c: FileChange) {
    const out: RawFinding[] = [];
    const lang = languageOf(c.path);
    const add = (category: RawFinding['category'], detail: string) => out.push({ category, weight: 1, detail });

    if (count(c.added, packFor(SKIP, lang)) > 0) add('tests_skipped', 'marks tests as skipped');
    if (count(c.added, packFor(DISABLE, lang)) > 0) add('checks_disabled', 'disables a lint or type check');
    if (!c.isTest) return out;

    const decl = packFor(TEST_DECL, lang);
    if (c.kind === 'delete') add('tests_deleted', `deletes test file ${c.path}`);
    else if (count(c.removed, decl) > count(c.added, decl)) add('tests_deleted', `removes ${count(c.removed, decl) - count(c.added, decl)} test case(s)`);

    const asserts = packFor(ASSERT, lang);
    let weakened = c.kind !== 'delete' && count(c.removed, asserts) > count(c.added, asserts);
    let expectedChanged = false;
    for (const h of c.hunks) {
      const strong = lang && STRONG[lang];
      const weak = lang && WEAK[lang];
      if (strong && weak && h.removed.some(l => strong.test(l)) && h.added.some(l => weak.test(l))) weakened = true;
      const rem = h.removed.filter(l => asserts.some(r => r.test(l)));
      const addA = h.added.filter(l => asserts.some(r => r.test(l)));
      for (const r of rem) {
        const shape = r.trim().replace(LITERAL, '_');
        if (addA.some(a => a.trim() !== r.trim() && a.trim().replace(LITERAL, '_') === shape)) expectedChanged = true;
      }
    }
    if (weakened) add('assertions_weakened', 'removes or weakens assertions');
    if (expectedChanged) add('expected_changed', 'changes expected values in assertions');
    return out;
  },
};

/** test_and_source after a failed test run: 2 × 15 = 30 by default (owner: noted, never asks alone on balanced). */
export const FAILED_RUN_WEIGHT = 2;

export const testAndSource: Check = {
  name: 'test_and_source',
  kind: 'signal',
  perAction: true,
  run(_c, a) {
    const tests = a.changes.some(c => c.isTest);
    const source = a.changes.some(c => !c.isTest && languageOf(c.path) !== undefined);
    const failed = a.session?.lastTestFailed === true;
    const after = failed ? ', after a failed test run' : '';
    // ④: one finding, bigger after a failed run, so the per-group rule can't drop the extra points on its own.
    const hit = (detail: string): RawFinding[] => [{ category: 'test_and_source', weight: failed ? FAILED_RUN_WEIGHT : 1, detail: detail + after }];
    if (tests && source) return hit('changes tests and source code in one action');
    // ④: Cline's editor tool changes one file per call, so also pair with a matching file edited recently.
    const recent = a.session?.recentEdits() ?? [];
    for (const c of a.changes) {
      if (languageOf(c.path) === undefined) continue;
      const other = recent.find(p => p !== c.path && isTestPath(p) !== c.isTest && languageOf(p) !== undefined && testStem(p) === testStem(c.path));
      if (!other) continue;
      const [src, test] = c.isTest ? [other, c.path] : [c.path, other];
      return hit(`changes ${src} and its test ${test} within 10 minutes`);
    }
    return [];
  },
};
