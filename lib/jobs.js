import { getJSON, setJSON } from "./redis";
import { INDIA_HINTS } from "./seed";
import { bumpUsage, touchLastActive } from "./usage";

// ---------- Board fetchers ----------
async function tryFetch(url, opts = {}) {
  try {
    const res = await fetch(url, { ...opts, cache: "no-store", signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fromGreenhouse(slug) {
  const j = await tryFetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
  if (!j || !Array.isArray(j.jobs)) return null;
  return j.jobs.map((x) => ({
    id: `gh-${slug}-${x.id}`,
    title: x.title,
    url: x.absolute_url,
    location: x.location?.name || "",
    postedAt: x.updated_at || null
  }));
}

async function fromLever(slug) {
  const j = await tryFetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if (!Array.isArray(j)) return null;
  return j.map((x) => ({
    id: `lv-${slug}-${x.id}`,
    title: x.text,
    url: x.hostedUrl,
    location: x.categories?.location || "",
    postedAt: x.createdAt ? new Date(x.createdAt).toISOString() : null
  }));
}

async function fromAshby(slug) {
  const j = await tryFetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=false`);
  if (!j || !Array.isArray(j.jobs)) return null;
  return j.jobs.map((x) => ({
    id: `ab-${slug}-${x.id}`,
    title: x.title,
    url: x.jobUrl || x.applyUrl,
    location: x.location || "",
    postedAt: x.publishedAt || null
  }));
}

async function fromSmartRecruiters(slug) {
  const j = await tryFetch(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`);
  if (!j || !Array.isArray(j.content)) return null;
  return j.content.map((x) => ({
    id: `sr-${slug}-${x.id}`,
    title: x.name,
    url: `https://jobs.smartrecruiters.com/${slug}/${x.id}`,
    location: [x.location?.city, x.location?.country].filter(Boolean).join(", "),
    postedAt: x.releasedDate || null
  }));
}

// ---------- Smart page reader (Claude-powered, for custom careers sites) ----------
async function fromCustomPage(url) {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JobRadar/1.0)" } });
    if (!res.ok) return null;
    let html = await res.text();
    // Strip scripts/styles/tags down to readable text with links preserved
    html = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
    html = html.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>/gi, " [LINK:$1] ");
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 30000);

    const ai = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        system: "You extract job postings from careers-page text. Respond with ONLY a JSON array, no prose, no markdown fences. Each item: {\"title\": string, \"url\": string or null (from the nearest [LINK:...] marker, resolved as given), \"location\": string or null}. Only include actual job postings. If none, return [].",
        messages: [{ role: "user", content: `Page URL: ${url}\n\nPage text:\n${text}` }]
      })
    });
    if (!ai.ok) return null;
    const data = await ai.json();
    const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").replace(/```json|```/g, "").trim();
    const jobs = JSON.parse(raw);
    if (!Array.isArray(jobs)) return null;
    return jobs.slice(0, 120).map((x) => {
      let link = x.url || url;
      if (link && link.startsWith("/")) { try { link = new URL(link, url).href; } catch { link = url; } }
      return {
        id: "cp-" + Buffer.from(`${url}|${x.title}|${x.location || ""}`).toString("base64url").slice(0, 40),
        title: x.title, url: link, location: x.location || "", postedAt: null
      };
    });
  } catch { return null; }
}

const SOURCES = {
  greenhouse: fromGreenhouse,
  lever: fromLever,
  ashby: fromAshby,
  smartrecruiters: fromSmartRecruiters
};

function slugVariants(company) {
  const base = (company.slug || company.name).toLowerCase();
  const set = new Set([
    base,
    base.replace(/[^a-z0-9]/g, ""),
    base.replace(/\s+/g, "-"),
    base.replace(/\s+/g, "")
  ]);
  return [...set];
}

// Ask Claude to find a company's actual careers/openings page, so people
// don't have to go hunt down and paste the URL themselves.
async function discoverCareersUrl(company) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
        messages: [{
          role: "user",
          content: `Find the direct URL of ${company.name}'s official jobs/careers listing page — the page that lists their current open roles ` +
            `(could be on their own domain, or hosted on a third-party ATS). Not a generic "life at ${company.name}" marketing page. ` +
            `Reply with ONLY the URL and nothing else. If you genuinely cannot find one, reply with exactly: NONE`
        }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const m = raw.match(/https?:\/\/\S+/);
    if (!m) return null;
    return m[0].replace(/[.,)\]]+$/, "");
  } catch { return null; }
}

