// Artifacts (API-CONTRACT.md v1.7): four read-only project pages from docs/artifacts/.
// The name is looked up in a fixed allowlist that maps to fixed file names, so user input never
// becomes part of a path. Any logged-in user may read them; they hold no user data.
import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notFound } from '../http/errors.js';
import { requireUser } from '../auth/session.js';

export const DEFAULT_ARTIFACTS_DIR = fileURLToPath(new URL('../../../docs/artifacts', import.meta.url));

export const ARTIFACTS = [
  { name: 'requirements', title: 'Requirements and decisions', file: '01-requirements-and-decisions.md', data: {} },
  { name: 'architecture', title: 'Architecture', file: '02-architecture.md', data: { schema: 'schema.json', request_flow: 'request-flow.json' } },
  { name: 'built-with-ai', title: 'How it was built with AI agents', file: '03-built-with-ai.md', data: {} },
  { name: 'quality', title: 'Quality: tests, performance, evals', file: '04-quality.md', data: { quality: 'quality.json' } },
];
const BY_NAME = new Map(ARTIFACTS.map((a) => [a.name, a]));

function headers(res) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
}

export function artifactsRouter({ config, dir = DEFAULT_ARTIFACTS_DIR }) {
  const router = Router();
  const auth = requireUser(config);

  router.get('/artifacts', auth, (_req, res) => {
    headers(res);
    res.json({ artifacts: ARTIFACTS.map(({ name, title }) => ({ name, title })) });
  });

  router.get('/artifacts/:name', auth, async (req, res) => {
    const a = BY_NAME.get(req.params.name);
    if (!a) throw notFound('No such artifact');
    const markdown = await readFile(path.join(dir, a.file), 'utf8');
    const entries = await Promise.all(
      Object.entries(a.data).map(async ([key, file]) => {
        try {
          return [key, JSON.parse(await readFile(path.join(dir, file), 'utf8'))];
        } catch {
          return [key, null]; // not generated yet: run npm run artifacts:build
        }
      }),
    );
    headers(res);
    res.json({ name: a.name, title: a.title, markdown, data: entries.length ? Object.fromEntries(entries) : null });
  });

  return router;
}
