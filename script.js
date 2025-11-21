/**
 * Network Path Visualizer - REBUILT FROM SCRATCH
 * Simple, clean visualization of network routes
 */

// Configuration
const CONFIG = {
  API_BASE: window.API_BASE_URL || "http://192.168.2.230:3001",
  DEFAULT_TARGET: "google.com"
};

// Global state
let map = null;
let routeLine = null;
let hopMarkers = [];
let packets = [];
let animationFrame = null;

// DOM elements
const DOM = {
  targetInput: document.getElementById("targetInput"),
  traceBtn: document.getElementById("traceBtn"),
  statusMessage: document.getElementById("statusMessage"),
  clientInfo: document.getElementById("clientInfo"),
  apiInfo: document.getElementById("apiInfo"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  statsPanel: document.getElementById("statsPanel"),
  statTotalHops: document.getElementById("statTotalHops"),
  statPublicHops: document.getElementById("statPublicHops"),
  statGeoHops: document.getElementById("statGeoHops"),
  statDuration: document.getElementById("statDuration")
};

// Initialize
function init() {
  console.log("[INIT] Starting application");

  // Create map
  map = L.map("map").setView([20, 0], 2);

  // Add tiles
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19
  }).addTo(map);

  // Event listeners
  DOM.traceBtn.addEventListener("click", handleTrace);
  DOM.targetInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTrace();
    }
  });

  // Update API info
  DOM.apiInfo.querySelector(".info-text").textContent = `API: ${CONFIG.API_BASE}`;

  // Detect user location
  detectUserLocation();

  // Run initial trace
  runTrace(CONFIG.DEFAULT_TARGET);

  console.log("[INIT] Application ready");
}

// ============================================================================
// UI Functions
// ============================================================================

function showLoading() {
  DOM.loadingOverlay.style.display = "flex";
}

function hideLoading() {
  DOM.loadingOverlay.style.display = "none";
}

function showStatus(message, type = "info") {
  DOM.statusMessage.textContent = message;
  DOM.statusMessage.className = `status-message ${type}`;
}

function updateStats(stats) {
  if (!stats) {
    DOM.statsPanel.style.display = "none";
    return;
  }
  DOM.statTotalHops.textContent = stats.totalHops || 0;
  DOM.statPublicHops.textContent = stats.publicHops || 0;
  DOM.statGeoHops.textContent = stats.geolocatedHops || 0;
  DOM.statDuration.textContent = stats.durationMs ? `${stats.durationMs}ms` : "-";
  DOM.statsPanel.style.display = "block";
}

// ============================================================================
// API Functions
// ============================================================================

async function detectUserLocation() {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/whoami`);
    const data = await res.json();

    if (data.success && data.geo && data.geo.lat && data.geo.lon) {
      const userMarker = L.circleMarker([data.geo.lat, data.geo.lon], {
        radius: 7,
        color: "#f97316",
        fillColor: "#f97316",
        fillOpacity: 0.9,
        weight: 2,
        className: "user-marker"
      }).addTo(map);

      const loc = data.geo.city ? `${data.geo.city}, ${data.geo.country}` : data.geo.country;
      userMarker.bindPopup(`<b>Your Location</b><br>IP: ${data.ip}<br>${loc}`);

      DOM.clientInfo.querySelector(".info-text").textContent = `Your IP: ${data.ip} (${loc})`;
    } else {
      DOM.clientInfo.querySelector(".info-text").textContent = `Your IP: ${data.ip}`;
    }
  } catch (err) {
    console.warn("[WHOAMI] Failed:", err);
    DOM.clientInfo.querySelector(".info-text").textContent = "Location detection failed";
  }
}

async function fetchTrace(target) {
  const url = `${CONFIG.API_BASE}/trace?target=${encodeURIComponent(target)}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.message || "Traceroute failed");
  }

  return data;
}

// ============================================================================
// Main Trace Handler
// ============================================================================

function handleTrace() {
  const target = DOM.targetInput.value.trim() || CONFIG.DEFAULT_TARGET;
  runTrace(target);
}

async function runTrace(target) {
  DOM.traceBtn.disabled = true;
  showLoading();
  showStatus(`Tracing ${target}...`, "info");
  clearAll();

  try {
    console.log(`[TRACE] Starting trace to ${target}`);
    const data = await fetchTrace(target);

    const allHops = data.hops || [];
    const geoHops = allHops.filter(h => h.lat && h.lon && !h.isPrivate);

    console.log(`[TRACE] Got ${geoHops.length} geolocated hops out of ${allHops.length} total`);

    if (geoHops.length === 0) {
      showStatus(`No geolocated hops found (${allHops.length} total hops)`, "error");
      updateStats(null);
      return;
    }

    updateStats(data.stats);
    drawRoute(geoHops);
    animatePacket(geoHops);
    showStatus(`Showing ${geoHops.length} of ${allHops.length} hops for ${target}`, "success");

  } catch (err) {
    console.error("[TRACE] Error:", err);
    showStatus(err.message || "Traceroute failed", "error");
    updateStats(null);
  } finally {
    hideLoading();
    DOM.traceBtn.disabled = false;
  }
}

