/**
 * Network Path Visualizer - Main Application
 * Modern ES6+ architecture with clean separation of concerns
 */

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  API_BASE: window.API_BASE_URL || "http://192.168.2.230:3001",
  DEFAULT_TARGET: "google.com",
  ANIMATION: {
    PACKET_COUNT: 3,
    PACKET_SPEED: 0.018,
    FRAME_RATE: 30,
    TRAIL_INTERVAL: 5,
    TRAIL_DURATION: 800,
    RIPPLE_DURATION: 1000,
    HOP_STAGGER_DELAY: 60
  },
  COLORS: {
    ROUTE_LINE: "#06b6d4",
    HOP_MARKER: "#06b6d4",
    USER_MARKER: "#f97316",
    PACKETS: ["#fbbf24", "#06b6d4", "#f97316"]
  }
};

// ============================================================================
// State Management
// ============================================================================

const AppState = {
  map: null,
  layers: {
    routeLine: null,
    markers: null,
    packets: [],
    trails: [],
    ripples: []
  },
  hopMarkers: [],
  userMarker: null,
  userLocation: null,
  animationTimer: null,
  isAnimating: false
};

// ============================================================================
// DOM Elements
// ============================================================================

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

// ============================================================================
// Initialize Application
// ============================================================================

function init() {
  // Initialize Leaflet map
  AppState.map = L.map("map", {
    center: [20, 0],
    zoom: 2,
    zoomControl: true,
    attributionControl: true
  });

  // Add dark theme tile layer
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(AppState.map);

  // Set up event listeners
  DOM.traceBtn.addEventListener("click", () => handleTrace());
  DOM.targetInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTrace();
    }
  });

  // Update API info
  updateAPIInfo();

  // Detect user location
  detectUserLocation();

  // Run initial trace
  runTraceroute(CONFIG.DEFAULT_TARGET);
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

function setButtonState(isDisabled, text) {
  DOM.traceBtn.disabled = isDisabled;
  const btnText = DOM.traceBtn.querySelector(".btn-text");
  if (btnText) {
    btnText.textContent = text || "Trace Route";
  }
}

function showStatus(message, type = "info") {
  DOM.statusMessage.textContent = message;
  DOM.statusMessage.className = `status-message ${type}`;
}

function clearStatus() {
  DOM.statusMessage.textContent = "";
  DOM.statusMessage.className = "status-message";
}

function updateAPIInfo() {
  const apiText = DOM.apiInfo.querySelector(".info-text");
  if (apiText) {
    apiText.textContent = `API: ${CONFIG.API_BASE}`;
  }
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
    const response = await fetch(`${CONFIG.API_BASE}/whoami`);
    if (!response.ok) throw new Error("Failed to detect location");

    const data = await response.json();
    if (!data.success || !data.ip) throw new Error("No IP returned");

    const geo = data.geo;
    const clientText = DOM.clientInfo.querySelector(".info-text");

    if (geo && geo.lat && geo.lon) {
      AppState.userLocation = [geo.lat, geo.lon];

      // Add user marker to map
      AppState.userMarker = L.circleMarker(AppState.userLocation, {
        radius: 7,
        color: CONFIG.COLORS.USER_MARKER,
        fillColor: CONFIG.COLORS.USER_MARKER,
        fillOpacity: 0.9,
        weight: 2,
        className: "user-marker"
      }).addTo(AppState.map);

      const locationStr = geo.city ? `${geo.city}, ${geo.country}` : geo.country;
      AppState.userMarker.bindPopup(`
        <strong>Your Location</strong><br>
        IP: ${data.ip}<br>
        ${locationStr}
      `);

      if (clientText) {
        clientText.textContent = `Your IP: ${data.ip} (${locationStr})`;
      }
    } else {
      if (clientText) {
        clientText.textContent = `Your IP: ${data.ip} (location unknown)`;
      }
    }
  } catch (err) {
    console.warn("Could not detect user location:", err);
    const clientText = DOM.clientInfo.querySelector(".info-text");
    if (clientText) {
      clientText.textContent = "Location detection failed";
    }
  }
}

