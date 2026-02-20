/**
 * llmAnalyzer.ts
 *
 * Async Gemini caller for Phase 6 LLM risk assessment.
 * Returns null silently on any failure — never throws, never blocks.
 */

import type { RiskReason } from './rulesEngine';

export interface GeminiAnalysis {
  explanation: string;
}

const MAX_DIFF_CHARS = 4000;
const MAX_FILE_CHARS = 8000;
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export async function callGemini(
  diff: string,
  fileContents: string,
  filePath: string,
  rulesScore: number,
  reasons: RiskReason[]
): Promise<GeminiAnalysis | null> {
  const key = process.env.CLINESHIELD_GEMINI_KEY;
  if (!key) {
    console.log('[CS:llm] callGemini — no key, returning null');
    return null;
  }
  console.log('[CS:llm] callGemini — key present, sending request');

  try {
    const truncatedDiff =
      diff.length > MAX_DIFF_CHARS
        ? diff.slice(0, MAX_DIFF_CHARS) + '\n... [truncated]'
        : diff;

    const truncatedFile =
      fileContents.length > MAX_FILE_CHARS
        ? fileContents.slice(0, MAX_FILE_CHARS) + '\n... [truncated]'
        : fileContents;

    const reasonsSummary =
      reasons.length > 0
        ? reasons.map(r => `- ${r.description} (+${r.points})`).join('\n')
        : '- None';

    const diffSection = truncatedDiff
      ? `Diff (what changed):\n${truncatedDiff}`
      : 'Diff: (not available — write_to_file or sidecar mismatch)';

    const fileSection = truncatedFile
      ? `Post-edit file contents:\n${truncatedFile}`
      : '';

    const prompt = `You are a code review assistant. A rules engine has already scored this edit as ${rulesScore}/100 risk and flagged the following rules:
${reasonsSummary}

File: ${filePath}

${diffSection}

${fileSection}

In 2-3 sentences, explain why this specific edit is risky based on what the code actually does. Focus on the code behaviour — do not restate the rules, do not produce a score or confidence level.

Respond with JSON only, no markdown fences:
{ "explanation": "..." }`;

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      console.log(`[CS:llm] callGemini — HTTP ${response.status} ${response.statusText}`);
      return null;
    }

    const body = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return null;
    }

    const parsed = JSON.parse(text) as Partial<GeminiAnalysis>;

    if (typeof parsed.explanation !== 'string' || !parsed.explanation.trim()) {
      return null;
    }

    return { explanation: parsed.explanation };
  } catch (e) {
    console.log(`[CS:llm] callGemini — caught error: ${(e as Error).message}`);
    return null;
  }
}
