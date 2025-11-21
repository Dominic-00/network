# Network Path Visualizer

A modern web application for visualizing network routes with real-time traceroute and geolocation mapping. Built from the ground up with clean architecture and smooth animations.

![Network Visualization](https://img.shields.io/badge/status-active-success)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- 🌍 **Real-time Traceroute** - Live network path tracing using MTR
- 📍 **Geolocation Mapping** - Visualize hops on an interactive map
- ✨ **Smooth Animations** - Multiple packet flow with trails and ripples
- 📊 **Statistics Dashboard** - Real-time route metrics
- 🎨 **Modern UI** - Clean, responsive design with dark theme
- 🚀 **Fast & Efficient** - Built with modern JavaScript and optimized API

## Architecture

```
network/
├── backend/
│   ├── server.js       # Express API server
│   ├── package.json    # Node dependencies
│   └── Dockerfile      # Container configuration
├── index.html          # Frontend structure
├── style.css           # Modern CSS with animations
├── script.js           # Client-side application
└── docker-compose.yml  # Docker orchestration
```

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Build and start the services
docker-compose up --build

# Access the app
open http://localhost:3001
```

### Option 2: Local Development

**Backend:**
```bash
cd backend
npm install
npm start
```

**Frontend:**
```bash
# Serve the frontend files (use any static server)
python3 -m http.server 8000
# or
npx serve .
```

Then open http://localhost:8000

## API Endpoints

### `GET /healthz`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "uptime": 123.45,
  "timestamp": "2025-11-21T12:00:00.000Z",
  "cache": { "size": 10 }
}
```

### `GET /diag`
Diagnostic test to verify MTR functionality.

**Response:**
```json
{
  "status": "ok",
  "mtrPath": "mtr",
  "testTarget": "8.8.8.8",
  "totalHops": 12,
  "publicHops": 8,
  "hops": [...]
}
```

### `GET /trace?target=<domain>`
Main traceroute endpoint with geolocation.

**Parameters:**
- `target` (required): Domain or IP address to trace

**Response:**
```json
{
  "success": true,
  "target": "google.com",
  "stats": {
    "totalHops": 15,
    "publicHops": 10,
    "geolocatedHops": 8,
    "durationMs": 3245
  },
  "hops": [
    {
      "hop": 1,
      "ip": "192.168.1.1",
      "hostname": "router.local",
      "rtt": 1.2,
      "isPrivate": true
    },
    {
      "hop": 2,
      "ip": "8.8.8.8",
      "hostname": "dns.google",
      "rtt": 15.3,
      "isPrivate": false,
      "lat": 37.4056,
      "lon": -122.0775,
      "city": "Mountain View",
      "country": "United States"
    }
  ],
  "metadata": {
    "source": "mtr",
    "geoProvider": "ipwho.is + ipapi.co",
    "timestamp": "2025-11-21T12:00:00.000Z"
  }
}
```

### `GET /whoami`
Detect your public IP and location.

**Response:**
```json
{
  "success": true,
  "ip": "203.0.113.42",
  "geo": {
    "lat": 40.7128,
    "lon": -74.0060,
    "city": "New York",
    "country": "United States"
  }
}
```

## Configuration

### Backend Environment Variables

Create a `.env` file in the `backend/` directory:

```env
PORT=3001
MTR_BIN=mtr
MTR_COUNT=3
REQUEST_TIMEOUT_MS=20000
IP_LOOKUP_URL=https://api.ipify.org?format=json
GEO_PRIMARY_URL=https://ipwho.is
```

### Frontend Configuration

Edit `script.js` to change the API endpoint:

```javascript
const CONFIG = {
  API_BASE: window.API_BASE_URL || "http://your-api:3001",
  // ... other config
};
```

Or set it in your HTML:

```html
<script>
  window.API_BASE_URL = "http://your-api:3001";
</script>
<script src="script.js"></script>
```

## Animation System

The application features a sophisticated animation system with:

- **Multiple Packet Flow**: 3 colored packets (yellow, cyan, orange) flowing sequentially
- **Trail Effects**: Main packet leaves fading trail dots
- **Ripple Effects**: Expanding ripples when packets reach hops
- **Hop Highlighting**: Active hops pulse and scale up
- **Easing Functions**: Smooth acceleration/deceleration
- **60fps Target**: Optimized frame timing

Customize in `script.js`:

```javascript
ANIMATION: {
  PACKET_COUNT: 3,         // Number of packets
  PACKET_SPEED: 0.018,     // Speed (higher = faster)
  FRAME_RATE: 30,          // Target FPS
  TRAIL_INTERVAL: 5,       // Frames between trail dots
  TRAIL_DURATION: 800,     // Trail fade duration (ms)
  RIPPLE_DURATION: 1000,   // Ripple duration (ms)
  HOP_STAGGER_DELAY: 60    // Delay between hop markers (ms)
}
```

## Docker Deployment

The included `docker-compose.yml` configures:

- **Network Capabilities**: `NET_ADMIN` and `NET_RAW` for traceroute
- **Port Mapping**: 3001:3001
- **Auto-restart**: Unless manually stopped
- **Health Checks**: Automatic health monitoring

For host network mode (better traceroute results):

```yaml
services:
  backend:
    # ... other config
    network_mode: host
```

## Troubleshooting

### No Public Hops Found

This usually means the container only sees private Docker network hops. Solutions:

1. **Use host network mode** in docker-compose.yml
2. **Grant NET_ADMIN capability** (already configured)
3. **Check MTR installation**: `docker exec <container> which mtr`

### Geolocation Failures

- **Rate Limiting**: Free geolocation APIs have rate limits
- **Cache**: The server caches results for 1 hour
- **Fallback**: Server uses multiple providers (ipwho.is → ipapi.co)

### Animation Issues

- **Check console**: Browser console shows animation logs
- **Reduce packet count**: Lower `PACKET_COUNT` in config
- **Adjust speed**: Modify `PACKET_SPEED` value

## Development

### Project Structure

- **Backend** (`backend/server.js`):
  - Express API server
  - MTR traceroute execution
  - Geolocation with caching
  - Error handling and logging

- **Frontend** (`script.js`):
  - Modern ES6+ architecture
  - Clean state management
  - Modular functions
  - Animation system

### Code Style

- **ES6+ JavaScript**: Arrow functions, async/await, template literals
- **Modular Design**: Separated concerns (UI, API, Animation)
- **Clean Code**: Descriptive names, comments, consistent formatting
- **Modern CSS**: CSS variables, flexbox, grid, animations

## License

MIT License - See LICENSE file for details

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Acknowledgments

- **Leaflet** - Interactive mapping library
- **MTR** - Network diagnostic tool
- **ipwho.is & ipapi.co** - Geolocation services
- **CartoDB** - Dark map tiles

---

Built with ❤️ using modern web technologies
