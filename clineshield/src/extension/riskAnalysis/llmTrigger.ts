/**
 * llmTrigger.ts
 *
 * Processes a single risk-assessed event: reads the diff sidecar, reads the
 * post-edit file, calls Gemini, and appends an llm-analysis event.
 *
 * Called fire-and-forget (void) from the metrics.json watcher in extension.ts.
 * The watcher owns the seen Set and deduplication logic.
 *
 * Never throws — LLM analysis is best-effort.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { RiskAssessedEvent } from '../../types/metrics';
import { appendEvent } from '../../metrics/writer';
import { callGemini } from './llmAnalyzer';

export type GeminiCaller = typeof callGemini;

const MAX_FILE_CHARS = 8000;

export async function processRiskEvent(
  riskEvent: RiskAssessedEvent,
  sessionId: string,
  workspaceRoot: string,
  geminiCaller: GeminiCaller = callGemini
): Promise<void> {
  try {
    const { file, rulesScore, reasons } = riskEvent.data;
    console.log(`[CS:llm] processRiskEvent start — file:${file} score:${rulesScore}`);

    // Read diff sidecar — match on file path to guard against race overwrites
    let diff = '';
    try {
      const sidecarPath = path.join(workspaceRoot, '.cline-shield', 'diff-context.json');
      const raw = await fs.readFile(sidecarPath, 'utf-8');
      const sidecar = JSON.parse(raw) as { file?: string; diff?: string };
      if (sidecar.file === file && typeof sidecar.diff === 'string') {
        diff = sidecar.diff;
        console.log(`[CS:llm] sidecar matched — diff length:${diff.length}`);
      } else {
        console.log(`[CS:llm] sidecar mismatch — sidecar.file:${sidecar.file} event.file:${file}`);
      }
    } catch (e) {
      console.log(`[CS:llm] sidecar read failed — ${(e as Error).message}`);
    }

    // Read post-edit file contents (capped to avoid token bloat)
    let fileContents = '';
    try {
      const fullPath = path.join(workspaceRoot, file);
      const raw = await fs.readFile(fullPath, 'utf-8');
      fileContents = raw.length > MAX_FILE_CHARS
        ? raw.slice(0, MAX_FILE_CHARS) + '\n... [truncated]'
        : raw;
      console.log(`[CS:llm] file read ok — length:${fileContents.length}`);
    } catch (e) {
      console.log(`[CS:llm] file read failed — ${(e as Error).message}`);
    }

    console.log(`[CS:llm] calling Gemini...`);
    const startMs = Date.now();
    const result = await geminiCaller(diff, fileContents, file, rulesScore, reasons);
    console.log(`[CS:llm] Gemini returned — ${result ? 'got explanation' : 'null (failed or no key)'} in ${Date.now() - startMs}ms`);

    if (!result) { return; }

    await appendEvent(
      {
        timestamp: new Date().toISOString(),
        sessionId,
        type: 'llm-analysis',
        data: {
          file,
          relatedRiskEventTimestamp: riskEvent.timestamp,
          reasoning: result.explanation,
          model: 'gemini-2.5-flash',
          duration: (Date.now() - startMs) / 1000,
        },
      },
      workspaceRoot
    );
  } catch {
    // Never surface — LLM analysis is best-effort
  }
}
