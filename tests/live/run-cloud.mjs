// `npm run test:cloud` — runs the live suite against Ollama Cloud instead of a local Ollama.
// Needs OLLAMA_API_KEY in the environment or in .env (never commit it). Works the same on
// Windows and macOS/Linux because the variables are set here rather than in the npm script.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

if (!process.env.OLLAMA_API_KEY?.trim()) {
  console.error('OLLAMA_API_KEY is not set. Add it to .env (kept out of git) or your shell, then run again.');
  process.exit(1);
}
const env = {
  ...process.env,
  OLLAMA_HOST: 'https://ollama.com',
  // The local .env names a local model; use the cloud default unless OLLAMA_CLOUD_MODEL says otherwise.
  OLLAMA_MODEL: process.env.OLLAMA_CLOUD_MODEL || 'gemma4:31b',
  OLLAMA_NUM_GPU: '',
};
const files = readdirSync('tests/live').filter((f) => f.endsWith('.test.js')).map((f) => `tests/live/${f}`);
console.log(`Testing Ollama Cloud with model ${env.OLLAMA_MODEL} (key from ${process.env.OLLAMA_API_KEY ? 'environment' : '—'}).`);
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=900000', ...files], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
