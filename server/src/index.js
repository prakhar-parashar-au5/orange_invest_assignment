import { loadConfig } from './config.js';
import { createPool, createReadOnlyPool } from './db.js';
import { createApp } from './app.js';

// No .env file in v1 (PROJECT.md). Pass env vars on the command line, e.g.
//   OPENAI_API_KEY=... PORT=4100 CLIENT_ORIGIN=http://localhost:5180 npm start
const config = loadConfig(process.env);
const db = createPool(config.databaseUrl);
// The agent's tools use this pool: same DATABASE_URL, every session READ ONLY.
const dbReadonly = createReadOnlyPool(config.databaseUrl);

const app = createApp({ config, db, dbReadonly });

app.listen(config.port, () => {
  const llm = config.openaiApiKey ? `OpenAI ${config.openaiModel}` : 'no OPENAI_API_KEY: chat and the LLM category fallback are off';
  console.log(`orange-invest server listening on port ${config.port} (${config.nodeEnv}; ${llm})`);
});
