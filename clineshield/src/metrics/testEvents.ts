/**
 * testEvents.ts
 *
 * Sample 2.0 events for the "ClineShield: Generate Test Metrics" dev command:
 * an allowed edit, an ask refused then approved, a blocked edit and a blocked
 * command (left waiting). Pure.
 */

import type { MetricsEvent } from '../types/metrics';

export function testEvents(sessionId: string, now: number): MetricsEvent[] {
  const ts = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();
  const cutoffs = { ask: 40, block: 70 };
  const edit = { structuralChangePercent: 0, functionsDeleted: 0, exportsDeleted: 0 };
  const askReasons = [
    { rule: 'protected_path', points: 30, description: 'Protected path (src/auth/**)' },
    { rule: 'exports_removed', points: 18, description: 'Removes 2 exported functions' },
  ];
  const blockReasons = [
    { rule: 'functions_removed', points: 45, description: '4 functions removed' },
    { rule: 'rewrite_share', points: 40, description: 'Rewrites 91% of the file' },
  ];
  const askReason = "ClineShield: this edit needs the user's approval.";
  return [
    { timestamp: ts(10), sessionId, type: 'edit-allowed', data: { file: 'package.json', ...edit } },
    { timestamp: ts(10), sessionId, type: 'risk-assessed', data: { file: 'package.json', rulesScore: 15, level: 'low', reasons: [{ rule: 'manifest', points: 15, description: 'Dependency manifest changed' }] } },
    { timestamp: ts(8), sessionId, type: 'edit-approval', data: { file: 'src/auth/login.ts', ...edit, structuralChangePercent: 60, exportsDeleted: 2, reason: askReason, approved: false, score: 48, reasons: askReasons, cutoffs } },
    { timestamp: ts(7), sessionId, type: 'edit-approval', data: { file: 'src/auth/login.ts', ...edit, structuralChangePercent: 60, exportsDeleted: 2, reason: askReason, approved: true, score: 48, reasons: askReasons, cutoffs } },
    { timestamp: ts(7), sessionId, type: 'risk-assessed', data: { file: 'src/auth/login.ts', rulesScore: 48, level: 'medium', reasons: askReasons } },
    { timestamp: ts(5), sessionId, type: 'edit-blocked', data: { file: 'src/auth/session.ts', ...edit, structuralChangePercent: 91, functionsDeleted: 4, reason: 'ClineShield blocked this action.', score: 85, reasons: blockReasons, cutoffs } },
    { timestamp: ts(0), sessionId, type: 'command-assessed', data: { command: 'rm -rf ../shared-config', tier: 'block', score: 75, reasons: [{ rule: 'rm_outside', points: 75, description: 'Deletes outside the workspace' }], cutoffs } },
  ];
}
