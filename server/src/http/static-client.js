// Production: Express serves the built React app (client/dist) next to the API, so browser and API
// share one origin and the SameSite=Lax session cookie just works.
//   - Hashed files under /assets are cached for a year; index.html is never cached.
//   - Any other GET that isn't /api and has no file extension gets index.html (client-side routes).
//   - /api/* never falls back: unknown API routes stay JSON 404s.
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';

export function serveClient(app, distDir) {
  const index = path.join(distDir, 'index.html');
  if (!existsSync(index)) {
    console.warn(`client build not found at ${distDir}; serving the API only`);
    return;
  }
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders(res, file) {
        res.set('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/api' || req.path.startsWith('/api/')) return next();
    if (path.extname(req.path)) return next(); // a missing file is a 404, not the app
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(index);
  });
}
