const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const util = require("util");

const execAsync = util.promisify(exec);
const PORT = process.env.PORT || 3001;
const IP_LOOKUP_URL = process.env.IP_LOOKUP_URL || "https://api.ipify.org?format=json";
const GEO_LOOKUP_URL = process.env.GEO_LOOKUP_URL || "https://ipwho.is";
const MTR_BIN = process.env.MTR_BIN || "mtr";
const TARGET_RE = /^[a-zA-Z0-9_.:-]+$/; // simple sanity check to avoid command injection
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const geoCache = new Map();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/healthz", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get("/diag", async (_req, res) => {
  try {
    // Quick diagnostic to test if we can reach public internet and run mtr
    const testTarget = "8.8.8.8";
    const cmd = `${MTR_BIN} --report --report-wide -c 1 --json ${testTarget}`;
    const { stdout } = await execAsync(cmd, { timeout: 10000 });

    let hops = [];
    try {
      const json = JSON.parse(stdout);
      hops = parseMtrJson(json);
    } catch {
      hops = parseMtrText(stdout);
    }

    const publicHops = hops.filter(h => h.ip && !isPrivateIP(h.ip));

    res.json({
      status: "ok",
      mtrPath: MTR_BIN,
      testTarget,
      totalHops: hops.length,
      publicHops: publicHops.length,
      hops: hops.map(h => ({
        hop: h.hop,
        ip: h.ip,
        hostname: h.hostname,
        isPrivate: h.ip ? isPrivateIP(h.ip) : null
      }))
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      error: err.message,
      mtrPath: MTR_BIN
    });
  }
});

app.get("/trace", async (req, res) => {
  const target = (req.query.target || "").trim();
  if (!target || !TARGET_RE.test(target)) {
    return res.status(400).json({ error: "Invalid or missing target parameter." });
  }

  try {
    const hops = await runTraceroute(target);
    console.log(`Traceroute to ${target} returned ${hops.length} hops`);
    hops.forEach(h => console.log(`  Hop ${h.hop}: ${h.ip} (${h.hostname}) - ${isPrivateIP(h.ip || '') ? 'PRIVATE' : 'PUBLIC'}`));

    const enriched = await enrichWithGeo(hops);
    const publicHops = enriched.filter(h => h.ip && !isPrivateIP(h.ip));

    res.json({
      target,
      count: enriched.length,
      publicCount: publicHops.length,
      hops: enriched,
      source: "local mtr inside Docker",
      geolocator: "ipwho.is"
    });
  } catch (err) {
    console.error("Trace failed:", err);
    res.status(500).json({ error: "Traceroute failed", detail: err.message });
  }
});

app.get("/whoami", async (_req, res) => {
  try {
    const ip = await lookupPublicIP();
    if (!ip) throw new Error("No IP from upstream");

    const geo = await geolocate(ip);
    res.json({ ip, geo, source: "ipify + ipwho.is" });
  } catch (err) {
    console.error("whoami failed:", err);
    res.status(500).json({ error: "whoami failed", detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Traceroute API listening on :${PORT}`);
});

async function runTraceroute(target) {
  const cmd = `${MTR_BIN} --report --report-wide -c 3 --json ${target}`;
  console.log(`Running: ${cmd}`);
  const { stdout, stderr } = await execAsync(cmd, { timeout: REQUEST_TIMEOUT_MS });

  if (stderr) console.warn('mtr stderr:', stderr);

  // Prefer JSON output; fall back to parsing text if needed
  try {
    const json = JSON.parse(stdout);
    return parseMtrJson(json);
  } catch (e) {
    console.warn('Failed to parse mtr JSON, falling back to text parsing:', e.message);
    return parseMtrText(stdout);
  }
}

function parseMtrJson(json) {
  if (!json || !json.report || !Array.isArray(json.report.hubs)) return [];

  return json.report.hubs.map((hub, idx) => {
    // Extract host string (could be IP or hostname)
    const hostString = hub.host || hub.hostname || hub.ip || null;

    // Check if hostString is an IP address (simple IPv4 check)
    const isIP = hostString && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostString);

    return {
      hop: idx + 1,
      ip: isIP ? hostString : (hub.ip || null),
      hostname: hostString,
      rtt: firstNumber(hub.avg, hub.last, hub.best, hub.wst)
    };
  });
}

function parseMtrText(text) {
  const hops = [];
  text.split("\n").forEach(line => {
    if (!/^\s*\d+\.\|--/.test(line)) return;

    const hop = line.match(/^\s*(\d+)/);
    const ipMatch = line.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    const hostMatch = line.match(/\d+\.\|--\s*([^\s(]+)/);
    const rttMatch = line.match(/(\d+(?:\.\d+)?)\s*ms/);

    hops.push({
      hop: hop ? Number(hop[1]) : hops.length + 1,
      ip: ipMatch ? ipMatch[1] : null,
      hostname: hostMatch ? hostMatch[1] : ipMatch ? ipMatch[1] : null,
      rtt: rttMatch ? Number(rttMatch[1]) : null
    });
  });
  return hops;
}

async function enrichWithGeo(hops) {
  const results = [];
  for (const hop of hops) {
    if (!hop.ip || isPrivateIP(hop.ip)) {
      results.push(hop);
      continue;
    }

    const geo = await geolocate(hop.ip);
    results.push({
      ...hop,
      ...(geo || {})
    });
  }
  return results;
}

async function lookupPublicIP() {
  const res = await fetch(IP_LOOKUP_URL);
  if (!res.ok) throw new Error(`IP lookup failed: ${res.status}`);

  const data = await res.json();
  return data.ip;
}

async function geolocate(ip) {
  if (geoCache.has(ip)) return geoCache.get(ip);

  const providers = [
    async () => {
      const res = await fetch(`${GEO_LOOKUP_URL}/${ip}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.success === false) return null;
      if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;
      return {
        lat: data.latitude,
        lon: data.longitude,
        city: data.city,
        country: data.country
      };
    },
    async () => {
      // Fallback: ipapi.co (rate-limited but useful as a backup)
      const res = await fetch(`https://ipapi.co/${ip}/json/`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.error) return null;
      if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;
      return {
        lat: data.latitude,
        lon: data.longitude,
        city: data.city,
        country: data.country_name || data.country
      };
    }
  ];

  for (const provider of providers) {
    try {
      const geo = await provider();
      if (geo) {
        geoCache.set(ip, geo);
        return geo;
      }
    } catch (err) {
      console.warn(`Geolocation provider failed for ${ip}:`, err);
    }
  }

  geoCache.set(ip, null);
  return null;
}

function isPrivateIP(ip) {
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/.test(ip);
}

function firstNumber(...values) {
  for (const v of values) {
    const num = Number(v);
    if (!Number.isNaN(num)) return num;
  }
  return null;
}
