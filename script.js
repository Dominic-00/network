const API_BASE = window.API_BASE_URL || "http://localhost:3001";
const TRACEROUTE_ENDPOINT = target =>
  `${API_BASE}/trace?target=${encodeURIComponent(target)}`;
const PUBLIC_IP_ENDPOINT = `${API_BASE}/whoami`;

const map = L.map("map").setView([20, 0], 2);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19
}).addTo(map);

let lineLayer = null;
let markersLayer = null;
let packetMarker = null;
let animTimer = null;
let hopMarkers = [];
let userMarker = null;
let userLatLng = null;

const input = document.getElementById("targetInput");
const button = document.getElementById("showBtn");
const hint = document.getElementById("hint");
const clientInfo = document.getElementById("clientInfo");

button.addEventListener("click", () => {
  runTrace(input.value.trim() || "google.com");
});
input.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    button.click();
  }
});

fetchAndPinClient();
runTrace("google.com");

function setButtonState(isBusy) {
  button.disabled = isBusy;
  button.textContent = isBusy ? "Tracing…" : "Show route";
}

function setHint(message) {
  hint.textContent = message;
}

async function runTrace(target) {
  setButtonState(true);
  setHint(`Running traceroute via local API to "${target}"…`);
  clearRoute();

  try {
    const hops = await fetchTraceroute(target);
    const geoHops = hops.filter(h => typeof h.lat === "number" && typeof h.lon === "number");

    if (!geoHops.length) {
      setHint("Traceroute ran, but no hops came back with public IP locations (likely all private hops).");
      return;
    }

    setHint(`Traceroute from your Docker API (server-side mtr + geolocation). Target "${target}".`);
    drawRoute(geoHops);
    animatePacket(geoHops);
  } catch (err) {
    console.error(err);
    setHint(err.message || "Could not complete traceroute. Is the backend running on port 3001?");
  } finally {
    setButtonState(false);
  }
}

async function fetchTraceroute(target) {
  const res = await fetch(TRACEROUTE_ENDPOINT(target));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Traceroute failed with status ${res.status}`);
  }

  const data = await res.json();
  if (!data.hops || !Array.isArray(data.hops)) {
    throw new Error("Response missing hop list.");
  }

  return data.hops.map((hop, idx) => ({
    ...hop,
    label: hop.hostname || hop.ip || `hop-${idx + 1}`
  }));
}

async function fetchAndPinClient() {
  try {
    const res = await fetch(PUBLIC_IP_ENDPOINT);
    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();
    if (!data.ip) throw new Error("No IP returned from backend.");

    const geo = data.geo;
    if (!geo) {
      if (clientInfo) clientInfo.textContent = `Your public IP is ${data.ip}, but location lookup failed server-side.`;
      return;
    }

    userLatLng = [geo.lat, geo.lon];
    if (clientInfo) {
      const city = geo.city ? `${geo.city}, ` : "";
      clientInfo.textContent = `Your public IP looks like ${data.ip} near ${city}${geo.country}.`;
    }

    userMarker = L.circleMarker(userLatLng, {
      radius: 6,
      color: "#f97316",
      fillColor: "#f97316",
      fillOpacity: 0.9,
      className: "user-marker"
    }).addTo(map);

    userMarker.bindPopup(`You (${data.ip})${geo.city ? `<br>${geo.city}, ${geo.country}` : ""}`);
  } catch (err) {
    console.warn("Could not detect public IP:", err);
    if (clientInfo) clientInfo.textContent = "Could not detect your public IP (backend offline or blocked).";
  }
}

function clearRoute() {
  if (lineLayer) map.removeLayer(lineLayer);
  if (markersLayer) map.removeLayer(markersLayer);
  if (packetMarker) map.removeLayer(packetMarker);
  if (animTimer) clearInterval(animTimer);

  lineLayer = null;
  markersLayer = null;
  packetMarker = null;
  animTimer = null;
  hopMarkers = [];
}

function drawRoute(hops) {
  const latlngs = hops.map(h => [h.lat, h.lon]);
  lineLayer = L.polyline(latlngs, {
    color: "#4fd1c5",
    weight: 3,
    className: "route-line"
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  hopMarkers = [];

  hops.forEach((hop, i) => {
    const marker = L.circleMarker([hop.lat, hop.lon], {
      radius: 5,
      color: "#4fd1c5",
      fillColor: "#4fd1c5",
      fillOpacity: 0.9,
      className: "hop-marker"
    }).addTo(markersLayer);

    const locationText = hop.city ? `${hop.city}, ${hop.country}` : hop.country || "";
    const rttText = hop.rtt ? `${hop.rtt} ms` : "n/a";
    marker.bindPopup(`<strong>Hop ${i + 1}</strong><br>${hop.label}<br>${hop.ip || ""}<br>${locationText}<br>${rttText}`);
    hopMarkers.push(marker);
  });

  const boundsPoints = [...latlngs];
  if (userLatLng) boundsPoints.push(userLatLng);
  map.fitBounds(boundsPoints, { padding: [20, 20] });
}

function setActiveHop(index) {
  hopMarkers.forEach(m => m._path && m._path.classList.remove("hop-marker-active"));
  if (hopMarkers[index] && hopMarkers[index]._path) {
    hopMarkers[index]._path.classList.add("hop-marker-active");
    hopMarkers[index].openPopup();
  }
}

function animatePacket(hops) {
  const latlngs = hops.map(h => [h.lat, h.lon]);
  if (latlngs.length === 0) return;

  packetMarker = L.circleMarker(latlngs[0], {
    radius: 7,
    color: "#f6e05e",
    fillColor: "#f6e05e",
    fillOpacity: 1,
    className: "packet-marker"
  }).addTo(map);

  let segmentIndex = 0;
  let t = 0;
  const speed = 0.02;
  const stepMs = 40;

  setActiveHop(0);

  animTimer = setInterval(() => {
    const from = latlngs[segmentIndex];
    const to = latlngs[segmentIndex + 1];

    if (!to) {
      clearInterval(animTimer);
      animTimer = null;
      setActiveHop(hops.length - 1);
      return;
    }

    const lat = from[0] + (to[0] - from[0]) * t;
    const lon = from[1] + (to[1] - from[1]) * t;
    packetMarker.setLatLng([lat, lon]);

    t += speed;
    if (t >= 1) {
      t = 0;
      segmentIndex++;
      setActiveHop(segmentIndex);
    }
  }, stepMs);
}