// Discover which job board a company uses; cache the answer in Redis.
export async function fetchCompanyJobs(company) {
  if (company.careersUrl) {
    const jobs = await fromCustomPage(company.careersUrl);
    if (jobs) return { jobs, source: { type: "custom" } };
    return { jobs: null, source: { type: "none" } };
  }
  const cacheKey = `source:${company.name}`;
  const cached = await getJSON(cacheKey);

  if (cached && cached.type !== "none") {
    const jobs = await SOURCES[cached.type](cached.slug);
    if (jobs) return { jobs, source: cached };
  }

  for (const slug of slugVariants(company)) {
    for (const [type, fn] of Object.entries(SOURCES)) {
      const jobs = await fn(slug);
      if (jobs && jobs.length) {
        const source = { type, slug };
        await setJSON(cacheKey, source);
        return { jobs, source };
      }
    }
  }

  // No known ATS — try to auto-discover the actual careers page (cached
  // globally per company name, so this only costs a search once, ever).
  const guessKey = `careersUrlGuess:${company.name}`;
  let guessedUrl = await getJSON(guessKey);
  if (guessedUrl === null) {
    guessedUrl = (await discoverCareersUrl(company)) || "none";
    await setJSON(guessKey, guessedUrl);
  }
  if (guessedUrl && guessedUrl !== "none") {
    const jobs = await fromCustomPage(guessedUrl);
    if (jobs && jobs.length) return { jobs, source: { type: "custom", url: guessedUrl, autoDiscovered: true } };
  }

  await setJSON(cacheKey, { type: "none" });
  return { jobs: null, source: { type: "none" } };
}

// ---------- Concurrency helper ----------
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// ---------- Web search fallback (Claude searches the web, like a person would) ----------
async function fromWebSearch(company, wants, indiaOnly) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        messages: [{
          role: "user",
          content: `Search the web for CURRENT open job openings at ${company.name}${indiaOnly ? " in India" : ""} that match this brief: ${wants}\n\n` +
            `Prefer the company's own careers site. Include a role only if you actually saw it listed as open.\n` +
            `Reply with ONLY a JSON array, no prose and no markdown fences: [{"title": string, "url": string, "location": string}]. If you find none, reply []`
        }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const jobs = JSON.parse(m[0]);
    if (!Array.isArray(jobs)) return null;
    return jobs.slice(0, 25).map((x) => ({
      id: "ws-" + Buffer.from(`${company.name}|${x.title}|${x.location || ""}`).toString("base64url").slice(0, 40),
      title: x.title, url: x.url || linkedinFallback(company.name), location: x.location || "", postedAt: null
    }));
  } catch { return null; }
}

// ---------- Relevance ----------
export function isRelevant(job, settings) {
  const t = (job.title || "").toLowerCase();
  const loc = (job.location || "").toLowerCase();
  if (settings.excludeKeywords?.some((k) => t.includes(k.toLowerCase()))) return false;
  const hit = settings.includeKeywords?.some((k) => t.includes(k.toLowerCase()));
  if (!hit) return false;
  if (settings.indiaOnly && loc) {
    if (!INDIA_HINTS.some((h) => loc.includes(h))) return false;
  }
  return true;
}

// Claude judges relevance against the person's own words — no keyword tuning needed.
async function aiFilter(pool, wants, profile) {
  const chunks = [];
  for (let i = 0; i < pool.length; i += 250) chunks.push(pool.slice(i, i + 250));

  const keptSets = await mapLimit(chunks, 4, async (chunk) => {
    try {
      const listing = chunk.map((j, i) => `${i}. ${j.title} — ${j.company}${j.location ? ` (${j.location})` : ""}`).join("\n");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1500,
          system: "You screen job listings for one person. Keep a role only if this person would plausibly apply — right function and right seniority band. Be moderately generous with job-title wording (titles vary between companies) but strict about function and level. Reply with ONLY a JSON array of the numbers to keep, e.g. [0,4,9]. No prose.",
          messages: [{ role: "user", content: `WHAT THEY WANT:\n${wants}\n\nTHEIR BACKGROUND:\n${profile}\n\nLISTINGS:\n${listing}` }]
        })
      });
      if (!res.ok) return null;
      const data = await res.json();
      const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      const m = raw.match(/\[[\s\S]*?\]/);
      if (!m) return null;
      const idx = JSON.parse(m[0]);
      if (!Array.isArray(idx)) return null;
      return idx.filter((n) => Number.isInteger(n) && chunk[n]).map((n) => chunk[n]);
    } catch { return null; }
  });

  if (keptSets.some((s) => s === null)) return null; // any failure -> caller falls back to keywords
  return keptSets.flat();
}