// ============================================================================
// Visualization Functions - REBUILT FROM ZERO
// ============================================================================

function clearAll() {
  console.log("[CLEAR] Removing all visualizations");

  // Stop animation
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  // Remove route line
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }

  // Remove hop markers
  hopMarkers.forEach(m => map.removeLayer(m));
  hopMarkers = [];

  // Remove packets
  packets.forEach(p => map.removeLayer(p));
  packets = [];
}

function drawRoute(hops) {
  console.log(`[DRAW] Drawing route with ${hops.length} hops`);

  // Extract coordinates
  const coords = hops.map(h => [h.lat, h.lon]);
  console.log("[DRAW] Coordinates:", coords);

  // 1. Draw blue line connecting all points
  routeLine = L.polyline(coords, {
    color: "#06b6d4",
    weight: 3,
    opacity: 1,
    smoothFactor: 0
  }).addTo(map);

  console.log("[DRAW] Route line drawn");

  // 2. Add blue markers at each hop
  hops.forEach((hop, i) => {
    const marker = L.circleMarker([hop.lat, hop.lon], {
      radius: 7,
      color: "#06b6d4",
      fillColor: "#06b6d4",
      fillOpacity: 0.7,
      weight: 2
    }).addTo(map);

    const loc = hop.city ? `${hop.city}, ${hop.country}` : hop.country || "Unknown";
    const rtt = hop.rtt ? `${hop.rtt.toFixed(1)}ms` : "N/A";

    marker.bindPopup(`
      <b>Hop ${hop.hop || i + 1}</b><br>
      ${hop.hostname || hop.ip}<br>
      ${loc}<br>
      RTT: ${rtt}
    `);

    hopMarkers.push(marker);
  });

  console.log(`[DRAW] Created ${hopMarkers.length} markers`);

  // 3. Fit map to show everything
  map.fitBounds(coords, { padding: [60, 60] });
}

function animatePacket(hops) {
  const coords = hops.map(h => [h.lat, h.lon]);

  if (coords.length < 2) {
    console.log("[ANIM] Not enough points");
    return;
  }

  console.log(`[ANIM] Animating through ${coords.length} points with multiple packets`);

  // Configuration for multiple small packets
  const NUM_PACKETS = 6;
  const PACKET_RADIUS = 4;
  const STAGGER_DELAY = 300; // ms between packet starts
  const HOP_DURATION = 1000; // ms per hop

  // Calculate total path length (in hops)
  const totalSegments = coords.length - 1;

  // Create multiple small packets
  for (let i = 0; i < NUM_PACKETS; i++) {
    const packet = L.circleMarker(coords[0], {
      radius: PACKET_RADIUS,
      color: "#fbbf24",
      fillColor: "#fbbf24",
      fillOpacity: 0.9,
      weight: 1.5
    }).addTo(map);

    packets.push(packet);
  }

  console.log(`[ANIM] Created ${NUM_PACKETS} packets`);

  // Animation state for each packet
  const packetStates = packets.map((_, i) => ({
    startOffset: i * STAGGER_DELAY,
    globalStartTime: null
  }));

  function animate(timestamp) {
    let anyActive = false;

    packets.forEach((packet, idx) => {
      const state = packetStates[idx];

      // Check if this packet should start yet
      if (state.globalStartTime === null) {
        if (timestamp >= state.startOffset) {
          state.globalStartTime = timestamp;
        } else {
          return; // This packet hasn't started yet
        }
      }

      // Calculate elapsed time for this packet
      const elapsed = timestamp - state.globalStartTime;
      const totalDuration = totalSegments * HOP_DURATION;

      // Calculate progress along entire route (0 to 1)
      const routeProgress = Math.min(elapsed / totalDuration, 1);

      if (routeProgress >= 1) {
        // Loop the packet back to start
        state.globalStartTime = timestamp;
        packet.setLatLng(coords[0]);
        anyActive = true;
        return;
      }

      anyActive = true;

      // Find which segment we're on
      const exactPosition = routeProgress * totalSegments;
      const currentSegment = Math.floor(exactPosition);
      const segmentProgress = exactPosition - currentSegment;

      // Make sure we don't go out of bounds
      if (currentSegment >= totalSegments) {
        packet.setLatLng(coords[coords.length - 1]);
        return;
      }

      // Interpolate position within current segment
      const start = coords[currentSegment];
      const end = coords[currentSegment + 1];
      const lat = start[0] + (end[0] - start[0]) * segmentProgress;
      const lon = start[1] + (end[1] - start[1]) * segmentProgress;

      packet.setLatLng([lat, lon]);
    });

    if (anyActive) {
      animationFrame = requestAnimationFrame(animate);
    }
  }

  animationFrame = requestAnimationFrame(animate);
  console.log("[ANIM] Animation started with continuous loop");
}

// ============================================================================
// Start
// ============================================================================

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
