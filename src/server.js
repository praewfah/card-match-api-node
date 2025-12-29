require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();

const PORT = process.env.PORT || 8000;
const SECRET_KEY = process.env.SECRET_KEY || "change-me-long-random";
const DECK_EXPIRES_MIN = Number(process.env.DECK_EXPIRES_MIN || 10);

app.use(cors());
app.use(express.json());

function fetchRandomDeck(numPairs = 8) {
  const deck = [];
  for (let i = 0; i < numPairs; i++) {
    deck.push(i);
    deck.push(i);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function signDeck(gameId, expiresAt) {
  const payload = JSON.stringify({
    gid: gameId,
    expires: Math.floor(expiresAt.getTime() / 1000),
  });
  const sig = crypto.createHmac("sha256", SECRET_KEY).update(payload).digest("hex");
  return `${sig}.${payload}`;
}

function verifyDeckToken(token) {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Invalid token format");
  const [sig, payload] = parts;
  const calc = crypto.createHmac("sha256", SECRET_KEY).update(payload).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(calc))) throw new Error("Invalid token signature");
  const data = JSON.parse(payload);
  if (Math.floor(Date.now() / 1000) > data.expires) throw new Error("Token expired");
  return data;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress;
}

app.post("/game/start", async (req, res) => {
  try {
    console.log("➡️ /game/start called", req.body);
    const { device_id, num_pairs = 8 } = req.body;
    if (!device_id) return res.status(400).json({ detail: "device_id is required" });

    const deck = fetchRandomDeck(num_pairs);
    const ip = getClientIp(req);
    let player = await prisma.player.findUnique({ where: { device_id } });
    if (!player) {
      player = await prisma.player.create({ data: { device_id, last_ip: ip } });
    } else {
      await prisma.player.update({ where: { device_id }, data: { last_ip: ip } });
    }

    const gameId = uuidv4();
    const expiresAt = new Date(Date.now() + DECK_EXPIRES_MIN * 60 * 1000);
    const deckToken = signDeck(gameId, expiresAt);

    await prisma.game.create({
      data: {
        id: gameId,
        deck_json: JSON.stringify(deck),
        deck_token: deckToken,
        expires_at: expiresAt,
      },
    });

    return res.json({
      game_id: gameId,
      total_cards: deck.length,
      deck_token: deckToken,
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("❌ /game/start error:", err.message);
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.get("/game/reveal", async (req, res) => {
  try {
    const { game_id, position, deck_token } = req.query;
    const pos = Number(position);
    if (!game_id || !deck_token) return res.status(400).json({ detail: "Missing params" });

    const tokenData = verifyDeckToken(deck_token);
    if (tokenData.gid !== game_id) return res.status(400).json({ detail: "game/token mismatch" });

    const game = await prisma.game.findUnique({ where: { id: game_id } });
    if (!game) return res.status(404).json({ detail: "Game not found" });
    if (game.expires_at < new Date()) return res.status(400).json({ detail: "Game expired" });

    const deck = JSON.parse(game.deck_json);
    if (pos < 0 || pos >= deck.length) return res.status(400).json({ detail: "Invalid position" });

    const cardValue = deck[pos];
    return res.json({ position: pos, card_value: cardValue });
  } catch (err) {
    res.status(400).json({ detail: err.message });
  }
});

app.post("/score/submit", async (req, res) => {
  try {
    const { device_id, game_id, score, deck_token } = req.body;
    if (!device_id || !game_id || typeof score !== "number" || !deck_token)
      return res.status(400).json({ detail: "missing fields" });

    const tokenData = verifyDeckToken(deck_token);
    if (tokenData.gid !== game_id) return res.status(400).json({ detail: "game/token mismatch" });

    const game = await prisma.game.findUnique({ where: { id: game_id } });
    if (!game) return res.status(404).json({ detail: "Game not found" });
    if (game.expires_at < new Date()) return res.status(400).json({ detail: "Game expired" });

    let player = await prisma.player.findUnique({ where: { device_id } });
    if (!player) player = await prisma.player.create({ data: { device_id } });

    await prisma.score.create({ data: { player_id: player.id, score } });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ detail: err.message });
  }
});

app.get("/score/last", async (req, res) => {
  const { device_id } = req.query;
  if (!device_id) return res.status(400).json({ detail: "device_id required" });

  const player = await prisma.player.findUnique({ where: { device_id: String(device_id) } });
  if (!player) return res.json({ device_id, last_score: null, updated_at: null });

  const lastScore = await prisma.score.findFirst({
    where: { player_id: player.id },
    orderBy: { created_at: "desc" },
  });
  res.json({
    device_id,
    last_score: lastScore ? lastScore.score : null,
    updated_at: lastScore ? lastScore.created_at : null,
  });
});

app.get("/leaderboard/top3", async (req, res) => {
  const rows = await prisma.score.findMany({
    orderBy: [{ score: "desc" }, { created_at: "asc" }],
    take: 3,
    include: { player: true },
  });
  const result = rows.map((r) => ({
    device_id: r.player.device_id,
    score: r.score,
    created_at: r.created_at,
  }));
  res.json(result);
});

app.get("/health", async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: "connected",
    });
  } catch (err) {
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      database: "disconnected",
      error: err.message,
    });
  }
});

// log ทุก request แบบง่าย ๆ
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ตัวจับ error ทั้งหมด
app.use((err, req, res, next) => {
  console.error("🔥 Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`Node API running on http://localhost:${PORT}`);
});
