# My Travel Pocket App

A weather forecast app with a pinnable world map and saved cities, styled after the
"Weather App UI" Dribbble shot (deep indigo→violet gradient + glassmorphism).

## Features
- **Auto-locates you** on load via the browser Geolocation API (falls back to London if blocked).
- **Pin any location** — click anywhere on the map or drag the marker; reverse-geocoded to a place name.
- **Animated rain radar** — live precipitation overlay via [RainViewer](https://www.rainviewer.com/) (keyless): past frames + short-range nowcast, animated as a looping overlay with play/pause, a time scrubber, a Light→Heavy legend, and an on/off toggle. RainViewer only serves real radar tiles up to a limited zoom (~7, region-dependent) and returns a "Zoom Level Not Supported" placeholder beyond it, so the radar layer is capped with `maxNativeZoom` and upscaled at deeper zooms (rain shows as soft blobs at street level — real position, coarser detail).
- **Search & save up to 10 cities** by typing (live autocomplete). Saved cities persist in `localStorage` and show live temperatures, the current local time (timezone from the weather call, DST-aware; ticks every minute), **and a sun/moon icon** indicating whether it's day or night there.
- **Current conditions** — temperature, feels-like, hi/lo, humidity, wind (with direction arrow + cardinal), UV index, pressure, and a live **precipitation rate (mm/h)** badge next to the condition so the label corroborates the radar.
- **Wind-direction compass on the map** — a top-right overlay with a rotating needle (points downwind), wind speed, and cardinal direction for the selected location.
- **24-hour hourly forecast** with day/night icons and precipitation chance. Click any day in the 7-day list to repaint the hourly strip for that date.
- **7-day forecast** with hi/lo range bars.
- **Travel section** (follows the selected location's country): **visa requirements for Singapore passport holders** (visa-free / ETA / eVisa / on-arrival with stay limits and an official-details link), a live currency converter with a **user-chosen base currency** (defaults to SGD; auto-excludes the destination currency so it's always a different pair) using live cross-rates, top 5 attractions for the selected city (falls back to the country's **capital city** if the city isn't curated; click one to pin its location on the map — geocoded via OpenStreetMap Nominatim), key risks & safety notes, and key risks. (Essential links — travel advisory, accommodation, language/translate, travel guide — are now their own section at the very end of the page.)
- **Spotify section** — logged out, it shows **Spotify Free**: an embedded player (30s previews) with a **"Log in with Spotify"** social button (client-side OAuth PKCE — no secret/backend). Once logged in, playback follows your account: **Premium plays full tracks in-browser via the Web Playback SDK**, Free shows 30-second previews. One-time setup: create a free Spotify app for a Client ID and register the shown redirect URI (kept in a collapsible panel).
- **News section** — top 5 **live** headlines each for Singapore, Global, and the selected city, from Google News RSS. Fetched primarily through a tiny **same-origin proxy in `server.js`** (`/api/news` — reliable, no CORS/consent issues), falling back to public CORS proxies if the app is hosted static-only, and finally to an "Open in Google News" link. Each headline links to the article.
- **Events section** — curated annual festivals/events for the selected city with approximate date ranges; flags "Happening now" vs "Upcoming", rolls past events to next year, and sorts by date. Unlisted cities get a "Search what's on" link.
- **Food section** — curated must-eat dishes and top-5 places to eat for the selected city; unlisted cities get a "Find top-rated food on Google Maps" search link.
- **Transportation section** — curated airport→city transfer options for the selected city: ride-hailing (Uber/Grab/Careem/etc.), rail/metro/MRT/airport express, buses, and taxi, each with rough time/fare notes, plus a "Plan a route on Google Maps" transit link. Unlisted cities get a graceful fallback with the Maps route link.
- **Cycling sections** — curated weekly group-ride schedules (in `app.js`) for **MAAP** and **Rapha (RCC clubhouses)**, matched to the selected city (falling back to other rides in the same country), each showing its next upcoming date; shows "No Maap Rides found" / "No Rapha Rides found" when nothing matches. (Live pulls aren't possible: both strava.com and events.rapha.cc return HTTP 403 to scraping, and Strava's public API doesn't expose upcoming club events.)
- **Install & offline (PWA)** — installable to a phone/desktop home screen (web app manifest + maskable icon) and works offline via a service worker (`sw.js`): the app shell and last-loaded data are cached, so a poor/absent connection still shows your saved cities, packing list, trip dates, etc. Strategy is network-first for the HTML shell and third-party APIs (fresh when online) and cache-first for version-stamped assets. An **Install app** button appears when the browser offers it, and an **offline** banner shows when the connection drops.
- **Trip Planner section** — set arrival/departure dates per city (saved on-device); shows a live countdown ("In 16 days", "Day 2 of 6 — you're there!", "Trip ended") and a compact list of your other upcoming trips.
- **Packing List** — the weather-aware suggestions are now an **interactive checklist**: tick items off (with a packed count), add your own items, and it all persists per-city in `localStorage`.
- **Phrasebook section** — curated essential phrases (hello, thank you, how much, where's the toilet, help, …) in the destination's local language with phonetic pronunciation, for ~15 languages; fully offline. English-speaking countries get a friendly note; uncurated languages get a search link.
- **Public Holidays section** — upcoming public holidays for the destination country via the keyless, CORS-friendly [Nager.Date](https://date.nager.at) API (current + next year, next 6 shown, with a "in N days" countdown), flagging days when banks/shops may close.
- Fully responsive (3-column → stacked on mobile).

## Travel section notes
- Currency uses the keyless [open.er-api.com](https://open.er-api.com) rates against SGD.
- Country facts (currency code, capital, primary language) and the curated attractions/risks are **bundled locally** in `app.js` (covers ~65 popular destinations; other countries degrade gracefully with generated links). Country names without an ISO code still resolve by name.
- **Live flight lookup was intentionally left out** — there's no reliable free/keyless API for "flight number → gate/status" (all require a paid API key).

## Tech (no API keys, no build step)
- **Open-Meteo** — weather forecast (primary) + city geocoding
- **MET Norway (api.met.no)** — automatic weather fallback if Open-Meteo is unreachable; adapted to the same data shape, with locally-computed sunrise/sunset
- **BigDataCloud** — reverse geocoding for map pins
- **Leaflet + CARTO/OpenStreetMap** — the interactive map
- Vanilla HTML/CSS/JS with inline SVG weather icons

## Run it
```bash
node server.js
# then open http://localhost:8778
```
Any static file server works — `server.js` is a zero-dependency Node static server.

## Files
- `index.html` — markup
- `styles.css` — theme & layout
- `app.js` — weather/map/search/persistence logic
- `server.js` — local static server
