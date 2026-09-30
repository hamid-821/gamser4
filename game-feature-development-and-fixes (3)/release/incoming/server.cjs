/* سرور گی‌میفای ۲.۱ — فایل‌های سایت + API + ذخیرهٔ دائمی روی فایل JSON — بدون هیچ وابستگی (Node 18+)
 * سازگار با نسخهٔ قبلی (data-app/app.json): کلیدهای قدیمی حفظ می‌شوند و کلیدهای جدید فقط اضافه می‌شوند. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VERSION = "2.1.0";
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data-app");
const DIST = path.join(__dirname, "dist");
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- ذخیرهٔ دائمی (فایل JSON) ---------- */
const DATA_FILE = path.join(DATA_DIR, "app.json");
const DEFAULT_ORGS = ["برق", "آب و فاضلاب", "گاز", "نفت و پتروشیمی", "مخابرات", "شهرداری", "آموزش و پرورش", "بهداشت و درمان", "راه‌آهن", "فولاد", "دانشگاه", "سایر"];
const blank = () => ({ users: [], tokens: {}, messages: [], clans: [], wars: [], tournaments: [], moderation: [], notices: [], clanChat: [], orgs: DEFAULT_ORGS.slice(), meta: { schema: 2, createdAt: Date.now() } });
let data = blank();
try {
  if (fs.existsSync(DATA_FILE)) data = { ...blank(), ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
} catch { /* فایل خراب → از صفر شروع می‌کنیم (بدون حذف فایل قبلی) */ }
if (!Array.isArray(data.orgs) || !data.orgs.length) data.orgs = DEFAULT_ORGS.slice();
data.meta = { ...(data.meta || {}), schema: 2, version: VERSION };

let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = DATA_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error("save failed", e.message); }
  }, 300);
};

/* ---------- کلید مدیر ---------- */
const ADMIN_KEY_FILE = path.join(DATA_DIR, "admin-key.txt");
let ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();
if (ADMIN_KEY.length < 12) {
  try { ADMIN_KEY = fs.readFileSync(ADMIN_KEY_FILE, "utf8").trim(); } catch { ADMIN_KEY = ""; }
  if (!ADMIN_KEY) { ADMIN_KEY = crypto.randomBytes(18).toString("base64url"); fs.writeFileSync(ADMIN_KEY_FILE, ADMIN_KEY, { mode: 0o600 }); }
}
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/* ---------- ابزارها ---------- */
const uid = (p) => p + crypto.randomBytes(6).toString("hex");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const parseCookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((x) => x[0]).map(([k, ...v]) => [k, v.join("=")]));
const json = (res, code, bodyObj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(bodyObj)); };
const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 2e6) req.destroy(); }); req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } }); });
const str = (v, n = 80) => String(v ?? "").trim().slice(0, n);
const num = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);
const weekKey = () => { const d = new Date(); const onejan = new Date(d.getFullYear(), 0, 1); return d.getFullYear() + "-w" + Math.ceil(((d - onejan) / 864e5 + onejan.getDay() + 1) / 7); };

const userById = (id) => data.users.find((u) => u.id === id) || null;
const clanById = (id) => data.clans.find((c) => c.id === id) || null;
const authUser = (req) => {
  const t = parseCookies(req).gtok;
  if (!t || !data.tokens[t]) return null;
  const u = userById(data.tokens[t]);
  if (u) { u.last_seen = Date.now(); if (ADMIN_EMAILS.length && u.email && ADMIN_EMAILS.includes(String(u.email).toLowerCase())) u.role = "admin"; save(); }
  return u;
};
const isAdmin = (req, u) => (u && u.role === "admin") || (req.headers["x-admin-key"] && req.headers["x-admin-key"] === ADMIN_KEY);
const setTok = (res, userId) => {
  const t = uid("t");
  data.tokens[t] = userId;
  save();
  const secure = BASE_URL.startsWith("https") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `gtok=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`);
};
const newUser = (b = {}) => ({ id: uid("u"), local_id: str(b.localId, 40), name: str(b.name, 40) || "میهمان", avatar: b.avatar ?? 1, interests: Array.isArray(b.interests) ? b.interests.slice(0, 20) : [], provider: str(b.provider, 12) || "guest", google_sub: "", email: str(b.email, 120), phone: str(b.phone, 20), org: str(b.org, 40), orgVerified: false, clanId: "", role: "user", banned: false, xp: 0, coins: 50, cups: 0, streak: 0, wins: 0, played: 0, rating: 1000, bio: "", title: "", weekXp: 0, weekKey: weekKey(), warPoints: 0, rewards: [], last_seen: Date.now(), created_at: Date.now() });
const pub = (u) => ({ id: u.id, name: u.name, avatar: u.avatar, interests: u.interests || [], provider: u.provider, xp: u.xp, coins: u.coins, cups: u.cups, streak: u.streak, wins: u.wins, played: u.played, rating: u.rating, bio: u.bio, title: u.title || "", org: u.org || "", orgVerified: !!u.orgVerified, clanId: u.clanId || "", clan: u.clanId ? clanBrief(clanById(u.clanId)) : null, role: u.role || "user", weekXp: u.weekXp || 0, warPoints: u.warPoints || 0, last_seen: u.last_seen, created_at: u.created_at, level: Math.floor(Math.sqrt((u.xp || 0) / 40)) + 1 });
const me = (u) => ({ ...pub(u), email: u.email, local_id: u.local_id, rewards: (u.rewards || []).filter((r) => !r.claimed), unread: data.notices.filter((n) => n.to === u.id && !n.read).length, isAdmin: u.role === "admin" });
const originOk = (req) => {
  const o = req.headers.origin; if (!o) return true;
  if (o === BASE_URL) return true;
  try { const h = new URL(o).host; return h === (req.headers["x-forwarded-host"] || req.headers.host); } catch { return false; }
};
const notify = (to, title, body, kind = "system", meta = {}) => { data.notices.push({ id: uid("n"), to, title: str(title, 80), body: str(body, 240), kind, meta, at: Date.now(), read: false }); if (data.notices.length > 5000) data.notices = data.notices.slice(-4000); };

