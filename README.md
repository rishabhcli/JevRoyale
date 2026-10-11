# Jev Royale

A browser battle royale. Drop onto the island, fight five Jev bots, build, and stay inside the storm until one of you is left.

## Run

You need Node.js 18 or newer. The game has no install step. Three.js loads from a CDN, so the browser needs internet when you play.

```bash
cp .env.example .env   # first time only, if you do not already have a .env
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

`npm start` runs `node server.js`. The server defaults to port 3000.

### Bot chat

Each Jev can send a short trash-talk line through OpenRouter. Put this in `.env`:

```bash
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-4o-mini
PORT=3000
```

`OPENROUTER_MODEL` and `PORT` are optional. If the key is missing or the request fails, bots still talk using built-in lines. Do not commit `.env`.

## Play

Click the menu or press a key to start the lobby music, then **Drop In**. You spawn in the sky. Look down to dive faster. Press **Space** to open the glider (it also opens on its own when you get low). Steer with **WASD** until you land.

Last player standing wins. The storm shrinks in phases. Standing outside it drains your health.

| Key | Action |
|---|---|
| **W A S D** | Move |
| **Shift** | Sprint |
| **Space** | Jump, or open the glider while dropping |
| **C** | Crouch |
| **Mouse** | Look and shoot |
| **Right mouse** | Aim down sights |
| **1–5** or **scroll** | Pickaxe, rifle, pump, SMG, rocket |
| **R** | Reload |
| **Q** | Wall |
| **E** | Ramp |
| **F** | Floor |
| **V** | Third person |

Click to place a wall, ramp, or floor. Each piece costs 10 materials. Hit trees, rocks, houses, and crates with the pickaxe to get more. Shields, medkits, ammo, and materials also sit on the ground as loot.

**Esc** pauses. **Play Again** on the end screen starts a new match.
