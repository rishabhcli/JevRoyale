import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
};

const EVENT_PROMPTS = {
  spawn: 'The match just started and you are dropping from the sky into the lobby.',
  kill_player: 'You just eliminated the human player. Gloat.',
  got_hit: 'The human player just shot you.',
  low_hp: 'You are almost dead and retreating.',
  eliminated: 'You just got eliminated. Say your dramatic last words.',
  player_built: 'The human player just built a wall to block your shots.',
  taunt: 'You can see the human player across the map. Taunt them.',
  kill_bot: 'You just eliminated another Jev bot.',
};

async function jevChat({ botName, personality, event, context }) {
  const situation = EVENT_PROMPTS[event] || 'Say something in the middle of the fight.';
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Jev Royale',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 60,
      temperature: 1.0,
      messages: [
        {
          role: 'system',
          content: `You are ${botName}, a bot in a cartoony battle royale game called Jev Royale. Personality: ${personality}. ` +
            'Reply with ONE short in-game chat line (max 14 words), playful PG trash talk, no quotes, no hashtags, no emojis.',
        },
        { role: 'user', content: `${situation} Context: ${JSON.stringify(context || {})}` },
      ],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/jev-chat') {
    try {
      const text = await jevChat(JSON.parse(await readBody(req) || '{}'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text }));
    } catch (err) {
      console.error('[jev-chat]', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Jev Royale running at http://localhost:${PORT} (model: ${MODEL})`));