/* ---------- قبیله‌ها ---------- */
const clanMembers = (c) => data.users.filter((u) => u.clanId === c.id);
const clanScore = (c) => { const ms = clanMembers(c); return Math.round(ms.reduce((s, u) => s + (u.xp || 0), 0) * 0.2 + (c.trophies || 0) * 100 + (c.warWins || 0) * 500 + ms.reduce((s, u) => s + (u.cups || 0), 0) * 25); };
const clanWeek = (c) => clanMembers(c).reduce((s, u) => s + (u.weekKey === weekKey() ? u.weekXp || 0 : 0), 0);
const clanBrief = (c) => (c ? { id: c.id, name: c.name, tag: c.tag, emoji: c.emoji, color: c.color } : null);
const clanPub = (c) => { const ms = clanMembers(c); return { id: c.id, name: c.name, tag: c.tag, emoji: c.emoji, color: c.color, desc: c.desc, org: c.org || "", open: !!c.open, leaderId: c.leaderId, officers: c.officers || [], members: ms.length, maxMembers: c.maxMembers || 30, trophies: c.trophies || 0, warWins: c.warWins || 0, warLosses: c.warLosses || 0, score: clanScore(c), weekScore: clanWeek(c), badges: clanBadges(c, ms), created_at: c.created_at }; };
const clanBadges = (c, ms) => { const b = []; if ((c.warWins || 0) >= 1) b.push({ id: "first-blood", name: "اولین پیروزی", emoji: "🗡️" }); if ((c.warWins || 0) >= 5) b.push({ id: "warlord", name: "جنگ‌سالار", emoji: "⚔️" }); if (ms.length >= 10) b.push({ id: "tribe", name: "قبیلهٔ بزرگ", emoji: "🏘️" }); if ((c.trophies || 0) >= 10) b.push({ id: "champion", name: "قهرمان", emoji: "🏆" }); if (clanWeek(c) >= 2000) b.push({ id: "onfire", name: "هفتهٔ آتشین", emoji: "🔥" }); return b; };
const rankedClans = () => data.clans.map(clanPub).sort((a, b) => b.score - a.score).map((c, i) => ({ ...c, rank: i + 1 }));
const canManageClan = (c, u) => !!u && (c.leaderId === u.id || (c.officers || []).includes(u.id) || u.role === "admin");

/* ---------- نبردها و تورنمنت‌ها ---------- */
const warPub = (w) => ({ ...w, a: clanBrief(clanById(w.aId)), b: clanBrief(clanById(w.bId)), aScore: w.scores[w.aId] || 0, bScore: w.scores[w.bId] || 0, live: !w.resolved && w.endAt > Date.now() });
const resolveWars = () => {
  const now = Date.now(); let changed = false;
  for (const w of data.wars) {
    if (w.resolved || w.endAt > now) continue;
    w.resolved = true; changed = true;
    const sa = w.scores[w.aId] || 0, sb = w.scores[w.bId] || 0;
    const A = clanById(w.aId), B = clanById(w.bId);
    if (sa === sb) { w.winnerId = ""; for (const c of [A, B]) if (c) c.trophies = (c.trophies || 0) + 1; }
    else { const win = sa > sb ? A : B, lose = sa > sb ? B : A; w.winnerId = win ? win.id : ""; if (win) { win.warWins = (win.warWins || 0) + 1; win.trophies = (win.trophies || 0) + 3; } if (lose) lose.warLosses = (lose.warLosses || 0) + 1; }
    for (const c of [A, B]) if (c) for (const u of clanMembers(c)) {
      const won = w.winnerId === c.id, coins = won ? 120 : w.winnerId ? 30 : 60;
      u.rewards = u.rewards || []; u.rewards.push({ id: uid("rw"), kind: "war", coins, xp: won ? 60 : 20, title: won ? `پیروزی قبیله در نبرد با ${(c.id === w.aId ? B : A)?.name || "حریف"}` : "پایان نبرد قبیله", at: now, claimed: false });
      notify(u.id, won ? "🏆 قبیلهٔ شما پیروز شد!" : "⚔️ نبرد قبیله تمام شد", `${A?.name || "?"} ${sa} — ${sb} ${B?.name || "?"}`, "war", { warId: w.id });
    }
  }
  if (changed) save();
};
const tourPub = (t, u) => { const rows = Object.entries(t.scores || {}).map(([id, s]) => ({ user: pub(userById(id) || { id, name: "؟", xp: 0 }), score: s })).sort((a, b) => b.score - a.score).slice(0, 50); const clanRows = {}; for (const r of rows) if (r.user.clanId) clanRows[r.user.clanId] = (clanRows[r.user.clanId] || 0) + r.score; return { ...t, participants: (t.participants || []).length, joined: !!u && (t.participants || []).includes(u.id), standings: rows, clanStandings: Object.entries(clanRows).map(([id, s]) => ({ clan: clanBrief(clanById(id)), score: s })).filter((x) => x.clan).sort((a, b) => b.score - a.score), live: !t.resolved && t.startAt <= Date.now() && t.endAt > Date.now(), upcoming: t.startAt > Date.now(), creator: pub(userById(t.creatorId) || { id: "", name: "مدیر", xp: 0 }) }; };
const resolveTournaments = () => {
  const now = Date.now(); let changed = false;
  for (const t of data.tournaments) {
    if (t.resolved || t.endAt > now) continue;
    t.resolved = true; changed = true;
    const rows = Object.entries(t.scores || {}).sort((a, b) => b[1] - a[1]);
    const prizes = [300, 200, 100];
    rows.slice(0, 3).forEach(([id, s], i) => { const u = userById(id); if (!u) return; u.rewards = u.rewards || []; u.rewards.push({ id: uid("rw"), kind: "tournament", coins: prizes[i], xp: 100 - i * 30, cups: 3 - i, title: `رتبهٔ ${i + 1} تورنمنت «${t.title}»`, at: now, claimed: false }); notify(u.id, `🏅 رتبهٔ ${i + 1} تورنمنت`, `در «${t.title}» با ${s} امتیاز رتبهٔ ${i + 1} شدی. جایزه‌ات آماده است!`, "tournament", { tid: t.id }); });
    if (t.scope === "clan" || t.scope === "clans") { const cs = {}; for (const [id, s] of rows) { const u = userById(id); if (u && u.clanId) cs[u.clanId] = (cs[u.clanId] || 0) + s; } const top = Object.entries(cs).sort((a, b) => b[1] - a[1])[0]; if (top) { const c = clanById(top[0]); if (c) c.trophies = (c.trophies || 0) + 5; } }
    t.winners = rows.slice(0, 3).map(([id]) => id);
  }
  if (changed) save();
};
const visibleTournament = (t, u) => t.scope === "public" || (t.scope === "org" && u && u.org && u.org === t.org) || (t.scope === "org" && u && u.role === "admin") || ((t.scope === "clan" || t.scope === "clans") && u && (t.clanIds || []).includes(u.clanId)) || (t.scope === "clans" && !(t.clanIds || []).length);

