/**
 * /clineshield report (pure): counting and formatting from a fixture
 * metrics.json (SPEC.md "Terminal visibility").
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MetricsEvent } from '../../../types/metrics';
import { formatSummary, formatWhy, summarize, USAGE } from '../report';

const fixture: MetricsEvent[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'metrics.json'), 'utf-8'));
const noConfig = { warnings: [], onErrorAllow: false };
const before = (ts: string) => fixture.filter(e => e.timestamp < ts);

describe('summarize', () => {
  it('counts each action once: multi-file edits, and an ask refused then approved', () => {
    const s = summarize(fixture, 's1');
    expect(s.edits).toEqual({ allowed: 3, asked: 1, approved: 1, blocked: 1 });
    expect(s.commands).toEqual({ asked: 1, approved: 1, blocked: 1, scored: 1 });
  });

  it('an ask refused, then denied again at a prompt (false, false) counts once, for edits and commands', () => {
    const ev = (ts: string, type: string, data: Record<string, unknown>) => ({ timestamp: `2026-11-09T13:00:0${ts}.000Z`, sessionId: 's5', type, data });
    const edit = (f: string, approved: boolean) => ({ file: f, structuralChangePercent: 0, functionsDeleted: 0, exportsDeleted: 0, reason: 'r', approved });
    const cmd = (command: string, approved: boolean) => ({ command, tier: 'ask', score: 40, reasons: [], approved });
    const events = [
      ev('1', 'edit-approval', edit('a.ts', false)), ev('1', 'edit-approval', edit('b.ts', false)),
      ev('2', 'command-assessed', cmd('sudo x', false)),
      ev('3', 'edit-approval', edit('b.ts', false)), ev('3', 'edit-approval', edit('a.ts', false)),
      ev('4', 'command-assessed', cmd('sudo x', false)),
      ev('5', 'edit-approval', edit('a.ts', true)), ev('5', 'edit-approval', edit('b.ts', true)),
      ev('6', 'edit-approval', edit('a.ts', false)), ev('6', 'edit-approval', edit('b.ts', false)),
      ev('7', 'command-assessed', cmd('sudo y', false)),
    ] as unknown as MetricsEvent[];
    const s = summarize(events, 's5');
    expect(s.edits).toMatchObject({ asked: 2, approved: 1 });
    expect(s.commands).toMatchObject({ asked: 2, approved: 0 });
    expect(formatWhy(events.slice(0, 6), 's5')).toMatch(/Asked — not approved/);
  });

  it('riskiest files: highest score per file, highest first, this session only', () => {
    expect(summarize(fixture, 's1').riskiest).toEqual([
      { file: 'src/auth/login.ts', score: 75 },
      { file: 'src/a.ts', score: 55 },
      { file: 'src/c.ts', score: 25 },
      { file: 'src/b.ts', score: 20 },
    ]);
  });

  it('keeps at most 5 riskiest files', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      timestamp: `2026-11-09T12:00:0${i}.000Z`, sessionId: 's9', type: 'risk-assessed',
      data: { file: `f${i}.ts`, rulesScore: 10 + i, level: 'low', reasons: [] },
    })) as MetricsEvent[];
    expect(summarize(many, 's9').riskiest.map(r => r.file)).toEqual(['f7.ts', 'f6.ts', 'f5.ts', 'f4.ts', 'f3.ts']);
  });

  it('ignores other sessions', () => {
    const s = summarize(fixture, 'nope');
    expect(s.edits).toEqual({ allowed: 0, asked: 0, approved: 0, blocked: 0 });
    expect(s.commands).toEqual({ asked: 0, approved: 0, blocked: 0, scored: 0 });
    expect(s.riskiest).toEqual([]);
  });

  it('tolerates junk entries', () => {
    const junk = [null, 7, { type: 'edit-blocked' }, { sessionId: 's1', type: 'edit-blocked', timestamp: 'x' }] as unknown as MetricsEvent[];
    expect(() => summarize(junk, 's1')).not.toThrow();
    expect(() => formatWhy(junk, 's1')).not.toThrow();
  });
});

describe('formatSummary', () => {
  it('prints counts, riskiest files and the pointer to why', () => {
    const out = formatSummary(summarize(fixture, 's1'), noConfig);
    expect(out).toContain('3 allowed · 1 asked (1 approved) · 1 blocked');
    expect(out).toContain('1 asked (1 approved) · 1 blocked · 1 allowed with findings');
    expect(out).toContain("commands with no findings aren't logged");
    expect(out).toContain('src/auth/login.ts 75');
    expect(out).toContain('/clineshield why');
  });

  it('says so when the session has no activity, and still shows config lines', () => {
    const out = formatSummary(summarize(fixture, 'nope'), { warnings: ['~/.cline-shield.yml: unknown key "foo" ignored'], onErrorAllow: true });
    expect(out).toContain('No ClineShield activity in this session yet.');
    expect(out).toContain('~/.cline-shield.yml: unknown key "foo" ignored');
    expect(out).toContain('on_error: allow');
  });

  it('shows no config lines when there is nothing to say', () => {
    const out = formatSummary(summarize(fixture, 's1'), noConfig);
    expect(out).not.toMatch(/on_error|Config:/);
  });
});

describe('formatWhy', () => {
  it('shows the last ask/block of the session in full: categories, points, total, cut-offs', () => {
    const out = formatWhy(fixture, 's1');
    expect(out).toContain('Blocked');
    expect(out).toContain('rm -rf /');
    expect(out).toContain('rm_outside');
    expect(out).toContain('Total: 100');
    expect(out).toContain('Cut-offs: ask 40 · block 70');
  });

  it('a blocked edit lists each category with its points', () => {
    const out = formatWhy(before('2026-11-09T11:00:08'), 's1');
    expect(out).toContain('src/auth/login.ts');
    expect(out).toMatch(/protected_path\s+30/);
    expect(out).toMatch(/auth_removed\s+45/);
    expect(out).toContain('Total: 75');
  });

  it('a multi-file ask shows every file and that it was approved', () => {
    const out = formatWhy(before('2026-11-09T11:00:07'), 's1');
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/c.ts');
    expect(out).toMatch(/approved/i);
    expect(out).toContain('Total: 55');
    expect(out).toContain('Total: 25');
  });

  it('an asked command that was refused says so', () => {
    const out = formatWhy(before('2026-11-09T11:00:10'), 's1');
    expect(out).toContain('sudo apt-get install jq');
    expect(out).toMatch(/not approved/i);
  });

  it('events logged before points were recorded show the reason text', () => {
    const out = formatWhy(fixture, 's0');
    expect(out).toContain('an old reason');
    expect(out).toContain('points not recorded');
  });

  it('no asks or blocks → clear message', () => {
    expect(formatWhy(fixture, 's2-none')).toBe('No asks or blocks in this session.');
  });

  it('never prints allowed commands as the last ask/block', () => {
    const allowedOnly = fixture.filter(e => e.sessionId === 's1' && e.type === 'command-assessed' && e.data.tier === 'allow');
    expect(formatWhy(allowedOnly, 's1')).toBe('No asks or blocks in this session.');
  });
});

it('USAGE names both forms', () => {
  expect(USAGE).toBe('Usage: /clineshield [why]');
});
