// Cloudflare Worker for Yale 2013 AA self-scout -> Airtable
// Store AIRTABLE_TOKEN and AIRTABLE_BASE_ID as Worker secrets/variables.
// Do not put the Airtable token in index.html or commit it to GitHub.

const ALLOWED_ORIGINS = new Set([
  "https://josephiacuone.github.io",
  "https://brgallini.github.io",
]);

const PLAYERS_TABLE = "Players";
const SESSIONS_TABLE = "Sessions";
const REVIEWS_TABLE = "Self-Scout Reviews";

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://josephiacuone.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

function airtableUrl(env, table, suffix = "") {
  return `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}${suffix}`;
}

async function airtableFetch(env, table, suffix = "", options = {}) {
  const response = await fetch(airtableUrl(env, table, suffix), {
    ...options,
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `Airtable request failed (${response.status})`);
  }
  return body;
}

function safeNumber(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function copyRatings(target, source, keys) {
  for (const key of keys) {
    const v = source?.[key];
    if (["1", "2", "3", "4", "5"].includes(String(v))) {
      target[key] = String(v);
    }
  }
}

async function getBootstrap(env, sessionId) {
  if (!sessionId || !/^rec[A-Za-z0-9]{14}$/.test(sessionId)) {
    throw new Error("This link is missing a valid session.");
  }
  const [r, roster] = await Promise.all([
    airtableFetch(env, SESSIONS_TABLE, `/${sessionId}`),
    airtableFetch(
      env,
      PLAYERS_TABLE,
      "?pageSize=100&filterByFormula=" + encodeURIComponent("({Active}=1)")
    ),
  ]);

  const players = (roster.records || [])
    .map((record) => ({
      id: record.id,
      name: record.fields?.["Player Name"] || "",
      position: record.fields?.["Position"] || "",
    }))
    .filter((p) => p.name && ["Forward", "Defense", "Goaltender"].includes(p.position))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    session: {
      id: r.id,
      label: r.fields?.["Session"] || "",
      date: r.fields?.["Date"] || "",
      type: r.fields?.["Session Type"] || "",
      opponent: r.fields?.["Opponent / Session"] || "",
    },
    players,
  };
}

async function resolvePlayer(env, playerId, role) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(String(playerId || ""))) {
    throw new Error("Select your name from the roster.");
  }

  const record = await airtableFetch(env, PLAYERS_TABLE, `/${playerId}`);
  if (!record.fields?.["Active"]) {
    throw new Error("That player is not currently active on the roster.");
  }

  const rosterRole = record.fields?.["Position"] || "";
  if (rosterRole !== role) {
    throw new Error(`The selected player is listed as ${rosterRole || "an unknown position"}.`);
  }

  return record;
}

async function createReview(env, payload) {
  const sessionId = payload?.sessionId;
  const role = payload?.role;

  if (!/^rec[A-Za-z0-9]{14}$/.test(sessionId || "")) throw new Error("This form is missing a valid session.");
  if (!["Forward", "Defense", "Goaltender"].includes(role)) throw new Error("Choose a valid role.");

  const player = await resolvePlayer(env, payload?.playerId, role);

  const fields = {
    "Player": [player.id],
    "Role": role,
    "Session": [sessionId],
    "Shifts / Period Reviewed": String(payload?.shifts || "").trim(),
    "Did Well": String(payload?.reflection?.didWell || "").trim(),
    "Improve Habit": String(payload?.reflection?.improveHabit || "").trim(),
    "Next Habit": String(payload?.reflection?.nextHabit || "").trim(),
  };

  if (role !== "Goaltender") {
    const h = payload?.helios || {};
    const hustle = safeNumber(h.hustle);
    const load = safeNumber(h.load);
    const energy = safeNumber(h.energy);
    if (hustle !== undefined) fields["Hustle Score"] = hustle;
    if (load !== undefined) fields["Load"] = load;
    if (h.stride) fields["Stride Time"] = String(h.stride).trim();
    if (energy !== undefined) fields["Energy Ratio"] = energy;
    if (h.dataSuggests) fields["Data Suggests"] = String(h.dataSuggests).trim();
    if (["Yes", "No", "Not Sure"].includes(h.videoSupports)) fields["Video Supports Data"] = h.videoSupports;
    if (h.why) fields["Why"] = String(h.why).trim();

    copyRatings(fields, payload.ratings, [
      "GH01","GH02","GH03","GH04","GH05","GH06","GH07","GH08","GH09",
      "WP01","WP02","WP03","WP04","WP05",
    ]);
    if (role === "Forward") copyRatings(fields, payload.ratings, ["F01","F02","F03","F04"]);
    if (role === "Defense") copyRatings(fields, payload.ratings, ["D01","D02","D03","D04","D05"]);
  } else {
    copyRatings(fields, payload.ratings, [
      "GG01","GG02","GG03","GG04","GG05","GG06",
      "GP01","GP02","GP03","GP04","GP05",
      "GM01","GM02","GM03",
    ]);

    const goals = Array.isArray(payload.goals) ? payload.goals.slice(0, 4) : [];
    goals.forEach((g, i) => {
      const n = i + 1;
      if (["Yes", "No"].includes(g?.visible)) fields[`G${n} Visible`] = g.visible;
      if (["Yes", "No"].includes(g?.set)) fields[`G${n} Set`] = g.set;
      if (["Yes", "No"].includes(g?.position)) fields[`G${n} Position`] = g.position;
      if (["Yes", "Maybe", "No"].includes(g?.saveable)) fields[`G${n} Saveable`] = g.saveable;
      if (g?.different) fields[`G${n} Different`] = String(g.different).trim();
    });
  }

  const result = await airtableFetch(env, REVIEWS_TABLE, "", {
    method: "POST",
    body: JSON.stringify({ fields, typecast: true }),
  });
  return { id: result.id };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) {
      return json({ error: "Server is not configured." }, 500, origin);
    }

    try {
      if (request.method === "GET" && url.pathname === "/bootstrap") {
        const data = await getBootstrap(env, url.searchParams.get("session"));
        return json(data, 200, origin);
      }

      if (request.method === "POST" && url.pathname === "/submit") {
        if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed." }, 403, origin);
        const payload = await request.json();
        const result = await createReview(env, payload);
        return json({ ok: true, ...result }, 201, origin);
      }

      return json({ error: "Not found." }, 404, origin);
    } catch (error) {
      return json({ error: error?.message || "Unexpected server error." }, 400, origin);
    }
  },
};