async function fetchTraceroute(target) {
  const url = `${CONFIG.API_BASE}/trace?target=${encodeURIComponent(target)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || "Traceroute failed");
  }

  return data;
}

// ============================================================================
// Main Traceroute Handler
// ============================================================================

function handleTrace() {
  const target = DOM.targetInput.value.trim() || CONFIG.DEFAULT_TARGET;
  runTraceroute(target);
}

async function runTraceroute(target) {
  // Update UI
  setButtonState(true, "Tracing...");
  showLoading();
  showStatus(`Tracing route to ${target}...`, "info");
  clearRoute();

  try {
    console.log(`[TRACE] Starting traceroute to ${target}`);
    const data = await fetchTraceroute(target);

    console.log(`[TRACE] Received data:`, data);

    // Filter hops with geolocation
    const allHops = data.hops || [];
    const geoHops = allHops.filter(h => h.lat && h.lon && !h.isPrivate);

    console.log(`[TRACE] Found ${geoHops.length} geolocated hops out of ${allHops.length} total`);

    if (geoHops.length === 0) {
      const publicCount = allHops.filter(h => !h.isPrivate).length;
      showStatus(
        `No geolocated hops found. Total: ${allHops.length}, Public: ${publicCount}. Most hops may be private/internal.`,
        "error"
      );
      updateStats(null);
      return;
    }

    // Update stats
    updateStats(data.stats);

    // Draw route and animate
    drawRoute(geoHops);
    startPacketAnimation(geoHops);

    showStatus(
      `Showing ${geoHops.length} of ${allHops.length} hops for ${target}`,
      "success"
    );

  } catch (err) {
    console.error("[TRACE] Error:", err);
    showStatus(err.message || "Traceroute failed. Check console for details.", "error");
    updateStats(null);
  } finally {
    hideLoading();
    setButtonState(false, "Trace Route");
  }
}

// ============================================================================
// Map Drawing Functions
// ============================================================================

function clearRoute() {
  // Stop animations
  if (AppState.animationTimer) {
    clearInterval(AppState.animationTimer);
    AppState.animationTimer = null;
  }
  AppState.isAnimating = false;

  // Remove layers
  if (AppState.layers.routeLine) AppState.map.removeLayer(AppState.layers.routeLine);
  if (AppState.layers.markers) AppState.map.removeLayer(AppState.layers.markers);

  // Remove packets
  AppState.layers.packets.forEach(p => p && AppState.map.removeLayer(p));
  AppState.layers.packets = [];

  // Remove trails
  AppState.layers.trails.forEach(t => t && AppState.map.removeLayer(t));
  AppState.layers.trails = [];

  // Remove ripples
  AppState.layers.ripples.forEach(r => r && AppState.map.removeLayer(r));
  AppState.layers.ripples = [];

  // Clear markers
  AppState.hopMarkers = [];
  AppState.layers.routeLine = null;
  AppState.layers.markers = null;
}

function drawRoute(hops) {
  const latLngs = hops.map(h => [h.lat, h.lon]);

  // Draw route line
  AppState.layers.routeLine = L.polyline(latLngs, {
    color: CONFIG.COLORS.ROUTE_LINE,
    weight: 3,
    opacity: 0.8,
    className: "route-line"
  }).addTo(AppState.map);

  // Create marker layer
  AppState.layers.markers = L.layerGroup().addTo(AppState.map);

  // Add hop markers with staggered animation
  hops.forEach((hop, index) => {
    setTimeout(() => {
      const marker = L.circleMarker([hop.lat, hop.lon], {
        radius: 5,
        color: CONFIG.COLORS.HOP_MARKER,
        fillColor: CONFIG.COLORS.HOP_MARKER,
        fillOpacity: 0.9,
        weight: 2,
        className: "hop-marker"
      }).addTo(AppState.layers.markers);

      // Create popup
      const location = hop.city ? `${hop.city}, ${hop.country}` : (hop.country || "Unknown");
      const rtt = hop.rtt ? `${hop.rtt.toFixed(1)}ms` : "N/A";

      marker.bindPopup(`
        <strong>Hop ${hop.hop || index + 1}</strong><br>
        <em>${hop.hostname || hop.ip}</em><br>
        ${hop.ip || ""}<br>
        📍 ${location}<br>
        ⏱️ RTT: ${rtt}
      `);

      AppState.hopMarkers.push(marker);
    }, index * CONFIG.ANIMATION.HOP_STAGGER_DELAY);
  });

  // Fit map bounds
  const allPoints = [...latLngs];
  if (AppState.userLocation) {
    allPoints.push(AppState.userLocation);
  }
  AppState.map.fitBounds(allPoints, { padding: [60, 60] });
}

// ============================================================================
// Animation System
// ============================================================================

function setActiveHop(index) {
  AppState.hopMarkers.forEach(m => {
    if (m._path) {
      m._path.classList.remove("hop-marker-active");
    }
  });

  if (AppState.hopMarkers[index] && AppState.hopMarkers[index]._path) {
    AppState.hopMarkers[index]._path.classList.add("hop-marker-active");
    AppState.hopMarkers[index].openPopup();
  }
}

function createRipple(latLng, color) {
  const ripple = L.circleMarker(latLng, {
    radius: 10,
    color: color,
    fillColor: color,
    fillOpacity: 0.6,
    weight: 2,
    className: "ripple-effect"
  }).addTo(AppState.map);

  AppState.layers.ripples.push(ripple);

  // Remove after animation
  setTimeout(() => {
    if (ripple) {
      AppState.map.removeLayer(ripple);
      AppState.layers.ripples = AppState.layers.ripples.filter(r => r !== ripple);
    }
  }, CONFIG.ANIMATION.RIPPLE_DURATION);

  return ripple;
}

function createTrail(latLng, color) {
  const trail = L.circleMarker(latLng, {
    radius: 3,
    color: color,
    fillColor: color,
    fillOpacity: 0.5,
    weight: 0,
    className: "packet-trail"
  }).addTo(AppState.map);

  AppState.layers.trails.push(trail);

  // Remove after fade
  setTimeout(() => {
    if (trail) {
      AppState.map.removeLayer(trail);
      AppState.layers.trails = AppState.layers.trails.filter(t => t !== trail);
    }
  }, CONFIG.ANIMATION.TRAIL_DURATION);
}

function startPacketAnimation(hops) {
  const latLngs = hops.map(h => [h.lat, h.lon]);
  if (latLngs.length === 0) return;

  AppState.isAnimating = true;

  // Packet configuration
  const packets = [];
  for (let i = 0; i < CONFIG.ANIMATION.PACKET_COUNT; i++) {
    packets.push({
      index: 0,
      progress: 0,
      color: CONFIG.COLORS.PACKETS[i % CONFIG.COLORS.PACKETS.length],
      delay: i * 15,
      frameCount: 0,
      marker: null
    });
  }

  let globalFrame = 0;
  const frameInterval = 1000 / CONFIG.ANIMATION.FRAME_RATE;

  setActiveHop(0);

  // Animation loop
  AppState.animationTimer = setInterval(() => {
    globalFrame++;
    let allComplete = true;

    packets.forEach((packet, packetIdx) => {
      // Wait for delay
      if (globalFrame < packet.delay) {
        allComplete = false;
        return;
      }

      // Create marker on first frame
      if (!packet.marker) {
        packet.marker = L.circleMarker(latLngs[0], {
          radius: 7 - packetIdx,
          color: packet.color,
          fillColor: packet.color,
          fillOpacity: 0.9,
          weight: 2,
          className: `packet-marker packet-marker-${packetIdx}`
        }).addTo(AppState.map);

        AppState.layers.packets.push(packet.marker);

        // Create initial ripple
        if (packetIdx === 0) {
          createRipple(latLngs[0], packet.color);
        }
      }

      // Check if packet completed its journey
      if (packet.index >= latLngs.length - 1) {
        return; // This packet is done
      }

      allComplete = false;

      // Get current segment
      const from = latLngs[packet.index];
      const to = latLngs[packet.index + 1];

      // Calculate position with easing
      const t = packet.progress;
      const easedT = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;

      const lat = from[0] + (to[0] - from[0]) * easedT;
      const lon = from[1] + (to[1] - from[1]) * easedT;

      packet.marker.setLatLng([lat, lon]);

      // Create trail for main packet
      if (packetIdx === 0 && packet.frameCount % CONFIG.ANIMATION.TRAIL_INTERVAL === 0) {
        createTrail([lat, lon], packet.color);
      }

      packet.frameCount++;

      // Update progress
      packet.progress += CONFIG.ANIMATION.PACKET_SPEED;

      // Move to next segment
      if (packet.progress >= 1) {
        packet.progress = 0;
        packet.index++;

        // Main packet controls hop highlighting and ripples
        if (packetIdx === 0 && packet.index < latLngs.length) {
          setActiveHop(packet.index);
          createRipple(latLngs[packet.index], packet.color);
        }
      }
    });

    // Stop animation when all packets are done
    if (allComplete) {
      clearInterval(AppState.animationTimer);
      AppState.animationTimer = null;
      AppState.isAnimating = false;

      setActiveHop(hops.length - 1);

      // Clean up packets after a delay
      setTimeout(() => {
        AppState.layers.packets.forEach(p => p && AppState.map.removeLayer(p));
        AppState.layers.packets = [];
      }, 1500);

      console.log("[ANIMATION] Complete");
    }
  }, frameInterval);
}

// ============================================================================
// Start Application
// ============================================================================

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
