import { getJSON, setJSON } from "./redis";
import { INDIA_HINTS } from "./seed";

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
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 14000);

    const ai = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: "You extract job postings from careers-page text. Respond with ONLY a JSON array, no prose, no markdown fences. Each item: {\"title\": string, \"url\": string or null (from the nearest [LINK:...] marker, resolved as given), \"location\": string or null}. Only include actual job postings. If none, return [].",
        messages: [{ role: "user", content: `Page URL: ${url}\n\nPage text:\n${text}` }]
      })
    });
    if (!ai.ok) return null;
    const data = await ai.json();
    const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").replace(/```json|```/g, "").trim();
    const jobs = JSON.parse(raw);
    if (!Array.isArray(jobs)) return null;
    return jobs.slice(0, 80).map((x) => {
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
  await setJSON(cacheKey, { type: "none" });
  return { jobs: null, source: { type: "none" } };
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

export function linkedinFallback(companyName) {
  const q = encodeURIComponent(`${companyName} enterprise sales`);
  return `https://www.linkedin.com/jobs/search/?keywords=${q}&location=India`;
}

// ---------- Full sweep ----------
export async function runSweep(user) {
  const companies = (await getJSON(`companies:${user}`, null)) || [];
  const settings = (await getJSON(`settings:${user}`, null)) || {};
  const seen = new Set((await getJSON(`seenJobs:${user}`, [])) || []);

  const results = [];
  for (const c of companies) {
    const { jobs, source } = await fetchCompanyJobs(c);
    if (!jobs) {
      results.push({ company: c.name, status: "manual", link: linkedinFallback(c.name), matches: [] });
      continue;
    }
    const matches = jobs.filter((j) => isRelevant(j, settings)).map((j) => ({ ...j, company: c.name, isNew: !seen.has(j.id) }));
    matches.forEach((m) => seen.add(m.id));
    results.push({ company: c.name, status: source.type, total: jobs.length, matches });
  }

  const sweep = {
    at: new Date().toISOString(),
    companiesScanned: companies.length,
    results,
    newCount: results.flatMap((r) => r.matches).filter((m) => m.isNew).length,
    matchCount: results.flatMap((r) => r.matches).length
  };

  await setJSON(`seenJobs:${user}`, [...seen].slice(-5000));
  await setJSON(`lastSweep:${user}`, sweep);
  return sweep;
}
