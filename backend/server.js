/**
 * Network Traceroute API Server
 *
 * A modern API for running traceroute with geolocation and visualizing network paths.
 * Uses MTR (My Traceroute) for network path analysis and multiple geolocation providers.
 */

const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const util = require("util");

// Configuration
const CONFIG = {
  PORT: process.env.PORT || 3001,
  MTR_BIN: process.env.MTR_BIN || "mtr",
  MTR_COUNT: parseInt(process.env.MTR_COUNT || "3"),
  REQUEST_TIMEOUT_MS: parseInt(process.env.REQUEST_TIMEOUT_MS || "20000"),
  IP_LOOKUP_URL: process.env.IP_LOOKUP_URL || "https://api.ipify.org?format=json",
  GEO_PRIMARY_URL: process.env.GEO_PRIMARY_URL || "https://ipwho.is",
  TARGET_REGEX: /^[a-zA-Z0-9_.:-]+$/,
  CACHE_TTL_MS: 3600000 // 1 hour
};

const execAsync = util.promisify(exec);
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// In-memory cache with TTL
class GeoCache {
  constructor(ttl) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  size() {
    return this.cache.size;
  }
}

const geoCache = new GeoCache(CONFIG.CACHE_TTL_MS);

// ============================================================================
// API Routes
// ============================================================================

/**
 * Health check endpoint
 */
app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    cache: {
      size: geoCache.size()
    }
  });
});

/**
 * Diagnostic endpoint - Test MTR functionality
 */
app.get("/diag", async (_req, res) => {
  try {
    const testTarget = "8.8.8.8";
    const hops = await runTraceroute(testTarget);
    const publicHops = hops.filter(h => h.ip && !isPrivateIP(h.ip));

    res.json({
      status: "ok",
      mtrPath: CONFIG.MTR_BIN,
      mtrCount: CONFIG.MTR_COUNT,
      testTarget,
      totalHops: hops.length,
      publicHops: publicHops.length,
      hops: hops.map(h => ({
        hop: h.hop,
        ip: h.ip,
        hostname: h.hostname,
        rtt: h.rtt,
        isPrivate: h.ip ? isPrivateIP(h.ip) : null
      }))
    });
  } catch (err) {
    console.error("Diagnostic failed:", err);
    res.status(500).json({
      status: "error",
      error: err.message,
      mtrPath: CONFIG.MTR_BIN
    });
  }
});

/**
 * Main traceroute endpoint
 */