/* اعمال دلتاهای بازی روی نبردها و تورنمنت‌ها */
const applyDelta = (u, dXp, dWins) => {
  if (dXp <= 0 && dWins <= 0) return;
  const pts = Math.round(dXp + dWins * 40);
  if (u.weekKey !== weekKey()) { u.weekKey = weekKey(); u.weekXp = 0; }
  u.weekXp = (u.weekXp || 0) + dXp;
  const now = Date.now();
  if (u.clanId) for (const w of data.wars) if (!w.resolved && w.endAt > now && w.startAt <= now && (w.aId === u.clanId || w.bId === u.clanId)) { w.scores[u.clanId] = (w.scores[u.clanId] || 0) + pts; w.contrib[u.id] = (w.contrib[u.id] || 0) + pts; u.warPoints = (u.warPoints || 0) + pts; }
  for (const t of data.tournaments) if (!t.resolved && t.startAt <= now && t.endAt > now && (t.participants || []).includes(u.id)) t.scores[u.id] = (t.scores[u.id] || 0) + pts;
};

/* ---------- سرور ---------- */
const routes = [];
const on = (method, pattern, handler) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:[a-z]+/gi, "([^/]+)") + "$"), handler });

on("GET", "/health", (c) => json(c.res, 200, { ok: true, version: VERSION }));
on("GET", "/api/health", (c) => json(c.res, 200, { ok: true, version: VERSION }));
on("GET", "/api/config", (c) => json(c.res, 200, { version: VERSION, google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), orgs: data.orgs, stats: { users: data.users.length, clans: data.clans.length, wars: data.wars.filter((w) => !w.resolved).length } }));

/* ورود با گوگل (واقعی) */
on("GET", "/auth/google", (c) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) { c.res.writeHead(302, { Location: "/#home?login=google-missing" }); return c.res.end(); }
  const state = uid("s"); data.tokens["state:" + state] = Date.now(); save();
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: BASE_URL + "/auth/google/callback", response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
  c.res.writeHead(302, { Location: "https://accounts.google.com/o/oauth2/v2/auth?" + params }); c.res.end();
});
on("GET", "/auth/google/callback", async (c) => {
  let ok = false;
  try {
    const st = c.url.searchParams.get("state") || "";
    if (data.tokens["state:" + st]) delete data.tokens["state:" + st];
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: c.url.searchParams.get("code") || "", client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: BASE_URL + "/auth/google/callback", grant_type: "authorization_code" }) });
    const token = await tokenRes.json();
    if (token.access_token) {
      const prof = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: "Bearer " + token.access_token } })).json();
      if (prof.sub) {
        let u = data.users.find((x) => x.google_sub === prof.sub) || (prof.email && data.users.find((x) => x.email && x.email.toLowerCase() === String(prof.email).toLowerCase()));
        if (!u) { u = newUser({ name: prof.name || "بازیکن", provider: "google", email: prof.email }); u.google_sub = prof.sub; u.picture = prof.picture || ""; data.users.push(u); }
        else { u.google_sub = prof.sub; u.provider = "google"; if (!u.email) u.email = prof.email || ""; }
        setTok(c.res, u.id); ok = true;
      }
    }
  } catch { /* خطای گوگل → برگشت به خانه */ }
  c.res.writeHead(302, { Location: ok ? "/#home?login=google-ok" : "/#home?login=google-failed" }); c.res.end();
});

/* ثبت میهمان / اتصال خودکار پروفایل محلی به سرور */
on("POST", "/api/auth/guest", async (c) => {
  const b = await readBody(c.req);
  const u = newUser(b); data.users.push(u); save(); setTok(c.res, u.id); json(c.res, 200, me(u));
});
on("POST", "/api/auth/local", async (c) => {
  const b = await readBody(c.req);
  const localId = str(b.localId, 40);
  let u = c.user;
  if (!u && localId) u = data.users.find((x) => x.local_id === localId) || null;
  if (!u && b.email && b.provider === "google") u = data.users.find((x) => x.email && x.email.toLowerCase() === String(b.email).toLowerCase()) || null;
  if (!u) { u = newUser(b); data.users.push(u); }
  if (localId && !u.local_id) u.local_id = localId;
  for (const k of ["xp", "coins", "cups", "streak", "wins", "played", "rating"]) if (typeof b[k] === "number" && b[k] > (u[k] || 0)) u[k] = Math.round(b[k]);
  if (b.name) u.name = str(b.name, 40); if (b.avatar !== undefined) u.avatar = b.avatar; if (typeof b.bio === "string") u.bio = str(b.bio, 200); if (b.org && !u.org) u.org = str(b.org, 40);
  save(); if (!c.user) setTok(c.res, u.id); json(c.res, 200, me(u));
});
on("POST", "/api/auth/logout", (c) => { const t = parseCookies(c.req).gtok; if (t) delete data.tokens[t]; save(); c.res.setHeader("Set-Cookie", "gtok=; Path=/; Max-Age=0"); json(c.res, 200, { ok: true }); });

