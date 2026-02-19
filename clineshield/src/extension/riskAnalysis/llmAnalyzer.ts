/**
 * llmAnalyzer.ts
 *
 * Async Gemini caller for Phase 6 LLM risk assessment.
 * Returns null silently on any failure — never throws, never blocks.
 */

import type { RiskReason } from './rulesEngine';

export interface GeminiAnalysis {
  summary: string;
  risks: string[];
  confidence: 'low' | 'medium' | 'high';
}

const MAX_DIFF_CHARS = 4000;
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export async function callGemini(
  diff: string,
  filePath: string,
  rulesScore: number,
  reasons: RiskReason[]
): Promise<GeminiAnalysis | null> {
  const key = process.env.CLINESHIELD_GEMINI_KEY;
  if (!key) {
    return null;
  }

  try {
    const truncatedDiff =
      diff.length > MAX_DIFF_CHARS
        ? diff.slice(0, MAX_DIFF_CHARS) + '\n... [truncated]'
        : diff;

    const reasonsSummary =
      reasons.length > 0
        ? reasons.map(r => `- ${r.description} (+${r.points})`).join('\n')
        : '- None';

    const prompt = `You are a code review assistant. Analyze this code change and assess its risk.

File: ${filePath}
Rules-based risk score: ${rulesScore}/100
Rules that fired:
${reasonsSummary}

Diff:
${truncatedDiff}

Respond with JSON only, no markdown fences:
{
  "summary": "1-2 sentence description of what changed and the overall risk",
  "risks": ["specific risk 1", "specific risk 2"],
  "confidence": "low|medium|high"
}

"confidence" reflects how certain you are in the assessment based on diff clarity.`;

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
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

    if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.risks)) {
      return null;
    }

    const confidence = (['low', 'medium', 'high'] as const).includes(
      parsed.confidence as 'low' | 'medium' | 'high'
    )
      ? (parsed.confidence as 'low' | 'medium' | 'high')
      : 'low';

    return {
      summary: parsed.summary,
      risks: parsed.risks.filter((r): r is string => typeof r === 'string'),
      confidence,
    };
  } catch {
    return null;
  }
}