export function linkedinFallback(companyName) {
  const q = encodeURIComponent(companyName);
  return `https://www.linkedin.com/jobs/search/?keywords=${q}&location=India`;
}

// ---------- Full sweep ----------
export async function runSweep(user) {
  await bumpUsage(`usage:sweeps:${user}`);
  await touchLastActive(user);
  const companies = (await getJSON(`companies:${user}`, null)) || [];
  const settings = (await getJSON(`settings:${user}`, null)) || {};
  const seen = new Set((await getJSON(`seenJobs:${user}`, [])) || []);

  const aiOn = settings.aiMatch !== false;
  const wants = (settings.targetRoles && settings.targetRoles.trim())
    || (settings.includeKeywords || []).join(", ")
    || "roles matching my background";
  const profile = settings.profile || "";

  // 1) Read every company's job board (fast, free, exact)
  const fetched = await mapLimit(companies, 8, async (c) => {
    const { jobs, source } = await fetchCompanyJobs(c);
    return { c, jobs, source };
  });

  // Remember any auto-discovered careers pages so future sweeps skip straight
  // to reading them instead of re-searching the web every time.
  let companiesChanged = false;
  for (const f of fetched) {
    if (f.source?.autoDiscovered && f.source.url && !f.c.careersUrl) {
      f.c.careersUrl = f.source.url;
      f.c.autoDetected = true;
      companiesChanged = true;
    }
  }
  if (companiesChanged) await setJSON(`companies:${user}`, companies);

  // 2) For companies with no readable board, let Claude search the web
  if (process.env.ANTHROPIC_API_KEY) {
    const needSearch = fetched.filter((f) => !f.jobs).slice(0, 8);
    await mapLimit(needSearch, 8, async (f) => {
      const jobs = await fromWebSearch(f.c, wants, !!settings.indiaOnly);
      if (jobs && jobs.length) { f.jobs = jobs; f.source = { type: "web search" }; }
    });
  }

  // 3) Pool the candidates
  const pool = [];
  for (const f of fetched) {
    if (!f.jobs) continue;
    for (const j of f.jobs) {
      const t = (j.title || "").toLowerCase();
      const loc = (j.location || "").toLowerCase();
      if ((settings.excludeKeywords || []).some((k) => t.includes(k.toLowerCase()))) continue;
      if (settings.indiaOnly && loc && !INDIA_HINTS.some((h) => loc.includes(h))) continue;
      pool.push({ ...j, company: f.c.name });
    }
  }

  // 4) Judge relevance with Claude; fall back to keywords if that fails
  let matched = null;
  if (aiOn && pool.length && process.env.ANTHROPIC_API_KEY) {
    matched = await aiFilter(pool.slice(0, 1000), wants, profile);
  }
  let matchMode = "AI";
  if (!matched) { matched = pool.filter((j) => isRelevant(j, settings)); matchMode = "keywords"; }

  const byCompany = new Map();
  for (const m of matched) {
    if (!byCompany.has(m.company)) byCompany.set(m.company, []);
    byCompany.get(m.company).push({ ...m, isNew: !seen.has(m.id) });
  }

  const results = fetched.map((f) => {
    if (!f.jobs) return { company: f.c.name, status: "manual", link: linkedinFallback(f.c.name), matches: [] };
    const matches = byCompany.get(f.c.name) || [];
    matches.forEach((m) => seen.add(m.id));
    return { company: f.c.name, status: f.source.type, total: f.jobs.length, matches };
  });

  const all = results.flatMap((r) => r.matches);
  const sweep = {
    at: new Date().toISOString(),
    companiesScanned: companies.length,
    matchMode,
    results,
    newCount: all.filter((m) => m.isNew).length,
    matchCount: all.length
  };

  await setJSON(`seenJobs:${user}`, [...seen].slice(-5000));
  await setJSON(`lastSweep:${user}`, sweep);
  return sweep;
}
