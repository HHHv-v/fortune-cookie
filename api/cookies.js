import { Redis } from "@upstash/redis";

// Vercel Marketplace의 Upstash Redis를 연결하면 아래 환경변수 중 하나가 자동으로 들어옵니다.
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const KEY = "fortune:cookies";
const MAX_LEN = 60;
const MAX_COOKIES = 5000;

function clean(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!redis) {
    return res.status(503).json({ error: "storage_not_configured" });
  }

  try {
    // 항아리 속 쿠키 개수
    if (req.method === "GET" && !req.query.draw) {
      const count = await redis.llen(KEY);
      return res.status(200).json({ count });
    }

    // 쿠키 하나 무작위로 꺼내기 (exclude: 방금 넣은 쿠키, seen: 이미 본 쿠키)
    if (req.method === "GET" && req.query.draw) {
      const exclude = String(req.query.exclude || "");
      const visitor = String(req.query.v || "");
      const shared = req.query.shared === "1"; // 한 기기를 돌려 쓰는 시연 모드
      const seen = new Set(String(req.query.seen || "").split(",").filter(Boolean));
      const all = (await redis.lrange(KEY, 0, -1)).map((c, i) => ({
        ...(typeof c === "string" ? JSON.parse(c) : c),
        no: i + 1,
      }));
      // 기본: 이 방문자가 넣은 쿠키는 모두 제외 / 공용 기기 모드: 방금 넣은 쿠키만 제외
      const pool = all.filter((c) =>
        shared ? c.id !== exclude : c.id !== exclude && (!visitor || c.v !== visitor)
      );
      if (!pool.length) return res.status(200).json({ empty: true, count: all.length });
      const fresh = pool.filter((c) => !seen.has(c.id));
      const from = fresh.length ? fresh : pool;
      const pick = from[Math.floor(Math.random() * from.length)];
      return res.status(200).json({ id: pick.id, text: pick.text, no: pick.no, count: all.length });
    }

    // 한 줄 넣기
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const text = clean(body.text);
      if (text.length < 2) return res.status(400).json({ error: "too_short" });
      const count = await redis.llen(KEY);
      if (count >= MAX_COOKIES) return res.status(409).json({ error: "jar_full" });
      const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const v = String(body.v || "").replace(/[^a-z0-9]/gi, "").slice(0, 32);
      const newCount = await redis.rpush(KEY, JSON.stringify({ id, text, v, t: Date.now() }));
      return res.status(200).json({ id, count: newCount });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(500).json({ error: "server_error" });
  }
}