/* پروفایل من */
on("GET", "/api/me", (c) => (c.user ? json(c.res, 200, me(c.user)) : json(c.res, 401, { error: "not-authed" })));
on("POST", "/api/me", async (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" });
  const b = await readBody(c.req);
  for (const k of ["xp", "coins", "cups", "streak", "wins", "played", "rating"]) if (typeof b[k] === "number") u[k] = Math.max(0, Math.round(b[k]));
  if (typeof b.name === "string" && b.name.trim()) u.name = str(b.name, 40);
  if (b.avatar !== undefined) u.avatar = b.avatar;
  if (Array.isArray(b.interests)) u.interests = b.interests.slice(0, 20);
  if (typeof b.bio === "string") u.bio = str(b.bio, 200);
  if (typeof b.org === "string") { if (b.org !== u.org) u.orgVerified = false; u.org = str(b.org, 40); }
  if (typeof b.orgCode === "string" && b.orgCode.trim()) { u.orgCode = str(b.orgCode, 40); }
  save(); json(c.res, 200, me(u));
});
on("POST", "/api/me/sync", async (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" });
  const b = await readBody(c.req);
  const dXp = Math.max(0, num(b.xp) - (u.xp || 0)), dWins = Math.max(0, num(b.wins) - (u.wins || 0));
  for (const k of ["xp", "coins", "cups", "streak", "wins", "played", "rating"]) if (typeof b[k] === "number") u[k] = Math.max(0, Math.round(b[k]));
  if (b.name) u.name = str(b.name, 40); if (b.avatar !== undefined) u.avatar = b.avatar; if (typeof b.bio === "string") u.bio = str(b.bio, 200); if (typeof b.title === "string") u.title = str(b.title, 40);
  if (typeof b.org === "string" && b.org && !u.org) u.org = str(b.org, 40);
  applyDelta(u, dXp, dWins); resolveWars(); resolveTournaments(); save();
  json(c.res, 200, me(u));
});
on("POST", "/api/me/claim", (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" });
  const rs = (u.rewards || []).filter((r) => !r.claimed); let coins = 0, xp = 0, cups = 0;
  for (const r of rs) { r.claimed = true; coins += r.coins || 0; xp += r.xp || 0; cups += r.cups || 0; }
  u.coins = (u.coins || 0) + coins; u.xp = (u.xp || 0) + xp; u.cups = (u.cups || 0) + cups; save();
  json(c.res, 200, { coins, xp, cups, items: rs });
});

/* بازیکنان و پروفایل عمومی */
on("GET", "/api/players", (c) => { const q = str(c.url.searchParams.get("q"), 40); const rows = data.users.filter((u) => !u.banned && (!q || u.name.includes(q))).sort((a, b) => b.xp - a.xp).slice(0, 200); json(c.res, 200, rows.map(pub)); });
on("GET", "/api/users/:id", (c) => {
  const id = decodeURIComponent(c.params[0]);
  const u = userById(id) || data.users.find((x) => x.local_id === id) || data.users.find((x) => x.name === id);
  if (!u) return json(c.res, 404, { error: "not-found" });
  const rank = data.users.filter((x) => x.xp > u.xp).length + 1;
  const wars = data.wars.filter((w) => w.contrib && w.contrib[u.id]).length;
  json(c.res, 200, { ...pub(u), rank, warsPlayed: wars, tournaments: data.tournaments.filter((t) => (t.participants || []).includes(u.id)).map((t) => ({ id: t.id, title: t.title, score: t.scores[u.id] || 0, resolved: t.resolved, place: t.winners ? t.winners.indexOf(u.id) + 1 : 0 })), badges: userBadges(u) });
});
const userBadges = (u) => { const b = []; if ((u.wins || 0) >= 10) b.push({ emoji: "🥇", name: "۱۰ برد" }); if ((u.streak || 0) >= 7) b.push({ emoji: "🔥", name: "۷ روز پیاپی" }); if ((u.warPoints || 0) >= 500) b.push({ emoji: "⚔️", name: "جنگجوی قبیله" }); if (u.provider === "google") b.push({ emoji: "✅", name: "حساب تأییدشده" }); if (u.orgVerified) b.push({ emoji: "🏢", name: `عضو ${u.org}` }); if (u.clanId && clanById(u.clanId)?.leaderId === u.id) b.push({ emoji: "👑", name: "رهبر قبیله" }); return b; };

/* گفت‌وگوی واقعی */
on("GET", "/api/messages", (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" });
  const withId = c.url.searchParams.get("with") || "";
  const rows = data.messages.filter((m) => (m.from_id === u.id && m.to_id === withId) || (m.from_id === withId && m.to_id === u.id)).sort((a, b) => a.at - b.at).slice(-200);
  for (const m of rows) if (m.from_id === withId && m.to_id === u.id) m.read = 1;
  save(); json(c.res, 200, rows);
});
on("POST", "/api/messages", async (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" });
  const b = await readBody(c.req); const to = String(b.to || ""); const text = str(b.text, 500);
  if (!to || !text || !userById(to)) return json(c.res, 400, { error: "bad-request" });
  const msg = { id: uid("m"), from_id: u.id, to_id: to, text, at: Date.now(), read: 0 }; data.messages.push(msg); save(); json(c.res, 200, { id: msg.id, at: msg.at });
});

