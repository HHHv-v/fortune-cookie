import { Redis } from "@upstash/redis";

// Vercel Marketplace의 Upstash Redis를 연결하면 아래 환경변수 중 하나가 자동으로 들어옵니다.
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const KEY = "fortune:cookies"; // 유리병 속 쿠키 목록
const OPENS = "fortune:opens"; // 쿠키별로 열린 횟수 (hash: 쿠키 id → 횟수)
const BOOK = (v) => `fortune:book:${v}`; // 방문자별 '낯선 쪽지 모음' (내가 연 쪽지 목록)
const MAX_LEN = 100;
const MAX_COOKIES = 5000;
const DAY_TTL = 60 * 60 * 48; // 하루 기록은 이틀 뒤 자동 삭제

function clean(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
}
function cleanVisitor(v) {
  return String(v || "").replace(/[^a-z0-9]/gi, "").slice(0, 32);
}
// 한국 시간 기준 오늘 날짜 (YYYY-MM-DD)
function today() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
async function readAll() {
  return (await redis.lrange(KEY, 0, -1)).map((c, i) => ({
    ...(typeof c === "string" ? JSON.parse(c) : c),
    no: i + 1,
  }));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!redis) {
    return res.status(503).json({ error: "storage_not_configured" });
  }

  try {
    // 내 쿠키 소식: 내가 넣은 쿠키 수, 그 쿠키들이 열린 횟수, 오늘 참여 여부
    if (req.method === "GET" && req.query.me) {
      const v = cleanVisitor(req.query.v);
      if (!v) return res.status(200).json({ mine: 0, opened: 0, putToday: false, openedToday: false });
      const d = today();
      const [all, putToday, openedToday] = await Promise.all([
        readAll(),
        redis.sismember(`fortune:put:${d}`, v),
        redis.sismember(`fortune:open:${d}`, v),
      ]);
      const ids = all.filter((c) => c.v === v).map((c) => c.id);
      let opened = 0;
      if (ids.length) {
        const counts = await redis.hmget(OPENS, ...ids);
        opened = Object.values(counts || {}).reduce((s, n) => s + (Number(n) || 0), 0);
      }
      return res.status(200).json({ mine: ids.length, opened, putToday: !!putToday, openedToday: !!openedToday });
    }

    // 낯선 쪽지 모음: 내가 연 쪽지 목록 (오래된 순)
    if (req.method === "GET" && req.query.book) {
      const v = cleanVisitor(req.query.v);
      if (!v) return res.status(200).json({ items: [] });
      const items = (await redis.lrange(BOOK(v), 0, -1)).map((c) => (typeof c === "string" ? JSON.parse(c) : c));
      return res.status(200).json({ items });
    }

    // 유리병 속 쿠키 개수
    if (req.method === "GET" && !req.query.draw) {
      const count = await redis.llen(KEY);
      return res.status(200).json({ count });
    }

    // 쿠키 하나 무작위로 꺼내기 (exclude: 방금 넣은 쿠키, seen: 이미 본 쿠키)
    if (req.method === "GET" && req.query.draw) {
      const exclude = String(req.query.exclude || "");
      const visitor = cleanVisitor(req.query.v);
      const shared = req.query.shared === "1"; // 한 기기를 돌려 쓰는 시연 모드
      const seen = new Set(String(req.query.seen || "").split(",").filter(Boolean));
      const all = await readAll();
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

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const v = cleanVisitor(body.v);
      const shared = body.shared === true; // 시연 모드는 하루 제한을 두지 않음
      const d = today();

      // 쿠키 열기: 하루 한 번, 열린 횟수 +1
      if (body.open) {
        const id = String(body.open).slice(0, 40);
        if (!shared && v) {
          const first = await redis.sadd(`fortune:open:${d}`, v);
          await redis.expire(`fortune:open:${d}`, DAY_TTL);
          if (!first) return res.status(429).json({ error: "already_opened" });
        }
        const opens = await redis.hincrby(OPENS, id, 1);
        // 낯선 쪽지 모음에 한 장 저장 (문장과 번호는 서버의 원본에서 가져옴)
        if (!shared && v) {
          const all = await readAll();
          const c = all.find((x) => x.id === id);
          if (c) {
            const lucky = String(body.lucky || "").replace(/[^0-9 가-힣]/g, "").slice(0, 40);
            await redis.rpush(BOOK(v), JSON.stringify({ id: c.id, text: c.text, no: c.no, lucky, date: d, t: Date.now() }));
          }
        }
        return res.status(200).json({ ok: true, opens });
      }

      // 한 줄 넣기: 하루 한 번
      const text = clean(body.text);
      if (text.length < 2) return res.status(400).json({ error: "too_short" });
      if (!shared && v && (await redis.sismember(`fortune:put:${d}`, v))) {
        return res.status(429).json({ error: "already_put" });
      }
      const count = await redis.llen(KEY);
      if (count >= MAX_COOKIES) return res.status(409).json({ error: "jar_full" });
      const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const newCount = await redis.rpush(KEY, JSON.stringify({ id, text, v, t: Date.now() }));
      if (!shared && v) {
        await redis.sadd(`fortune:put:${d}`, v);
        await redis.expire(`fortune:put:${d}`, DAY_TTL);
      }
      return res.status(200).json({ id, count: newCount });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(500).json({ error: "server_error" });
  }
}
