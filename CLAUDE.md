# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Young Tbilisi Navigator is a static web application for finding youth activities, clubs, and communities in Tbilisi for teenagers (13-18 years old). It features interactive filtering, geolocation, mapping via Yandex Maps, and favorites management.

## Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3 (no frameworks)
- **Maps**: Yandex Maps API integration with clustering
- **Data**: JSON-based data structure in `data/items.json`
- **Hosting**: Static file server (Python/Node.js)
- **Storage**: LocalStorage for user preferences and favorites

## Development Commands

Use the Makefile for all development tasks:

```bash
# Development server with auto-open browser
make dev

# Simple server in current terminal
make serve

# Open browser to app
make open

# Check server status
make status

# Stop background server
make stop

# Clean up PID/log files
make clean
```

**Note**: The app requires a static server - opening `index.html` directly via `file://` protocol will not work due to CORS restrictions.

Environment variables:
- `PORT`: Server port (default: 8088)
- `HOST`: Server host (default: localhost)

## Architecture

### Core Files
- `index.html`: Main page structure and metadata
- `app.js`: All JavaScript logic (single file application)
- `style.css`: Complete styling with CSS custom properties for theming
- `data/items.json`: Activity/location data in structured JSON format

### Key JavaScript Architecture

**Global State Management**:
- `ITEMS`: Main data array loaded from JSON
- `map`, `clusterer`: Yandex Maps objects
- `userPos`: User's geolocation coordinates
- Theme and rebel mode stored in localStorage

**Core Functions**:
- `loadItems()`: Fetches and filters data (age >= 13)
- `render()`: Main UI rendering with debounced search
- `setupMap()`: Initializes Yandex Maps with clustering
- `applyFilters()`: Filters data by type, distance, tags, languages
- `refreshPins()`: Updates map markers based on current filters

**Performance Optimizations**:
- Distance caching with `distanceCache` Map
- Debounced user inputs (150ms)
- Throttled map pin updates (120ms)
- Progressive card animation delays

### Data Structure

Each item in `data/items.json` follows this schema:
```json
{
  "id": "unique_identifier",
  "title": "Display name",
  "type": "online|offline",
  "categories": ["tag1", "tag2"],
  "age": {"min": 13, "max": 18},
  "address": "Physical address or 'Онлайн-формат'",
  "coords": {"lat": 41.715, "lng": 44.79} or null,
  "languages": ["ru", "en", "ge"],
  "links": {"site": "url", "instagram": "url"},
  "blurb": "Short description"
}
```

### Theming System

Three-layer theming via CSS custom properties:
1. **Base theme**: Dark (default) vs Light
2. **Rebel mode**: Alternative styling with gradients/grain effects
3. **Color tokens**: Consistent across `--bg`, `--card`, `--text`, `--accent` etc.

## Common Tasks

### Adding New Activities
1. Edit `data/items.json` with proper schema
2. Use coordinates from Yandex Maps for `coords` field
3. Restart server to see changes

### Map Integration
- Yandex Maps API key is in `index.html` script tag
- Robust loading with retry/polling in `initMapWhenReady()`
- Clustering automatically handles marker density

### Geolocation Features
- Multi-fallback: HTML5 Geolocation → Yandex Geolocation → IP-based
- Distance calculation uses Haversine formula
- HTTPS required for accurate geolocation (localhost exempt)

## No Build Process

This is a purely static application with no build steps, transpilation, or bundling. All code runs directly in the browser. No package.json, no dependencies beyond CDN resources.