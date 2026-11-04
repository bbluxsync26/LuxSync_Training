const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: JSON_HEADERS
  });
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function authenticatedIdentity(ctx) {
  if (!ctx.access) return null;
  const identity = await ctx.access.getIdentity();
  if (!identity || !identity.email) return null;
  return {
    accessId: String(identity.id || identity.sub || identity.email),
    email: cleanEmail(identity.email),
    name: identity.name ? String(identity.name) : null
  };
}

async function upsertUser(db, identity) {
  await db.prepare(
    "INSERT INTO users (access_id, email, display_name, created_at, last_seen_at) VALUES (?1, ?2, ?3, datetime('now'), datetime('now')) " +
    "ON CONFLICT(access_id) DO UPDATE SET email=excluded.email, display_name=COALESCE(excluded.display_name, users.display_name), last_seen_at=datetime('now')"
  ).bind(identity.accessId, identity.email, identity.name).run();

  return db.prepare(
    "SELECT id, access_id, email, display_name, role, created_at, last_seen_at FROM users WHERE access_id=?1"
  ).bind(identity.accessId).first();
}

function safeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output = {};
  Object.keys(value).slice(0, 100).forEach((key) => {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key)) return;
    const item = value[key];
    if (typeof item === "boolean" || typeof item === "number" || typeof item === "string") {
      output[key] = typeof item === "string" ? item.slice(0, 250) : item;
    }
  });
  return output;
}

function completionStats(progress, streak) {
  const completed = Object.keys(progress || {}).filter((key) => progress[key] === true && key !== "lastModule").length;
  const total = 11;
  return {
    completed,
    total,
    percent: Math.min(100, Math.round((completed / total) * 100)),
    streak
  };
}

async function recordVisit(db, userId) {
  await db.prepare(
    "INSERT OR IGNORE INTO daily_activity (user_id, activity_date, event_type, created_at) VALUES (?1, date('now'), 'visit', datetime('now'))"
  ).bind(userId).run();

  const result = await db.prepare(
    "SELECT activity_date FROM daily_activity WHERE user_id=?1 AND event_type='visit' ORDER BY activity_date DESC LIMIT 366"
  ).bind(userId).all();

  const dates = new Set((result.results || []).map((row) => row.activity_date));
  let streak = 0;
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);

  const today = cursor.toISOString().slice(0, 10);
  if (!dates.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);

  while (dates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

async function readProgress(db, userId) {
  const row = await db.prepare(
    "SELECT progress_json, updated_at FROM user_progress WHERE user_id=?1"
  ).bind(userId).first();

  if (!row) return { progress: {}, updatedAt: null };
  try {
    return { progress: JSON.parse(row.progress_json), updatedAt: row.updated_at };
  } catch {
    return { progress: {}, updatedAt: row.updated_at };
  }
}

async function readBody(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 65536) throw new Error("Request body is too large.");
  return request.json();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (!env.DB) return json({ error: "D1 database binding DB is not configured." }, 503);

    let identity;
    try {
      identity = await authenticatedIdentity(ctx);
    } catch {
      return json({ error: "Unable to verify Cloudflare Access identity." }, 401);
    }

    if (!identity) {
      return json({ error: "Cloudflare Access authentication is required." }, 401);
    }

    if (!identity.email.endsWith("@luxsync.net")) {
      return json({ error: "A LuxSync email account is required." }, 403);
    }

    const user = await upsertUser(env.DB, identity);
    const route = url.pathname.replace(/^\/api\/?/, "");

    try {
      if (request.method === "GET" && route === "health") {
        return json({ ok: true, authenticated: true });
      }

      if (request.method === "GET" && route === "me") {
        return json({
          user: {
            id: user.access_id,
            email: user.email,
            name: user.display_name,
            role: user.role
          }
        });
      }

      if (request.method === "GET" && route === "progress") {
        const streak = await recordVisit(env.DB, user.id);
        const record = await readProgress(env.DB, user.id);
        return json({
          progress: record.progress,
          stats: completionStats(record.progress, streak),
          updatedAt: record.updatedAt
        });
      }

      if (request.method === "PUT" && route === "progress") {
        const body = await readBody(request);
        const progress = safeObject(body.progress);
        if (!progress) return json({ error: "A valid progress object is required." }, 400);

        const encoded = JSON.stringify(progress);
        if (encoded.length > 60000) return json({ error: "Progress record is too large." }, 413);

        await env.DB.prepare(
          "INSERT INTO user_progress (user_id, progress_json, updated_at) VALUES (?1, ?2, datetime('now')) " +
          "ON CONFLICT(user_id) DO UPDATE SET progress_json=excluded.progress_json, updated_at=datetime('now')"
        ).bind(user.id, encoded).run();

        const streak = await recordVisit(env.DB, user.id);
        return json({
          ok: true,
          stats: completionStats(progress, streak),
          updatedAt: new Date().toISOString()
        });
      }

      if (request.method === "GET" && route === "simulator-attempts") {
        const result = await env.DB.prepare(
          "SELECT scenario, score, created_at AS date FROM simulator_attempts WHERE user_id=?1 ORDER BY created_at DESC LIMIT 50"
        ).bind(user.id).all();
        return json({ attempts: result.results || [] });
      }

      if (request.method === "POST" && route === "simulator-attempts") {
        const body = await readBody(request);
        const scenario = String(body.scenario || "Simulation").slice(0, 200);
        const score = Math.max(0, Math.min(1000, Number(body.score) || 0));
        await env.DB.prepare(
          "INSERT INTO simulator_attempts (user_id, scenario, score, created_at) VALUES (?1, ?2, ?3, datetime('now'))"
        ).bind(user.id, scenario, score).run();
        return json({ ok: true }, 201);
      }

      if (request.method === "GET" && route === "quiz-attempts") {
        const result = await env.DB.prepare(
          "SELECT module_id, score, max_score, passed, created_at FROM quiz_attempts WHERE user_id=?1 ORDER BY created_at DESC LIMIT 100"
        ).bind(user.id).all();
        return json({ attempts: result.results || [] });
      }

      if (request.method === "POST" && route === "quiz-attempts") {
        const body = await readBody(request);
        const moduleId = String(body.moduleId || "").slice(0, 80);
        if (!moduleId) return json({ error: "moduleId is required." }, 400);
        const score = Number(body.score) || 0;
        const maxScore = Math.max(1, Number(body.maxScore) || 1);
        const passed = body.passed ? 1 : 0;
        await env.DB.prepare(
          "INSERT INTO quiz_attempts (user_id, module_id, score, max_score, passed, created_at) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))"
        ).bind(user.id, moduleId, score, maxScore, passed).run();
        return json({ ok: true }, 201);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: "The progress service could not complete this request." }, 500);
    }
  }
};