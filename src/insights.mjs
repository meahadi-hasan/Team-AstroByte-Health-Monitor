import { insightFacts } from './domain.mjs';

export async function summarize(latest, history, requestAI, apiKey, fetcher = fetch) {
  const facts = insightFacts(latest, history);
  if (!requestAI) return { mode: 'local', facts };
  const fallback = message => ({ mode: 'local', facts, message });
  if (!latest || latest.source !== 'synthetic') return fallback('External prioritization is available for synthetic observations only.');
  if (!apiKey) return fallback('The optional OpenAI integration is unconfigured.');
  if (facts.length < 4) return fallback('The local summary already includes all available observations.');
  try {
    const response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        store: false,
        instructions: 'For a synthetic space health demo, prioritize three distinct indices from the supplied monitoring observations for a handover. Return only JSON with the indices array. Use zero-based indices.',
        input: JSON.stringify(facts.map((text, index) => ({ index, text }))),
        max_output_tokens: 140,
        text: { format: { type: 'json_schema', name: 'priorities', strict: true, schema: {
          type: 'object', properties: { indices: { type: 'array', items: { type: 'integer' } } },
          required: ['indices'], additionalProperties: false
        } } }
      })
    });
    if (!response.ok) throw new Error('Upstream AI error');
    const result = await response.json();
    const output = result.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
    const { indices } = JSON.parse(output);
    if (!Array.isArray(indices) || indices.length !== 3 || new Set(indices).size !== 3 ||
        indices.some(index => !Number.isInteger(index) || index < 0 || index >= facts.length - 1)) {
      throw new Error('Invalid AI prioritization');
    }
    return { mode: 'openai-prioritized', facts: [...indices.map(index => facts[index]), ...facts.filter((_, i) => !indices.includes(i))] };
  } catch {
    return fallback('External prioritization was unavailable. Showing locally generated findings.');
  }
}
