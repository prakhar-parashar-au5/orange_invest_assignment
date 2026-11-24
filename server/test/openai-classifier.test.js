import { describe, it, expect, vi } from 'vitest';
import { createOpenAiClassifier } from '../src/categorise/openai-classifier.js';
import { CATEGORIES } from '../src/categories.js';

function okResponse(results) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ results }) } }] }),
  };
}

describe('createOpenAiClassifier', () => {
  it('returns null when there is no API key', () => {
    expect(createOpenAiClassifier({ apiKey: null, model: 'm' })).toBeNull();
  });

  it('sends one request with structured output restricted to the category enum', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse([
        { index: 0, category: 'Dining' },
        { index: 1, category: 'Shopping' },
      ]),
    );
    const classifier = createOpenAiClassifier({ apiKey: 'test-key', model: 'gpt-x', fetchImpl });

    const result = await classifier.classify(['CAFE NOIR', 'ZQX TRADERS']);

    expect(result).toEqual(['Dining', 'Shopping']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-x');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    const itemSchema = body.response_format.json_schema.schema.properties.results.items;
    expect(itemSchema.properties.category.enum).toEqual([...CATEGORIES]);
    expect(body.messages.at(-1).content).toContain('0: CAFE NOIR');
    expect(body.messages.at(-1).content).toContain('1: ZQX TRADERS');
  });

  it('puts results back in input order and leaves a missing index as null', async () => {
    const fetchImpl = vi.fn(async () => okResponse([{ index: 1, category: 'Health' }]));
    const classifier = createOpenAiClassifier({ apiKey: 'k', model: 'm', fetchImpl });

    expect(await classifier.classify(['A', 'B'])).toEqual([null, 'Health']);
  });

  it('throws on an HTTP error, so the categoriser can fall back', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const classifier = createOpenAiClassifier({ apiKey: 'k', model: 'm', fetchImpl });

    await expect(classifier.classify(['A'])).rejects.toThrow(/500/);
  });

  it('splits large inputs into batches', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const lines = JSON.parse(init.body).messages.at(-1).content.split('\n').filter((l) => /^\d+: /.test(l));
      return okResponse(lines.map((_, i) => ({ index: i, category: 'Shopping' })));
    });
    const classifier = createOpenAiClassifier({ apiKey: 'k', model: 'm', fetchImpl, batchSize: 2 });

    const result = await classifier.classify(['A', 'B', 'C']);

    expect(result).toEqual(['Shopping', 'Shopping', 'Shopping']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