app.get("/trace", async (req, res) => {
  const target = (req.query.target || "").trim();

  // Validate target
  if (!target || !CONFIG.TARGET_REGEX.test(target)) {
    return res.status(400).json({
      error: "Invalid or missing target parameter",
      message: "Target must contain only alphanumeric characters, dots, hyphens, colons, or underscores"
    });
  }

  try {
    console.log(`[TRACE] Starting traceroute to ${target}`);
    const startTime = Date.now();

    // Run traceroute
    const hops = await runTraceroute(target);
    console.log(`[TRACE] Received ${hops.length} hops from MTR`);

    // Log hop details
    hops.forEach(h => {
      const status = !h.ip ? "NO_IP" : isPrivateIP(h.ip) ? "PRIVATE" : "PUBLIC";
      console.log(`  Hop ${h.hop}: ${h.ip || "???"} (${h.hostname}) [${status}] RTT: ${h.rtt || "N/A"}ms`);
    });

    // Enrich with geolocation
    const enriched = await enrichWithGeo(hops);
    const publicHops = enriched.filter(h => h.ip && !isPrivateIP(h.ip));
    const geoHops = enriched.filter(h => h.lat && h.lon);

    const duration = Date.now() - startTime;
    console.log(`[TRACE] Completed in ${duration}ms - ${geoHops.length}/${publicHops.length} public hops with geo`);

    res.json({
      success: true,
      target,
      stats: {
        totalHops: hops.length,
        publicHops: publicHops.length,
        geolocatedHops: geoHops.length,
        durationMs: duration
      },
      hops: enriched,
      metadata: {
        source: "mtr",
        geoProvider: "ipwho.is + ipapi.co",
        timestamp: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error(`[TRACE] Failed for ${target}:`, err);
    res.status(500).json({
      success: false,
      error: "Traceroute failed",
      message: err.message,
      target
    });
  }
});

/**
 * Public IP detection endpoint
 */
app.get("/whoami", async (_req, res) => {
  try {
    console.log("[WHOAMI] Detecting public IP...");
    const ip = await lookupPublicIP();

    if (!ip) {
      throw new Error("No IP returned from upstream service");
    }

    const geo = await geolocate(ip);
    console.log(`[WHOAMI] Detected IP ${ip} - ${geo ? `${geo.city}, ${geo.country}` : "no geo"}`);

    res.json({
      success: true,
      ip,
      geo,
      source: "ipify.org + ipwho.is"
    });

  } catch (err) {
    console.error("[WHOAMI] Failed:", err);
    res.status(500).json({
      success: false,
      error: "Failed to detect public IP",
      message: err.message
    });
  }
});

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Run MTR traceroute and parse results
 */
async function runTraceroute(target) {
  const cmd = `${CONFIG.MTR_BIN} --report --report-wide -c ${CONFIG.MTR_COUNT} --json ${target}`;
  console.log(`[MTR] Executing: ${cmd}`);

  const { stdout, stderr } = await execAsync(cmd, {
    timeout: CONFIG.REQUEST_TIMEOUT_MS
  });

  if (stderr) console.warn("[MTR] stderr:", stderr);

  // Try JSON parsing first
  try {
    const json = JSON.parse(stdout);
    return parseMtrJson(json);
  } catch (e) {
    console.warn("[MTR] JSON parse failed, falling back to text parsing");
    return parseMtrText(stdout);
  }
}

/**
 * Parse MTR JSON output
 */
function parseMtrJson(json) {
  if (!json?.report?.hubs || !Array.isArray(json.report.hubs)) {
    return [];
  }

  return json.report.hubs.map((hub, idx) => {
    const hostString = hub.host || hub.hostname || hub.ip || null;
    const isIP = hostString && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostString);

    return {
      hop: idx + 1,
      ip: isIP ? hostString : (hub.ip || null),
      hostname: hostString,
      rtt: getFirstValidNumber(hub.avg, hub.last, hub.best, hub.wst)
    };
  });
}

/**
 * Parse MTR text output (fallback)
 */
function parseMtrText(text) {
  const hops = [];
  const lines = text.split("\n");

  for (const line of lines) {
    if (!/^\s*\d+\.\|--/.test(line)) continue;

    const hopMatch = line.match(/^\s*(\d+)/);
    const ipMatch = line.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    const hostMatch = line.match(/\d+\.\|--\s*([^\s(]+)/);
    const rttMatch = line.match(/(\d+(?:\.\d+)?)\s*ms/);

    hops.push({
      hop: hopMatch ? parseInt(hopMatch[1]) : hops.length + 1,
      ip: ipMatch ? ipMatch[1] : null,
      hostname: hostMatch ? hostMatch[1] : (ipMatch ? ipMatch[1] : null),
      rtt: rttMatch ? parseFloat(rttMatch[1]) : null
    });
  }

  return hops;
}

/**
 * Enrich hops with geolocation data
 */
async function enrichWithGeo(hops) {
  const enriched = [];

  for (const hop of hops) {
    // Skip if no IP or private IP
    if (!hop.ip || isPrivateIP(hop.ip)) {
      enriched.push({ ...hop, isPrivate: true });
      continue;
    }

    // Get geolocation
    const geo = await geolocate(hop.ip);
    enriched.push({
      ...hop,
      isPrivate: false,
      ...(geo || {})
    });
  }

  return enriched;
}

/**
 * Lookup public IP address
 */
async function lookupPublicIP() {
  const res = await fetch(CONFIG.IP_LOOKUP_URL);
  if (!res.ok) {
    throw new Error(`IP lookup failed: ${res.status}`);
  }
  const data = await res.json();
  return data.ip;
}

/**
 * Geolocate an IP address using multiple providers
 */
async function geolocate(ip) {
  // Check cache first
  const cached = geoCache.get(ip);
  if (cached) return cached;

  const providers = [
    // Primary: ipwho.is
    async () => {
      const res = await fetch(`${CONFIG.GEO_PRIMARY_URL}/${ip}`);
      if (!res.ok) return null;

      const data = await res.json();
      if (data.success === false) return null;
      if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;

      return {
        lat: data.latitude,
        lon: data.longitude,
        city: data.city || null,
        region: data.region || null,
        country: data.country || null,
        countryCode: data.country_code || null
      };
    },

    // Fallback: ipapi.co
    async () => {
      const res = await fetch(`https://ipapi.co/${ip}/json/`);
      if (!res.ok) return null;

      const data = await res.json();
      if (data.error) return null;
      if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;

      return {
        lat: data.latitude,
        lon: data.longitude,
        city: data.city || null,
        region: data.region || null,
        country: data.country_name || data.country || null,
        countryCode: data.country_code || null
      };
    }
  ];

  // Try each provider
  for (const provider of providers) {
    try {
      const geo = await provider();
      if (geo) {
        geoCache.set(ip, geo);
        return geo;
      }
    } catch (err) {
      console.warn(`[GEO] Provider failed for ${ip}:`, err.message);
    }
  }

  // Cache null result to avoid repeated lookups
  geoCache.set(ip, null);
  return null;
}

/**
 * Check if IP is private/local
 */
function isPrivateIP(ip) {
  if (!ip) return true;
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|::1|fe80:)/.test(ip);
}

/**
 * Get first valid number from arguments
 */
function getFirstValidNumber(...values) {
  for (const v of values) {
    const num = parseFloat(v);
    if (!isNaN(num) && isFinite(num)) return num;
  }
  return null;
}

// ============================================================================
// Server Startup
// ============================================================================

app.listen(CONFIG.PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  Network Traceroute API Server                                 ║
║  Listening on port ${CONFIG.PORT}                                        ║
║                                                                ║
║  Endpoints:                                                    ║
║    GET /healthz    - Health check                             ║
║    GET /diag       - Diagnostic test                          ║
║    GET /trace      - Traceroute with geolocation              ║
║    GET /whoami     - Detect your public IP                    ║
║                                                                ║
║  MTR: ${CONFIG.MTR_BIN} (count: ${CONFIG.MTR_COUNT})                                    ║
╚════════════════════════════════════════════════════════════════╝
  `);
});
