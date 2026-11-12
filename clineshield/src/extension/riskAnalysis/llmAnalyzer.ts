/**
 * llmAnalyzer.ts
 *
 * One Gemini request. The key travels only in the x-goog-api-key header: never
 * in the URL, a log line or a file. Never throws.
 */

export const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export type GeminiResult = { ok: true; explanation: string } | { ok: false; error: string };

export async function callGemini(key: string, prompt: string, fetchImpl: typeof fetch = fetch): Promise<GeminiResult> {
  let response: Response;
  try {
    response = await fetchImpl(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
  } catch {
    return { ok: false, error: 'network error' };
  }
  if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
  try {
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    const explanation = text ? (JSON.parse(text) as { explanation?: unknown }).explanation : undefined;
    if (typeof explanation === 'string' && explanation.trim()) return { ok: true, explanation: explanation.trim() };
  } catch {
    // fall through
  }
  return { ok: false, error: 'empty response' };
}