/* اعلان‌ها */
on("GET", "/api/notices", (c) => { const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" }); json(c.res, 200, data.notices.filter((n) => n.to === u.id).slice(-60).reverse()); });
on("POST", "/api/notices/read", (c) => { const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" }); for (const n of data.notices) if (n.to === u.id) n.read = true; save(); json(c.res, 200, { ok: true }); });

/* ---------- قبیله‌ها ---------- */
on("GET", "/api/clans", (c) => { resolveWars(); json(c.res, 200, rankedClans()); });
on("POST", "/api/clans", async (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" });
  if (u.banned) return json(c.res, 403, { error: "banned" });
  if (u.clanId && clanById(u.clanId)) return json(c.res, 400, { error: "شما هم‌اکنون عضو یک قبیله هستید. ابتدا از آن خارج شوید." });
  const b = await readBody(c.req);
  const name = str(b.name, 30); const tag = str(b.tag, 5).toUpperCase().replace(/[^A-Z0-9آ-ی]/g, "");
  if (name.length < 3) return json(c.res, 400, { error: "نام قبیله دست‌کم ۳ حرف باشد." });
  if (data.clans.some((x) => x.name === name)) return json(c.res, 400, { error: "این نام قبلاً گرفته شده است." });
  const c2 = { id: uid("c"), name, tag: tag || name.slice(0, 3), emoji: str(b.emoji, 4) || "🛡️", color: /^#[0-9a-f]{6}$/i.test(b.color || "") ? b.color : "#8b5cf6", desc: str(b.desc, 200), org: str(b.org, 40), open: b.open !== false, leaderId: u.id, officers: [], maxMembers: 30, trophies: 0, warWins: 0, warLosses: 0, created_at: Date.now(), joinRequests: [] };
  data.clans.push(c2); u.clanId = c2.id; save(); json(c.res, 200, clanPub(c2));
});
on("GET", "/api/clans/:id", (c) => {
  const cl = clanById(c.params[0]); if (!cl) return json(c.res, 404, { error: "not-found" }); resolveWars();
  const ms = clanMembers(cl).map(pub).sort((a, b) => b.warPoints - a.warPoints || b.xp - a.xp);
  const wars = data.wars.filter((w) => w.aId === cl.id || w.bId === cl.id).sort((a, b) => b.startAt - a.startAt).slice(0, 10).map(warPub);
  const chat = data.clanChat.filter((m) => m.clanId === cl.id).slice(-50).map((m) => ({ ...m, user: pub(userById(m.userId) || { id: "", name: "؟", xp: 0 }) }));
  const rank = rankedClans().find((x) => x.id === cl.id)?.rank || 0;
  json(c.res, 200, { ...clanPub(cl), rank, membersList: ms, wars, chat, joinRequests: canManageClan(cl, c.user) ? (cl.joinRequests || []).map((id) => pub(userById(id) || { id, name: "؟", xp: 0 })) : [], canManage: canManageClan(cl, c.user), isMember: !!c.user && c.user.clanId === cl.id, requested: !!c.user && (cl.joinRequests || []).includes(c.user.id) });
});
on("POST", "/api/clans/:id/join", (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" }); const cl = clanById(c.params[0]); if (!cl) return json(c.res, 404, { error: "not-found" });
  if (u.clanId === cl.id) return json(c.res, 200, { ok: true, joined: true });
  if (u.clanId && clanById(u.clanId)) return json(c.res, 400, { error: "ابتدا از قبیلهٔ فعلی خارج شو." });
  if (clanMembers(cl).length >= (cl.maxMembers || 30)) return json(c.res, 400, { error: "ظرفیت قبیله پر است." });
  const invited = data.notices.some((n) => n.to === u.id && n.kind === "clan-invite" && n.meta && n.meta.clanId === cl.id);
  if (cl.open || invited) { u.clanId = cl.id; cl.joinRequests = (cl.joinRequests || []).filter((x) => x !== u.id); notify(cl.leaderId, "عضو جدید قبیله", `${u.name} به قبیلهٔ ${cl.name} پیوست.`, "clan", { clanId: cl.id }); save(); return json(c.res, 200, { ok: true, joined: true }); }
  cl.joinRequests = [...new Set([...(cl.joinRequests || []), u.id])]; notify(cl.leaderId, "درخواست عضویت", `${u.name} می‌خواهد به ${cl.name} بپیوندد.`, "clan", { clanId: cl.id }); save(); json(c.res, 200, { ok: true, joined: false, requested: true });
});
on("POST", "/api/clans/:id/approve", async (c) => {
  const u = c.user; const cl = clanById(c.params[0]); if (!cl) return json(c.res, 404, { error: "not-found" }); if (!canManageClan(cl, u)) return json(c.res, 403, { error: "forbidden" });
  const b = await readBody(c.req); const t = userById(String(b.userId || "")); if (!t) return json(c.res, 404, { error: "user" });
  cl.joinRequests = (cl.joinRequests || []).filter((x) => x !== t.id);
  if (b.accept !== false && !t.clanId) { t.clanId = cl.id; notify(t.id, "به قبیله خوش آمدی!", `درخواستت برای ${cl.name} پذیرفته شد.`, "clan", { clanId: cl.id }); }
  save(); json(c.res, 200, { ok: true });
});
on("POST", "/api/clans/:id/leave", (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" }); const cl = clanById(c.params[0]); if (!cl || u.clanId !== cl.id) return json(c.res, 400, { error: "عضو این قبیله نیستی." });
  u.clanId = ""; cl.officers = (cl.officers || []).filter((x) => x !== u.id);
  const rest = clanMembers(cl);
  if (cl.leaderId === u.id) { if (rest.length) { cl.leaderId = (rest.find((x) => (cl.officers || []).includes(x.id)) || rest.sort((a, b) => b.xp - a.xp)[0]).id; notify(cl.leaderId, "👑 تو رهبر شدی", `رهبری قبیلهٔ ${cl.name} به تو رسید.`, "clan", { clanId: cl.id }); } else { data.clans = data.clans.filter((x) => x.id !== cl.id); } }
  save(); json(c.res, 200, { ok: true });
});
on("POST", "/api/clans/:id/manage", async (c) => {
  const u = c.user; const cl = clanById(c.params[0]); if (!cl) return json(c.res, 404, { error: "not-found" }); if (!canManageClan(cl, u)) return json(c.res, 403, { error: "فقط رهبر یا افسر قبیله." });
  const b = await readBody(c.req); const action = String(b.action || "");
  if (action === "settings") { if (b.desc !== undefined) cl.desc = str(b.desc, 200); if (b.open !== undefined) cl.open = !!b.open; if (b.emoji) cl.emoji = str(b.emoji, 4); if (/^#[0-9a-f]{6}$/i.test(b.color || "")) cl.color = b.color; if (b.org !== undefined) cl.org = str(b.org, 40); }
  else {
    const t = userById(String(b.userId || "")); if (!t || t.clanId !== cl.id) return json(c.res, 404, { error: "عضو پیدا نشد." });
    if (action === "kick" && t.id !== cl.leaderId) { t.clanId = ""; cl.officers = (cl.officers || []).filter((x) => x !== t.id); notify(t.id, "خروج از قبیله", `از قبیلهٔ ${cl.name} خارج شدی.`, "clan"); }
    if (action === "promote" && cl.leaderId === u.id) { cl.officers = [...new Set([...(cl.officers || []), t.id])]; notify(t.id, "🎖️ افسر شدی", `در قبیلهٔ ${cl.name} افسر شدی.`, "clan", { clanId: cl.id }); }
    if (action === "demote" && cl.leaderId === u.id) cl.officers = (cl.officers || []).filter((x) => x !== t.id);
    if (action === "transfer" && cl.leaderId === u.id) { cl.leaderId = t.id; notify(t.id, "👑 رهبر قبیله شدی", `رهبری ${cl.name} به تو واگذار شد.`, "clan", { clanId: cl.id }); }
  }
  save(); json(c.res, 200, clanPub(cl));
});
on("POST", "/api/clans/:id/invite", async (c) => {
  const u = c.user; const cl = clanById(c.params[0]); if (!cl) return json(c.res, 404, { error: "not-found" }); if (!u || u.clanId !== cl.id) return json(c.res, 403, { error: "forbidden" });
  const b = await readBody(c.req); const t = userById(String(b.userId || "")); if (!t) return json(c.res, 404, { error: "کاربر پیدا نشد." });
  if (t.clanId) return json(c.res, 400, { error: "این کاربر عضو قبیلهٔ دیگری است." });
  notify(t.id, `دعوت به قبیلهٔ ${cl.emoji} ${cl.name}`, `${u.name} تو را به قبیله‌اش دعوت کرد.`, "clan-invite", { clanId: cl.id, from: u.id }); save(); json(c.res, 200, { ok: true });
});
on("POST", "/api/clans/:id/chat", async (c) => {
  const u = c.user; const cl = clanById(c.params[0]); if (!cl) return json(c.res, 404, { error: "not-found" }); if (!u || u.clanId !== cl.id) return json(c.res, 403, { error: "forbidden" });
  const b = await readBody(c.req); const text = str(b.text, 300); if (!text) return json(c.res, 400, { error: "empty" });
  data.clanChat.push({ id: uid("cc"), clanId: cl.id, userId: u.id, text, at: Date.now() }); if (data.clanChat.length > 5000) data.clanChat = data.clanChat.slice(-4000); save(); json(c.res, 200, { ok: true });
});

/* ---------- نبرد قبیله‌ها ---------- */
on("GET", "/api/wars", (c) => { resolveWars(); json(c.res, 200, data.wars.slice(-40).reverse().map(warPub)); });
on("POST", "/api/wars", async (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" }); const mine = clanById(u.clanId); if (!mine || !canManageClan(mine, u)) return json(c.res, 403, { error: "فقط رهبر/افسر قبیله می‌تواند نبرد آغاز کند." });
  const b = await readBody(c.req); const target = clanById(String(b.targetClanId || "")); if (!target || target.id === mine.id) return json(c.res, 404, { error: "قبیلهٔ حریف پیدا نشد." });
  if (data.wars.some((w) => !w.resolved && [w.aId, w.bId].includes(mine.id))) return json(c.res, 400, { error: "قبیلهٔ شما هم‌اکنون در یک نبرد فعال است." });
  if (data.wars.some((w) => !w.resolved && [w.aId, w.bId].includes(target.id))) return json(c.res, 400, { error: "قبیلهٔ حریف در نبرد دیگری است." });
  const hours = Math.min(72, Math.max(1, num(b.hours, 24)));
  const w = { id: uid("w"), aId: mine.id, bId: target.id, startAt: Date.now(), endAt: Date.now() + hours * 36e5, scores: { [mine.id]: 0, [target.id]: 0 }, contrib: {}, resolved: false, winnerId: "", createdBy: u.id };
  data.wars.push(w);
  for (const m of [...clanMembers(mine), ...clanMembers(target)]) notify(m.id, "⚔️ نبرد قبیله آغاز شد!", `${mine.name} در برابر ${target.name} — ${hours} ساعت فرصت داری با برد و تجربه امتیاز بیاوری.`, "war", { warId: w.id });
  save(); json(c.res, 200, warPub(w));
});
on("GET", "/api/wars/:id", (c) => { resolveWars(); const w = data.wars.find((x) => x.id === c.params[0]); if (!w) return json(c.res, 404, { error: "not-found" }); json(c.res, 200, { ...warPub(w), top: Object.entries(w.contrib || {}).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, s]) => ({ user: pub(userById(id) || { id, name: "؟", xp: 0 }), score: s })) }); });

/* ---------- تورنمنت‌ها (عمومی، سازمانی، قبیله‌ای) ---------- */
on("GET", "/api/tournaments", (c) => { resolveTournaments(); const u = c.user; json(c.res, 200, data.tournaments.filter((t) => visibleTournament(t, u) || (u && u.role === "admin")).sort((a, b) => b.startAt - a.startAt).slice(0, 60).map((t) => tourPub(t, u))); });
on("POST", "/api/tournaments", async (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" });
  const b = await readBody(c.req); const scope = ["public", "org", "clan", "clans"].includes(b.scope) ? b.scope : "public";
  const admin = isAdmin(c.req, u); const mine = clanById(u.clanId);
  if (scope === "public" && !admin && !(mine && canManageClan(mine, u))) return json(c.res, 403, { error: "ساخت تورنمنت عمومی فقط برای مدیر یا رهبران قبیله است." });
  if (scope === "org" && !admin && !(u.org && u.orgVerified)) return json(c.res, 403, { error: "فقط اعضای تأییدشدهٔ سازمان یا مدیر." });
  if ((scope === "clan" || scope === "clans") && !admin && !(mine && canManageClan(mine, u))) return json(c.res, 403, { error: "فقط رهبر/افسر قبیله." });
  const title = str(b.title, 60); if (title.length < 3) return json(c.res, 400, { error: "عنوان کوتاه است." });
  const startAt = Math.max(Date.now(), num(b.startAt, Date.now())); const endAt = Math.max(startAt + 36e5, num(b.endAt, startAt + 48 * 36e5));
  const t = { id: uid("tr"), title, desc: str(b.desc, 300), category: str(b.category, 30) || "general", scope, org: scope === "org" ? (admin && b.org ? str(b.org, 40) : u.org) : "", clanIds: scope === "clan" ? [mine?.id].filter(Boolean) : scope === "clans" ? [...new Set([mine?.id, ...(Array.isArray(b.clanIds) ? b.clanIds : [])].filter(Boolean))] : [], creatorId: u.id, startAt, endAt, participants: [], scores: {}, resolved: false, prize: str(b.prize, 80) || "۳۰۰/۲۰۰/۱۰۰ سکه + جام", created_at: Date.now() };
  if (scope === "org") { for (const m of data.users.filter((x) => x.org === t.org && !x.banned)) { t.participants.push(m.id); t.scores[m.id] = 0; notify(m.id, `🏢 تورنمنت سازمانی ${t.org}`, `«${t.title}» برای همکاران ${t.org} باز شد؛ خودکار ثبت‌نام شدی.`, "tournament", { tid: t.id }); } }
  if (scope === "clan" && mine) for (const m of clanMembers(mine)) { t.participants.push(m.id); t.scores[m.id] = 0; notify(m.id, "🏆 تورنمنت قبیله", `«${t.title}» شروع می‌شود.`, "tournament", { tid: t.id }); }
  if (scope === "clans") for (const cid of t.clanIds) { const cl = clanById(cid); if (!cl) continue; for (const m of clanMembers(cl)) { t.participants.push(m.id); t.scores[m.id] = 0; notify(m.id, "⚔️ تورنمنت بین قبیله‌ها", `«${t.title}» — قبیلهٔ شما دعوت شد.`, "tournament", { tid: t.id }); } }
  data.tournaments.push(t); save(); json(c.res, 200, tourPub(t, u));
});
on("POST", "/api/tournaments/:id/join", (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" }); const t = data.tournaments.find((x) => x.id === c.params[0]); if (!t) return json(c.res, 404, { error: "not-found" });
  if (!visibleTournament(t, u)) return json(c.res, 403, { error: "این تورنمنت برای شما باز نیست." }); if (t.resolved) return json(c.res, 400, { error: "تورنمنت پایان یافته." });
  if (!(t.participants || []).includes(u.id)) { t.participants.push(u.id); t.scores[u.id] = t.scores[u.id] || 0; } save(); json(c.res, 200, tourPub(t, u));
});
on("GET", "/api/tournaments/:id", (c) => { resolveTournaments(); const t = data.tournaments.find((x) => x.id === c.params[0]); if (!t) return json(c.res, 404, { error: "not-found" }); json(c.res, 200, tourPub(t, c.user)); });
on("DELETE", "/api/tournaments/:id", (c) => { const t = data.tournaments.find((x) => x.id === c.params[0]); if (!t) return json(c.res, 404, { error: "not-found" }); if (!isAdmin(c.req, c.user) && t.creatorId !== c.user?.id) return json(c.res, 403, { error: "forbidden" }); data.tournaments = data.tournaments.filter((x) => x.id !== t.id); save(); json(c.res, 200, { ok: true }); });

/* ---------- صف نظارت بر پست و استوری (بدون اختلال در انتشار خودکار) ---------- */
on("POST", "/api/moderation", async (c) => {
  const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" });
  const b = await readBody(c.req); const localId = str(b.localId, 40); if (!localId) return json(c.res, 400, { error: "localId" });
  let item = data.moderation.find((m) => m.localId === localId && m.userId === u.id);
  if (!item) { item = { id: uid("md"), localId, userId: u.id, kind: b.kind === "story" ? "story" : "post", text: str(b.text, 1000), image: typeof b.image === "string" && b.image.startsWith("data:image/") && b.image.length < 400000 ? b.image : "", status: "auto", editedText: null, hidden: false, featured: false, at: Date.now(), updatedAt: Date.now(), source: str(b.source, 20) || "user" }; data.moderation.push(item); if (data.moderation.length > 3000) data.moderation = data.moderation.slice(-2500); }
  else if (item.text !== str(b.text, 1000) && item.status === "auto") { item.text = str(b.text, 1000); item.updatedAt = Date.now(); }
  save(); json(c.res, 200, { ok: true, id: item.id });
});
on("GET", "/api/moderation/mine", (c) => { const u = c.user; if (!u) return json(c.res, 401, { error: "not-authed" }); const since = num(Number(c.url.searchParams.get("since")), 0); json(c.res, 200, data.moderation.filter((m) => m.userId === u.id && m.updatedAt > since && (m.editedText !== null || m.hidden || m.featured || m.status !== "auto")).map((m) => ({ localId: m.localId, kind: m.kind, text: m.editedText ?? m.text, hidden: m.hidden, featured: m.featured, status: m.status, updatedAt: m.updatedAt }))); });
on("GET", "/api/moderation", (c) => { if (!isAdmin(c.req, c.user)) return json(c.res, 403, { error: "forbidden" }); const st = c.url.searchParams.get("status") || ""; json(c.res, 200, data.moderation.filter((m) => !st || m.status === st || (st === "hidden" && m.hidden)).slice(-300).reverse().map((m) => ({ ...m, image: m.image ? m.image : "", user: pub(userById(m.userId) || { id: "", name: "؟", xp: 0 }) }))); });
on("PATCH", "/api/moderation/:id", async (c) => {
  if (!isAdmin(c.req, c.user)) return json(c.res, 403, { error: "forbidden" }); const m = data.moderation.find((x) => x.id === c.params[0]); if (!m) return json(c.res, 404, { error: "not-found" });
  const b = await readBody(c.req);
  if (typeof b.text === "string") { m.editedText = str(b.text, 1000); m.status = "edited"; }
  if (b.action === "approve") { m.status = "approved"; m.hidden = false; }
  if (b.action === "hide") { m.hidden = true; m.status = "hidden"; notify(m.userId, "پست/استوری شما پنهان شد", "مدیر محتوای شما را موقتاً پنهان کرد.", "moderation"); }
  if (b.action === "restore") { m.hidden = false; m.status = m.editedText !== null ? "edited" : "approved"; }
  if (b.action === "feature") { m.featured = !m.featured; m.status = m.featured ? "featured" : "approved"; if (m.featured) notify(m.userId, "⭐ محتوای شما برگزیده شد", "مدیر پست/استوری شما را برگزیده کرد. آفرین!", "moderation"); }
  m.updatedAt = Date.now(); m.reviewedBy = c.user?.name || "admin"; save(); json(c.res, 200, m);
});

/* ---------- مدیریت ---------- */
on("POST", "/api/admin/login", async (c) => { const b = await readBody(c.req); if (String(b.key || "") !== ADMIN_KEY) return json(c.res, 403, { error: "کلید مدیر نادرست است." }); if (c.user) { c.user.role = "admin"; save(); } json(c.res, 200, { ok: true, me: c.user ? me(c.user) : null }); });
on("GET", "/api/admin/overview", (c) => {
  if (!isAdmin(c.req, c.user)) return json(c.res, 403, { error: "forbidden" });
  const day = Date.now() - 864e5;
  json(c.res, 200, { users: data.users.length, activeToday: data.users.filter((u) => u.last_seen > day).length, google: data.users.filter((u) => u.provider === "google").length, clans: data.clans.length, wars: data.wars.length, liveWars: data.wars.filter((w) => !w.resolved).length, tournaments: data.tournaments.length, pending: data.moderation.filter((m) => m.status === "auto").length, orgs: data.orgs.map((o) => ({ name: o, members: data.users.filter((u) => u.org === o).length, verified: data.users.filter((u) => u.org === o && u.orgVerified).length })), adminKeyHint: ADMIN_KEY.slice(0, 3) + "…", recent: data.users.slice(-8).reverse().map(pub) });
});
on("GET", "/api/admin/users", (c) => { if (!isAdmin(c.req, c.user)) return json(c.res, 403, { error: "forbidden" }); const q = str(c.url.searchParams.get("q"), 40); json(c.res, 200, data.users.filter((u) => !q || u.name.includes(q) || (u.email || "").includes(q) || (u.org || "").includes(q)).sort((a, b) => b.last_seen - a.last_seen).slice(0, 200).map((u) => ({ ...pub(u), email: u.email, banned: !!u.banned, orgCode: u.orgCode || "" }))); });
on("PATCH", "/api/admin/users/:id", async (c) => {
  if (!isAdmin(c.req, c.user)) return json(c.res, 403, { error: "forbidden" }); const u = userById(c.params[0]); if (!u) return json(c.res, 404, { error: "not-found" });
  const b = await readBody(c.req);
  if (typeof b.org === "string") u.org = str(b.org, 40); if (typeof b.orgVerified === "boolean") { u.orgVerified = b.orgVerified; if (b.orgVerified) notify(u.id, "🏢 عضویت سازمانی تأیید شد", `عضویت شما در ${u.org} تأیید شد؛ تورنمنت‌های سازمانی برایتان باز است.`, "org"); }
  if (typeof b.banned === "boolean") u.banned = b.banned; if (b.role === "admin" || b.role === "user") u.role = b.role;
  if (typeof b.coins === "number") u.coins = Math.max(0, Math.round(b.coins));
  save(); json(c.res, 200, { ...pub(u), email: u.email, banned: !!u.banned });
});
on("POST", "/api/admin/orgs", async (c) => { if (!isAdmin(c.req, c.user)) return json(c.res, 403, { error: "forbidden" }); const b = await readBody(c.req); if (Array.isArray(b.orgs)) data.orgs = [...new Set(b.orgs.map((o) => str(o, 40)).filter(Boolean))].slice(0, 60); save(); json(c.res, 200, data.orgs); });
on("POST", "/api/admin/broadcast", async (c) => { if (!isAdmin(c.req, c.user)) return json(c.res, 403, { error: "forbidden" }); const b = await readBody(c.req); const title = str(b.title, 80), body = str(b.body, 240); if (!title) return json(c.res, 400, { error: "title" }); const targets = data.users.filter((u) => !b.org || u.org === b.org); for (const u of targets) notify(u.id, title, body, "broadcast"); save(); json(c.res, 200, { sent: targets.length }); });

/* ---------- سرور HTTP ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    if (p.startsWith("/api/") || p.startsWith("/auth/") || p === "/health") {
      if (req.method !== "GET" && !originOk(req)) return json(res, 403, { error: "مبدأ درخواست مجاز نیست." });
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = p.match(r.re); if (!m) continue;
        const user = authUser(req);
        if (user && user.banned && !p.startsWith("/api/me") && p !== "/api/auth/logout") return json(res, 403, { error: "حساب شما مسدود است." });
        return await r.handler({ req, res, url, params: m.slice(1), user });
      }
      if (p.startsWith("/api/")) return json(res, 404, { error: "not-found" });
    }
    /* فایل‌های استاتیک */
    let file = path.normalize(path.join(DIST, p === "/" ? "index.html" : p));
    if (!file.startsWith(DIST)) file = path.join(DIST, "index.html");
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": file.endsWith(".html") ? "no-store" : "public, max-age=600" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e); json(res, 500, { error: "server-error" });
  }
});
setInterval(() => { try { resolveWars(); resolveTournaments(); } catch (e) { console.error(e); } }, 60e3).unref();
server.listen(PORT, HOST, () => console.log(`Gamify app server v${VERSION} ready on ${BASE_URL} (port ${PORT}) · data: ${DATA_DIR} · admin key file: ${ADMIN_KEY_FILE}`));
