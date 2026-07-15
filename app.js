/* ============================================================
   Skycast — weather forecast with pinnable map + saved cities
   APIs (all keyless): Open-Meteo (weather + geocoding),
   BigDataCloud (reverse geocoding), OpenStreetMap tiles.
   ============================================================ */

const MAX_CITIES = 10;
const STORE_KEY = 'skycast.cities.v1';
const DEFAULT_LOCATION = { lat: 51.5074, lon: -0.1278, name: 'London', country: 'United Kingdom', cc: 'GB' };

const state = {
  current: null,      // { lat, lon, name, country }
  pinned: null,       // { lat, lon } currently dropped pin (candidate to save)
  cities: [],         // saved [{ lat, lon, name, country }]
  weather: null,      // last fetched forecast payload (for re-rendering hourly)
  selectedDay: 0,     // index into daily forecast currently shown in the hourly strip
  map: null,
  marker: null,
  activeSuggestion: -1,
  suggestionData: [],
};

/* ---------- WMO weather code → description + icon ---------- */
const WMO = {
  0: ['Clear sky', 'clear'],
  1: ['Mainly clear', 'clear'],
  2: ['Partly cloudy', 'partly'],
  3: ['Overcast', 'cloudy'],
  45: ['Fog', 'fog'], 48: ['Rime fog', 'fog'],
  51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Dense drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'], 57: ['Freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Violent showers', 'rain'],
  85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'],
  95: ['Thunderstorm', 'thunder'], 96: ['Thunderstorm', 'thunder'], 99: ['Severe thunderstorm', 'thunder'],
};
const describe = (code) => (WMO[code] || ['Unknown', 'cloudy'])[0];
const iconKey = (code) => (WMO[code] || ['Unknown', 'cloudy'])[1];

/* ---------- SVG weather icons ---------- */
function icon(key, isNight = false) {
  const sun = `<circle cx="24" cy="22" r="10" fill="url(#g-sun)"/>`;
  const moon = `<path d="M32 22a10 10 0 1 1-11-10 8 8 0 0 0 11 10z" fill="url(#g-moon)"/>`;
  const cloud = (x = 0, y = 0, c = 'url(#g-cloud)') =>
    `<path transform="translate(${x},${y})" d="M18 40a9 9 0 0 1 .4-18 13 13 0 0 1 25 3 8 8 0 0 1-2 15z" fill="${c}"/>`;
  const defs = `<defs>
      <linearGradient id="g-sun" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#ff9d5c"/></linearGradient>
      <linearGradient id="g-moon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6d6"/><stop offset="1" stop-color="#cbd3ff"/></linearGradient>
      <linearGradient id="g-cloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c7ccff"/></linearGradient>
    </defs>`;
  let body = '';
  switch (key) {
    case 'clear': body = isNight ? moon : sun; break;
    case 'partly': body = (isNight ? moon : `<circle cx="18" cy="16" r="8" fill="url(#g-sun)"/>`) + cloud(4, 6); break;
    case 'cloudy': body = cloud(0, 0) + cloud(-6, -4, 'rgba(255,255,255,0.55)'); break;
    case 'fog': body = cloud(0, -4) + `<g stroke="#d8dbff" stroke-width="2.4" stroke-linecap="round"><path d="M12 44h24"/><path d="M16 50h20"/></g>`; break;
    case 'drizzle': body = cloud(0, -6) + `<g stroke="#8fd3ff" stroke-width="2.6" stroke-linecap="round"><path d="M18 42v4"/><path d="M28 42v4"/></g>`; break;
    case 'rain': body = cloud(0, -8) + `<g stroke="#7cc0ff" stroke-width="2.8" stroke-linecap="round"><path d="M16 40l-2 6"/><path d="M24 40l-2 6"/><path d="M32 40l-2 6"/></g>`; break;
    case 'snow': body = cloud(0, -8) + `<g fill="#e8f2ff"><circle cx="16" cy="44" r="2"/><circle cx="24" cy="47" r="2"/><circle cx="32" cy="44" r="2"/></g>`; break;
    case 'thunder': body = cloud(0, -8) + `<path d="M24 38l-6 8h5l-3 8 9-11h-5z" fill="url(#g-sun)"/>`; break;
    default: body = cloud(0, 0);
  }
  return `<svg viewBox="0 0 56 56" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${defs}${body}</svg>`;
}

/* ---------- DOM refs ---------- */
const $ = (id) => document.getElementById(id);
const el = {
  heroLoading: $('heroLoading'), heroContent: $('heroContent'),
  placeName: $('placeName'), placeMeta: $('placeMeta'),
  heroIcon: $('heroIcon'), tempValue: $('tempValue'), heroCond: $('heroCond'),
  heroClock: $('heroClock'), heroTime: $('heroTime'), heroAmpm: $('heroAmpm'), heroSep: $('heroSep'),
  tempHi: $('tempHi'), tempLo: $('tempLo'), feelsLike: $('feelsLike'), stats: $('stats'),
  hourly: $('hourly'), hourlySub: $('hourlySub'), daily: $('daily'),
  searchForm: $('searchForm'), searchInput: $('searchInput'), suggestions: $('suggestions'),
  savedList: $('savedList'), savedCount: $('savedCount'),
  locateBtn: $('locateBtn'), savePinBtn: $('savePinBtn'),
  pinBadgeText: $('pinBadgeText'), toast: $('toast'),
  travelCountry: $('travelCountry'), travelSub: $('travelSub'), travelBody: $('travelBody'),
  radarToggle: $('radarToggle'), cyclingBody: $('cyclingBody'), raphaBody: $('raphaBody'),
  transportBody: $('transportBody'), foodBody: $('foodBody'), eventsBody: $('eventsBody'),
  linksBody: $('linksBody'), newsBody: $('newsBody'), spotifyAccount: $('spotifyAccount'),
  hotelCity: $('hotelCity'), hotelName: $('hotelName'), hotelRoom: $('hotelRoom'), hotelAdd: $('hotelAdd'), hotelList: $('hotelList'),
  workdayBody: $('workdayBody'), packingBody: $('packingBody'), essentialsBody: $('essentialsBody'), heroAqi: $('heroAqi'),
  expMerchant: $('expMerchant'), expAmount: $('expAmount'), expCur: $('expCur'), expAdd: $('expAdd'),
  expReceipt: $('expReceipt'), expStatus: $('expStatus'), expTotal: $('expTotal'), expList: $('expList'), expExport: $('expExport'),
};

/* ---------- Helpers ---------- */
const round = (n) => Math.round(n);
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.toast.classList.remove('show');
    setTimeout(() => { el.toast.hidden = true; }, 250);
  }, 2600);
}
function isNightAt(iso, sunrise, sunset) {
  if (!sunrise || !sunset) return false;
  const t = new Date(iso).getTime(), sr = new Date(sunrise).getTime(), ss = new Date(sunset).getTime();
  // Normal (sunrise before sunset): night is outside the daylight window.
  // Wrapped (e.g. UTC sun times for far-east cities where sunset < sunrise on the
  // timeline): night is the span between sunset and the next sunrise.
  return sr <= ss ? (t < sr || t > ss) : (t > ss && t < sr);
}
function fmtHour(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${ampm}`;
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------- Persistence ---------- */
function loadCities() {
  try { state.cities = JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
  catch { state.cities = []; }
}
function saveCities() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.cities));
  renderSaved();
}
function cityKey(c) { return `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`; }
function addCity(c) {
  if (state.cities.some((x) => cityKey(x) === cityKey(c))) { toast(`${c.name} is already saved`); return false; }
  if (state.cities.length >= MAX_CITIES) { toast(`Limit reached — 10 cities max`); return false; }
  state.cities.push({ lat: c.lat, lon: c.lon, name: c.name, country: c.country, cc: c.cc || '' });
  saveCities();
  toast(`Saved ${c.name}`);
  return true;
}
function removeCity(key) {
  state.cities = state.cities.filter((c) => cityKey(c) !== key);
  saveCities();
}

/* ---------- API ---------- */
async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
  const r = await fetch(url);
  const j = await r.json();
  return (j.results || []).map((x) => ({
    lat: x.latitude, lon: x.longitude, name: x.name,
    country: x.country || '', admin: x.admin1 || '', cc: x.country_code || '',
  }));
}
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const r = await fetch(url);
    const j = await r.json();
    const name = j.city || j.locality || j.principalSubdivision || 'Dropped pin';
    return { name, country: j.countryName || '', cc: j.countryCode || '' };
  } catch {
    return { name: 'Dropped pin', country: '', cc: '' };
  }
}
async function fetchOpenMeteo(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,precipitation',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max',
    timezone: 'auto', forecast_days: '7',
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4500); // short: fall back fast if blocked/slow
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`open-meteo ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/* Primary: MET Norway. Fallback: Open-Meteo (both keyless), adapted to one shape.
   Sequential so a working primary doesn't fire a wasted fallback request. */
async function fetchWeather(lat, lon) {
  try {
    return await fetchMetNo(lat, lon);
  } catch (primaryErr) {
    try {
      return await fetchOpenMeteo(lat, lon);
    } catch {
      throw primaryErr;
    }
  }
}

/* MET Norway symbol_code (suffix stripped) → nearest WMO code so the existing icon/label maps work */
const MET_WMO = {
  clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45,
  lightrain: 61, rain: 63, heavyrain: 65,
  lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82,
  lightrainandthunder: 95, rainandthunder: 95, heavyrainandthunder: 96,
  lightrainshowersandthunder: 95, rainshowersandthunder: 95, heavyrainshowersandthunder: 96,
  drizzle: 51, lightdrizzle: 51,
  lightsleet: 66, sleet: 66, heavysleet: 67,
  lightsleetshowers: 66, sleetshowers: 66, heavysleetshowers: 67,
  lightsnow: 71, snow: 73, heavysnow: 75,
  lightsnowshowers: 85, snowshowers: 85, heavysnowshowers: 86,
  lightsnowandthunder: 95, snowandthunder: 95, heavysnowandthunder: 96,
};
const metWmo = (sym) => (sym ? (MET_WMO[sym.replace(/_(day|night|polartwilight)$/, '')] ?? 3) : 3);

/* Approximate sunrise/sunset (NOAA algorithm) so day/night icons work without an extra API */
function sunTimes(lat, lon, date) {
  const rad = Math.PI / 180, deg = 180 / Math.PI, zenith = 90.833;
  const N = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const lngHour = lon / 15;
  const calc = (rising) => {
    const t = N + ((rising ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = (M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634) % 360; if (L < 0) L += 360;
    let RA = (deg * Math.atan(0.91764 * Math.tan(L * rad))) % 360; if (RA < 0) RA += 360;
    RA = (RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90)) / 15;
    const sinDec = 0.39782 * Math.sin(L * rad), cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(zenith * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null;
    let H = rising ? 360 - deg * Math.acos(cosH) : deg * Math.acos(cosH); H /= 15;
    let UT = (H + RA - 0.06571 * t - 6.622 - lngHour) % 24; if (UT < 0) UT += 24;
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + UT * 3600000);
  };
  return { sunrise: calc(true), sunset: calc(false) };
}

async function fetchMetNo(lat, lon) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  let r;
  try { r = await fetch(url, { signal: ctl.signal }); }
  finally { clearTimeout(timer); }
  if (!r.ok) throw new Error(`met.no ${r.status}`);
  const ts = (await r.json()).properties.timeseries;
  const sym = (d) => d.next_1_hours?.summary?.symbol_code || d.next_6_hours?.summary?.symbol_code || d.next_12_hours?.summary?.symbol_code;

  const c = ts[0].data, ci = c.instant.details;
  const current = {
    time: ts[0].time,
    temperature_2m: ci.air_temperature,
    relative_humidity_2m: ci.relative_humidity,
    apparent_temperature: ci.air_temperature,
    weather_code: metWmo(sym(c)),
    wind_speed_10m: (ci.wind_speed ?? 0) * 3.6,
    wind_direction_10m: ci.wind_from_direction ?? 0,
    surface_pressure: ci.air_pressure_at_sea_level,
    precipitation: c.next_1_hours?.details?.precipitation_amount ?? 0,
  };

  const hourly = { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [] };
  for (const t of ts) {
    if (hourly.time.length >= 24) break;
    hourly.time.push(t.time);
    hourly.temperature_2m.push(t.data.instant.details.air_temperature);
    hourly.weather_code.push(metWmo(sym(t.data)));
    hourly.precipitation_probability.push(Math.round(t.data.next_1_hours?.details?.probability_of_precipitation ?? 0));
  }

  const byDay = {};
  for (const t of ts) {
    const day = t.time.slice(0, 10);
    (byDay[day] ||= { temps: [], uv: [], syms: [] });
    const det = t.data.instant.details;
    byDay[day].temps.push(det.air_temperature);
    if (det.ultraviolet_index_clear_sky != null) byDay[day].uv.push(det.ultraviolet_index_clear_sky);
    const s = sym(t.data);
    if (s) byDay[day].syms.push({ h: new Date(t.time).getUTCHours(), s });
  }
  const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], sunrise: [], sunset: [], uv_index_max: [] };
  for (const day of Object.keys(byDay).sort().slice(0, 7)) {
    const d = byDay[day];
    daily.time.push(day);
    daily.temperature_2m_max.push(Math.max(...d.temps));
    daily.temperature_2m_min.push(Math.min(...d.temps));
    daily.uv_index_max.push(d.uv.length ? Math.max(...d.uv) : 0);
    const rep = d.syms.slice().sort((a, b) => Math.abs(a.h - 12) - Math.abs(b.h - 12))[0];
    daily.weather_code.push(metWmo(rep?.s));
    const { sunrise, sunset } = sunTimes(lat, lon, new Date(day + 'T00:00:00Z'));
    daily.sunrise.push(sunrise ? sunrise.toISOString() : null);
    daily.sunset.push(sunset ? sunset.toISOString() : null);
  }
  return { current, hourly, daily, _provider: 'met.no' };
}

/* ---------- Rendering ---------- */
function statItem(label, value, iconSvg) {
  return `<div class="stat">
    <div class="stat-label">${iconSvg}${label}</div>
    <div class="stat-value">${value}</div>
  </div>`;
}
const SI = {
  humidity: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  wind: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h7"/></svg>',
  uv: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M19 5l-1 1M6 18l-1 1"/></svg>',
  press: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 0 0-9 9h4a5 5 0 0 1 10 0h4a9 9 0 0 0-9-9z"/><path d="M12 12l3-2"/></svg>',
};
function uvLabel(v) {
  if (v == null) return '';
  if (v < 3) return 'Low'; if (v < 6) return 'Moderate'; if (v < 8) return 'High'; if (v < 11) return 'Very high'; return 'Extreme';
}
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const windCardinal = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

function renderCurrent(place, data) {
  const c = data.current;
  const d = data.daily;
  const night = isNightAt(c.time, d.sunrise[0], d.sunset[0]);
  el.placeName.textContent = place.name;
  el.placeMeta.textContent = [place.admin, place.country].filter(Boolean).join(', ') || `${place.lat.toFixed(2)}, ${place.lon.toFixed(2)}`;
  el.heroIcon.innerHTML = icon(iconKey(c.weather_code), night);
  el.tempValue.textContent = round(c.temperature_2m);
  // Timezone may arrive with the forecast (Open-Meteo) — capture it, else look it up.
  if (data.timezone && !place.tz) place.tz = data.timezone;
  if (data.utc_offset_seconds != null && place.offset == null) place.offset = data.utc_offset_seconds;
  updateHeroTime();
  ensureHeroTz(place);
  const precip = c.precipitation ?? 0;
  el.heroCond.innerHTML = `${describe(c.weather_code)}${precip > 0 ? ` <span class="precip-badge">💧 ${precip} mm/h</span>` : ''}`;
  el.tempHi.textContent = `H:${round(d.temperature_2m_max[0])}°`;
  el.tempLo.textContent = `L:${round(d.temperature_2m_min[0])}°`;
  el.feelsLike.textContent = `Feels ${round(c.apparent_temperature)}°`;
  const wd = c.wind_direction_10m ?? 0;
  const windArrow = `<svg class="wind-arrow" viewBox="0 0 24 24" style="transform:rotate(${(wd + 180) % 360}deg)"><path d="M12 3l6 16-6-4-6 4z"/></svg>`;
  el.stats.innerHTML =
    statItem('Humidity', `${round(c.relative_humidity_2m)}<small>%</small>`, SI.humidity) +
    statItem('Wind', `${windArrow}${round(c.wind_speed_10m)}<small> km/h ${windCardinal(wd)}</small>`, SI.wind) +
    statItem('UV Index', `${round(d.uv_index_max[0] ?? 0)} <small>${uvLabel(d.uv_index_max[0])}</small>`, SI.uv) +
    statItem('Pressure', `${round(c.surface_pressure)}<small> hPa</small>`, SI.press);
  updateWindIndicator(c.wind_speed_10m, wd);
}

function renderHourly(data, dayIndex = 0) {
  const h = data.hourly;
  const sr = data.daily.sunrise, ss = data.daily.sunset;
  // Day 0 = rolling next 24h from "now"; any other day = that day's 00:00–23:00.
  let start, useNow;
  if (dayIndex === 0) {
    const now = new Date(data.current.time).getTime();
    start = h.time.findIndex((t) => new Date(t).getTime() >= now);
    if (start < 0) start = 0;
    useNow = true;
  } else {
    start = dayIndex * 24;
    useNow = false;
  }
  let html = '';
  for (let i = start; i < start + 24 && i < h.time.length; i++) {
    const day = Math.floor(i / 24);
    const night = isNightAt(h.time[i], sr[day] || sr[0], ss[day] || ss[0]);
    const pop = h.precipitation_probability?.[i] ?? 0;
    const isNow = useNow && i === start;
    html += `<div class="hour ${isNow ? 'now' : ''}">
      <div class="hour-time">${isNow ? 'Now' : fmtHour(h.time[i])}</div>
      <div class="hour-ic">${icon(iconKey(h.weather_code[i]), night)}</div>
      <div class="hour-temp">${round(h.temperature_2m[i])}°</div>
      <div class="hour-pop">${pop >= 15 ? `💧${pop}%` : ''}</div>
    </div>`;
  }
  el.hourly.innerHTML = html;
  el.hourly.scrollLeft = 0;
  if (el.hourlySub) {
    el.hourlySub.textContent = dayIndex === 0
      ? 'Next 24 hours'
      : new Date(data.daily.time[dayIndex]).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
}

function selectDay(dayIndex) {
  if (!state.weather) return;
  state.selectedDay = dayIndex;
  renderHourly(state.weather, dayIndex);
  [...el.daily.querySelectorAll('.day')].forEach((n, i) => n.classList.toggle('active', i === dayIndex));
}

function renderDaily(data) {
  const d = data.daily;
  const min = Math.min(...d.temperature_2m_min);
  const max = Math.max(...d.temperature_2m_max);
  const span = Math.max(1, max - min);
  let html = '';
  for (let i = 0; i < d.time.length; i++) {
    const dayName = i === 0 ? 'Today' : DAYS[new Date(d.time[i]).getDay()];
    const lo = d.temperature_2m_min[i], hi = d.temperature_2m_max[i];
    const left = ((lo - min) / span) * 100;
    const width = ((hi - lo) / span) * 100;
    html += `<div class="day ${i === state.selectedDay ? 'active' : ''}" data-day="${i}" role="button" tabindex="0" aria-label="Show hourly forecast for ${dayName}">
      <div class="day-name">${dayName}</div>
      <div class="day-ic">${icon(iconKey(d.weather_code[i]), false)}</div>
      <div class="day-cond">${describe(d.weather_code[i])}</div>
      <div class="day-range">
        <span class="day-lo">${round(lo)}°</span>
        <span class="range-bar"><span class="range-fill" style="left:${left}%;width:${width}%"></span></span>
        <span class="day-hi">${round(hi)}°</span>
      </div>
    </div>`;
  }
  el.daily.innerHTML = html;
}

/* Current local time for a saved city: use its IANA timezone if known (accurate, DST-aware),
   else fall back to a longitude-based offset so a time always shows. */
function cityLocalTime(c) {
  if (c.tz) {
    try { return new Date().toLocaleTimeString([], { timeZone: c.tz, hour: 'numeric', minute: '2-digit' }); }
    catch { /* fall through */ }
  }
  const offsetSec = c.offset != null ? c.offset : Math.round((c.lon || 0) / 15) * 3600;
  const d = new Date(Date.now() + offsetSec * 1000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/* Local wall-clock for a place, split into a big "H:MM" and an "AM/PM" suffix.
   Prefers the IANA tz (DST-accurate), then a stored UTC offset, then longitude. */
function placeLocalTimeParts(c) {
  let h = null, m = 0;
  if (c.tz) {
    try {
      const s = new Date().toLocaleTimeString('en-GB', { timeZone: c.tz, hour12: false, hour: '2-digit', minute: '2-digit' });
      [h, m] = s.split(':').map(Number);
    } catch { h = null; }
  }
  if (h == null) {
    const offsetSec = c.offset != null ? c.offset : Math.round((c.lon || 0) / 15) * 3600;
    const d = new Date(Date.now() + offsetSec * 1000);
    h = d.getUTCHours(); m = d.getUTCMinutes();
  }
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { time: `${h12}:${String(m).padStart(2, '0')}`, ampm };
}

/* Repaint the hero clock beside the temperature from the current place. */
function updateHeroTime() {
  if (!el.heroTime || !state.current) return;
  const { time, ampm } = placeLocalTimeParts(state.current);
  el.heroTime.textContent = time;
  el.heroAmpm.textContent = ampm;
  el.heroClock.hidden = false;
  el.heroSep.hidden = false;
}

/* Upgrade a place to a DST-accurate IANA timezone in the background (keyless),
   falling back silently to the longitude estimate if the lookup is unavailable. */
async function ensureHeroTz(place) {
  if (place.tz) return;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m&timezone=auto`);
    if (!r.ok) return;
    const j = await r.json();
    if (state.current !== place) return; // user moved on
    if (j.timezone) place.tz = j.timezone;
    if (j.utc_offset_seconds != null) place.offset = j.utc_offset_seconds;
    updateHeroTime();
  } catch { /* keep the longitude fallback already shown */ }
}

/* City's current local hour (0–24), from its IANA tz if known, else longitude/offset. */
function cityLocalHour(c) {
  if (c.tz) {
    try {
      const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: c.tz, hour12: false, hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
      return h + m / 60;
    } catch { /* fall through */ }
  }
  const offsetSec = c.offset != null ? c.offset : Math.round((c.lon || 0) / 15) * 3600;
  const d = new Date(Date.now() + offsetSec * 1000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}
/* Night = before ~6am or after ~7pm local (approx, for the day/night icon). */
function cityIsNight(c) {
  const h = cityLocalHour(c);
  return h < 6 || h >= 19;
}

function renderSaved() {
  el.savedCount.textContent = `${state.cities.length}/${MAX_CITIES}`;
  if (!state.cities.length) {
    el.savedList.innerHTML = `<div class="saved-empty">No cities yet. Search above or pin one on the map.</div>`;
    return;
  }
  el.savedList.innerHTML = state.cities.map((c) => {
    const active = state.current && cityKey(state.current) === cityKey(c);
    const temp = c.temp != null ? `${round(c.temp)}°` : '';
    const night = cityIsNight(c);
    return `<div class="city ${active ? 'active' : ''}" data-key="${cityKey(c)}">
      <div class="city-ic">${icon(c.iconKey || 'cloudy', night)}</div>
      <div class="city-info">
        <div class="city-name">${c.name}</div>
        <div class="city-country">${c.country || ''}</div>
      </div>
      <div class="city-meta">
        <div class="city-temp">${temp}</div>
        <div class="city-time"><span class="city-daynight" title="${night ? 'Night' : 'Day'}">${icon('clear', night)}</span>${cityLocalTime(c)}</div>
      </div>
      <button class="city-del" data-del="${cityKey(c)}" title="Remove" aria-label="Remove ${c.name}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join('');
}

/* Refresh temps shown on saved city chips (best-effort, parallel) */
async function refreshSavedTemps() {
  await Promise.all(state.cities.map(async (c) => {
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code&timezone=auto`);
      const j = await r.json();
      c.temp = j.current?.temperature_2m;
      c.iconKey = iconKey(j.current?.weather_code);
      if (j.timezone) c.tz = j.timezone;
      if (j.utc_offset_seconds != null) c.offset = j.utc_offset_seconds;
    } catch { /* ignore */ }
  }));
  renderSaved();
}

/* ============================================================
   TRAVEL SECTION
   Country facts via restcountries (keyless), SGD rates via
   open.er-api.com (keyless), curated attractions/risks, and
   generated safety / accommodation / language links.
   ============================================================ */

/* Curated attractions ("Name — descriptor") and key risks, by ISO alpha-2 */
const TRAVEL_DATA = {
  SG: { attractions: ['Marina Bay Sands & Gardens by the Bay — futuristic skyline, Supertree light show and the SkyPark', 'Sentosa Island — beaches, Universal Studios and cable-car rides', 'Chinatown & hawker centres — heritage shophouses and world-class street food'], risks: ['Extremely safe, but strict laws — heavy fines/penalties for drugs, vaping, littering and jaywalking.', 'Hot and humid year-round; stay hydrated and pace outdoor plans.', 'Occasional haze from regional fires (Jun–Oct); check the PSI index.'] },
  MY: { attractions: ['Petronas Twin Towers, Kuala Lumpur — iconic skybridge and city views', 'George Town, Penang — UNESCO street art, temples and food', 'Langkawi — island beaches, cable car and rainforest'], risks: ['Bag-snatching and petty theft in cities — use Grab or registered taxis.', 'Dengue is present; use repellent, especially at dawn/dusk.', 'Flash floods and monsoon rains (west coast Nov–Mar; east coast varies).'] },
  TH: { attractions: ['Grand Palace & Wat Pho, Bangkok — royal temples and the reclining Buddha', 'Old City temples, Chiang Mai — historic wats and night markets', 'Phi Phi & Phuket — turquoise bays and island-hopping'], risks: ['Common scams: tuk-tuk detours, gem shops and jet-ski damage deposits.', 'Motorbike/scooter accidents are the top injury — wear a helmet, get insurance.', 'Respect strict lèse-majesté laws; dengue and southern monsoon season.'] },
  ID: { attractions: ['Borobudur — the world’s largest Buddhist temple at sunrise', 'Bali — Ubud rice terraces, temples and surf beaches', 'Komodo National Park — dragons and world-class diving'], risks: ['Seismic zone — earthquakes, active volcanoes and tsunami risk.', 'Food/water hygiene ("Bali belly") — drink bottled water.', 'Chaotic traffic and strong beach rip currents; heed warning flags.'] },
  VN: { attractions: ['Ha Long Bay — limestone karsts and overnight cruises', 'Hoi An Ancient Town — lantern-lit streets and tailors', 'Cu Chi Tunnels & Ho Chi Minh City — war history and street food'], risks: ['Dense motorbike traffic — cross slowly and steadily.', 'Bag-snatching from passing motorbikes in HCMC — keep phones secure.', 'Taxi meter scams — use Grab or reputable metered taxis.'] },
  PH: { attractions: ['Boracay — powder-white sand and sunset sails', 'Palawan (El Nido & Coron) — lagoons, cliffs and wreck diving', 'Chocolate Hills, Bohol — surreal rolling landscape'], risks: ['Typhoon season (Jun–Nov) — monitor advisories and reroute if needed.', 'Petty crime in Manila — avoid displaying valuables.', 'Some regions (parts of Mindanao) are advised against — check before travel.'] },
  JP: { attractions: ['Fushimi Inari & Kyoto temples — thousands of vermilion torii gates', 'Tokyo — Shibuya Crossing, Senso-ji and neon nightlife', 'Mount Fuji & Hakone — hot springs and lake views'], risks: ['Very safe, low crime — main hazards are natural.', 'Earthquakes and typhoons; know your hotel’s evacuation info.', 'Still partly cash-based — carry yen; IC cards help for transit.'] },
  KR: { attractions: ['Gyeongbokgung Palace, Seoul — grand gates and guard-changing', 'Bukchon Hanok Village — traditional hillside houses', 'Jeju Island — volcanic craters, coast and waterfalls'], risks: ['Very safe; occasional heightened alerts re: North Korea.', 'Summer typhoons, heat and humidity; spring fine-dust air quality.', 'Fast-paced traffic — cross only at signals.'] },
  CN: { attractions: ['Great Wall (Mutianyu/Badaling) near Beijing', 'Forbidden City & Tiananmen, Beijing', 'Terracotta Army, Xi’an'], risks: ['Heavy internet censorship — install a VPN before you arrive.', 'Cashless via WeChat/Alipay dominates; link a card in advance.', 'Air pollution in big cities; tea-house and art-student scams near sights.'] },
  HK: { attractions: ['Victoria Peak — skyline panorama by tram', 'Tsim Sha Tsui & Symphony of Lights — harbourfront show', 'Big Buddha & Po Lin Monastery, Lantau'], risks: ['Generally very safe; avoid any protests or large crowds.', 'Typhoon season (May–Nov) — heed T8+ signals; services shut down.', 'Steep, humid terrain — carry water on hikes.'] },
  TW: { attractions: ['Taipei 101 — observation deck and night markets', 'Taroko Gorge — marble canyon and trails', 'Jiufen Old Street — teahouses and mountain views'], risks: ['Very safe; scooter-heavy traffic — cross carefully.', 'Earthquakes and summer typhoons.', 'Humidity and heat May–Sep; carry water.'] },
  IN: { attractions: ['Taj Mahal, Agra — marble mausoleum at sunrise', 'Amber Fort & Jaipur — the Pink City’s palaces', 'Kerala backwaters — houseboat cruises'], risks: ['Drink only bottled/filtered water; ease into local food ("Delhi belly").', 'Persistent touts and scams at stations and major sights.', 'Winter air pollution in the north; women travellers should take extra care.'] },
  AE: { attractions: ['Burj Khalifa & Dubai Mall — world’s tallest tower and fountains', 'Sheikh Zayed Grand Mosque, Abu Dhabi — vast white marble', 'Desert safari — dunes, camels and sunset camps'], risks: ['Conservative laws — modest dress, no public intoxication or PDA.', 'Zero tolerance for drugs (incl. some prescription meds) and offensive gestures.', 'Extreme summer heat (>45°C) — limit midday sun.'] },
  AU: { attractions: ['Sydney Opera House & Harbour Bridge', 'Great Barrier Reef — snorkelling and diving', 'Uluru — sacred desert monolith at sunset'], risks: ['Intense UV — sunscreen, hat and shade even on cloudy days.', 'Bushfire risk in summer; check warnings on regional trips.', 'Ocean rips and wildlife — swim between the flags.'] },
  NZ: { attractions: ['Milford Sound — fiords, waterfalls and cruises', 'Hobbiton & Rotorua — film sets and geothermal parks', 'Queenstown — bungy, skiing and lake scenery'], risks: ['Rapidly changeable alpine weather — carry layers on hikes.', 'Earthquakes occur; know the "Drop, Cover, Hold" drill.', 'Long rural drives on the left — plan fuel and rest stops.'] },
  GB: { attractions: ['Tower of London & Buckingham Palace', 'The British Museum — Rosetta Stone and global antiquities', 'Edinburgh & the Scottish Highlands'], risks: ['Generally safe; watch for pickpockets in tourist and transit hubs.', 'National terror threat level is "substantial" — stay alert in crowds.', 'Wet, changeable weather — carry a waterproof layer.'] },
  FR: { attractions: ['Eiffel Tower & the Louvre, Paris', 'Palace of Versailles — halls and gardens', 'French Riviera — Nice, Cannes and coastal towns'], risks: ['Pickpocketing on the Paris metro and around landmarks.', 'Strikes and demonstrations can disrupt transport — check ahead.', 'Terror vigilance (Vigipirate); keep bags close in crowds.'] },
  IT: { attractions: ['Colosseum & Vatican Museums, Rome', 'Venice — canals, St Mark’s and gondolas', 'Florence & Tuscany — Renaissance art and hill towns'], risks: ['Pickpockets and bag-snatchers near Rome/Venice/Naples stations.', 'Ticket, taxi and "friendship bracelet" scams at big sights.', 'Summer heat waves; ZTL zones bring driving fines in city centres.'] },
  ES: { attractions: ['Sagrada Família & Park Güell, Barcelona', 'Alhambra, Granada — Moorish palace and gardens', 'Madrid — the Prado and Retiro Park'], risks: ['Pickpocketing in Barcelona/Madrid tourist zones and on the metro.', 'Beach and terrace bag theft — never leave items unattended.', 'Summer heat waves inland; siesta hours affect opening times.'] },
  DE: { attractions: ['Brandenburg Gate & Museum Island, Berlin', 'Neuschwanstein Castle, Bavaria', 'Cologne Cathedral — Gothic twin spires'], risks: ['Very safe; watch for pickpockets at stations and festivals.', 'Cash is still widely used — carry euros; many places refuse cards.', 'Sundays: most shops close; plan groceries ahead.'] },
  CH: { attractions: ['Jungfraujoch & Interlaken — "Top of Europe"', 'Matterhorn & Zermatt — car-free alpine village', 'Lake Geneva & Lucerne — lakeside old towns'], risks: ['Very safe but very expensive — budget accordingly.', 'Alpine hazards — weather shifts, altitude and closed passes.', 'Strict rules on littering, recycling and Sunday noise.'] },
  NL: { attractions: ['Amsterdam canals & the Rijksmuseum', 'Keukenhof — spring tulip gardens (Mar–May)', 'Van Gogh Museum'], risks: ['Watch for cyclists — never walk or stand in bike lanes.', 'Bike theft and pickpocketing in central Amsterdam.', 'Cannabis is regulated, not anything-goes; respect local rules.'] },
  US: { attractions: ['Statue of Liberty & Times Square, New York', 'Grand Canyon, Arizona', 'Golden Gate Bridge & Yosemite, California'], risks: ['Safety varies by neighbourhood — research areas before you go.', 'Healthcare is very expensive — comprehensive insurance is essential.', 'Tipping (15–20%) is expected; know local emergency number 911.'] },
  TR: { attractions: ['Hagia Sophia & Blue Mosque, Istanbul', 'Cappadocia — hot-air balloons over fairy chimneys', 'Pamukkale — white travertine terraces'], risks: ['Persistent touts and carpet/restaurant scams in Istanbul.', 'Major earthquake zone; know your building’s exits.', 'Avoid the Syria border region — check current advisories.'] },
  EG: { attractions: ['Pyramids of Giza & the Sphinx', 'Egyptian Museum, Cairo — Tutankhamun treasures', 'Luxor temples & Nile cruises'], risks: ['Aggressive touts and baksheesh expectations at every site.', 'Follow advisories — parts of Sinai and border areas are restricted.', 'Drink bottled water only; carry stomach medication.'] },
  GR: { attractions: ['Acropolis & Parthenon, Athens', 'Santorini — caldera views and sunsets', 'Meteora — cliff-top monasteries'], risks: ['Pickpockets on the Athens metro and at ferry ports.', 'Summer heat waves and wildfire risk — heed local alerts.', 'Ferry schedules shift with weather and strikes — build in buffer days.'] },
  PT: { attractions: ['Belém Tower & Alfama, Lisbon — trams and viewpoints', 'Douro Valley & Porto — port wine and river', 'Sintra — fairytale palaces in the hills'], risks: ['Very safe; pickpockets on Lisbon trams (28) and tourist spots.', 'Strong Atlantic rip currents — swim at patrolled beaches.', 'Summer heat inland; steep, slippery cobbled streets.'] },
};

/* Curated TOP-3 attractions by city ("Name — descriptor"). Keyed by ascii-normalised city name. */
const CITY_ATTRACTIONS = {
  // — Asia —
  tokyo: ['Senso-ji Temple, Asakusa — Tokyo’s oldest temple and Nakamise street', 'Meiji Shrine & Shibuya Crossing — forest shrine beside the famous crossing', 'Tokyo Skytree & teamLab Planets — sky views and immersive digital art', 'Shinjuku & Tokyo Tower — neon nightlife and city panoramas', 'Ueno Park & Akihabara — museums, zoo and electric town'],
  kyoto: ['Fushimi Inari Shrine — thousands of vermilion torii gates', 'Kinkaku-ji (Golden Pavilion) — gold-leaf temple over a pond', 'Arashiyama Bamboo Grove — bamboo path and Tenryu-ji temple', 'Kiyomizu-dera — hillside wooden temple with city views', 'Gion District — geisha quarter of teahouses and lanes'],
  osaka: ['Osaka Castle — landmark keep in a moated park', 'Dotonbori — neon canal district of street food', 'Universal Studios Japan — theme park incl. Super Nintendo World', 'Kuromon Ichiba Market — bustling covered food market', 'Shinsekai & Shitenno-ji — retro district and ancient temple'],
  bangkok: ['Grand Palace & Wat Phra Kaew — royal complex, Emerald Buddha', 'Wat Pho — the giant Reclining Buddha', 'Wat Arun — riverside "Temple of Dawn"', 'Chatuchak Weekend Market — 15,000-stall mega market', 'Chao Phraya River & Wat Traimit — boat rides and the Golden Buddha'],
  singapore: ['Marina Bay Sands & Gardens by the Bay — Supertree show, SkyPark', 'Sentosa Island — beaches, Universal Studios, cable cars', 'Chinatown & hawker centres — shophouses and street food', 'Botanic Gardens & Orchard Road — UNESCO gardens and shopping', 'Singapore Zoo & Night Safari — world-class wildlife parks'],
  seoul: ['Gyeongbokgung Palace — grand royal palace, guard-changing', 'Bukchon Hanok Village — traditional hillside houses', 'N Seoul Tower (Namsan) — panoramic city views', 'Myeongdong & Gwangjang Market — shopping and street food', 'Changdeokgung & Secret Garden — UNESCO palace grounds'],
  'hong kong': ['Victoria Peak — skyline panorama by tram', 'Tsim Sha Tsui Promenade — harbour views, Symphony of Lights', 'Big Buddha & Po Lin Monastery, Lantau — giant bronze Buddha', 'Temple Street Night Market — bustling night bazaar', 'Star Ferry & Ngong Ping cable car — harbour crossing and skyride'],
  beijing: ['Great Wall at Mutianyu — restored ramparts and cable car', 'Forbidden City — vast imperial palace', 'Temple of Heaven — Ming circular prayer hall', 'Summer Palace — imperial lakeside gardens', 'Tiananmen Square & hutongs — grand square and old lanes'],
  shanghai: ['The Bund — colonial waterfront and skyline', 'Yu Garden — Ming-dynasty gardens and bazaar', 'Oriental Pearl Tower — landmark with glass skywalk', 'Nanjing Road & French Concession — shopping and leafy streets', 'Shanghai Museum — bronzes, ceramics and calligraphy'],
  taipei: ['Taipei 101 — supertall tower and observation deck', 'National Palace Museum — world-class Chinese art', 'Chiang Kai-shek Memorial Hall — grand plaza, honour guard', 'Shilin Night Market — Taipei’s biggest street-food market', 'Beitou & Maokong — hot springs and tea-house gondola'],
  'kuala lumpur': ['Petronas Twin Towers — skybridge and city views', 'Batu Caves — limestone caves and giant golden statue', 'Merdeka Square & Central Market — colonial heart and crafts', 'KL Tower & Bukit Bintang — views, shopping and nightlife', 'Islamic Arts Museum & Lake Gardens — art and green space'],
  jakarta: ['National Monument (Monas) — obelisk in Merdeka Square', 'Kota Tua (Old Town) — Dutch-colonial squares and museums', 'Istiqlal Mosque — Southeast Asia’s largest mosque', 'Taman Mini Indonesia Indah — cultural park of the archipelago', 'Thousand Islands — day trips to nearby island beaches'],
  hanoi: ['Hoan Kiem Lake & Old Quarter — lake temple and buzzing lanes', 'Temple of Literature — Vietnam’s first university', 'Ho Chi Minh Mausoleum — solemn national memorial', 'Train Street & Hoa Lo Prison — narrow rail lane and history', 'Ha Long Bay — iconic karst-bay day and overnight trips'],
  'ho chi minh city': ['War Remnants Museum — sobering Vietnam War history', 'Notre-Dame Basilica & Central Post Office — colonial landmarks', 'Ben Thanh Market — bustling market for food and goods', 'Reunification Palace — 1970s presidential palace', 'Cu Chi Tunnels — wartime tunnel-network day trip'],
  manila: ['Intramuros & Fort Santiago — walled Spanish-colonial old city', 'Rizal Park — national hero’s memorial gardens', 'San Agustin Church — UNESCO baroque church', 'Manila Bay & Mall of Asia — sunset promenade and mega-mall', 'Binondo — the world’s oldest Chinatown food walk'],
  mumbai: ['Gateway of India — waterfront triumphal arch', 'Marine Drive — seaside promenade "Queen’s Necklace"', 'Elephanta Caves — rock-cut island temples', 'Chhatrapati Shivaji Terminus — Victorian-Gothic UNESCO station', 'Colaba & Dhobi Ghat — markets and open-air laundry'],
  pune: ['Shaniwar Wada — 18th-century Maratha palace fort', 'Aga Khan Palace — Gandhi memorial set in gardens', 'Sinhagad Fort — hilltop fort with valley views', 'Dagdusheth Halwai Ganpati Temple — ornate, revered Ganesh temple', 'Pataleshwar Cave Temple — rock-cut 8th-century shrine'],
  delhi: ['Red Fort — Mughal sandstone fortress', 'Qutub Minar — soaring victory tower', 'India Gate & Humayun’s Tomb — war memorial and garden tomb', 'Lotus Temple & Akshardham — modern architectural marvels', 'Chandni Chowk & Jama Masjid — old-Delhi bazaar and grand mosque'],
  dubai: ['Burj Khalifa & Dubai Mall — world’s tallest tower and fountains', 'Palm Jumeirah — palm-shaped island and Atlantis', 'Dubai Marina & desert safari — waterfront and dune trips', 'Old Dubai (Al Fahidi & souks) — creek, abras, gold & spice souks', 'Museum of the Future & Dubai Frame — futuristic landmarks'],
  'abu dhabi': ['Sheikh Zayed Grand Mosque — vast white-marble mosque', 'Louvre Abu Dhabi — domed art museum on the coast', 'Qasr Al Watan — opulent presidential palace', 'Ferrari World & Yas Island — theme parks and racing', 'Corniche & Emirates Palace — waterfront and grand hotel'],
  phuket: ['Big Buddha — hilltop marble statue with island views', 'Patong Beach & Bangla Road — beach and nightlife hub', 'Phi Phi Islands — day trips to turquoise bays', 'Old Phuket Town — Sino-Portuguese streets', 'Phang Nga Bay — James Bond Island by longtail'],
  'chiang mai': ['Wat Phra That Doi Suthep — golden mountaintop temple', 'Old City temples — moated historic wats and markets', 'Ethical elephant sanctuaries — half-day nature visits', 'Sunday Walking Street — night market of crafts and food', 'Doi Inthanon — Thailand’s highest peak day trip'],
  'siem reap': ['Angkor Wat — the world’s largest temple at sunrise', 'Angkor Thom & Bayon — city of giant stone faces', 'Ta Prohm — jungle-wrapped "Tomb Raider" temple', 'Banteay Srei — intricate pink-sandstone temple', 'Tonlé Sap — floating villages on the great lake'],
  bali: ['Uluwatu Temple — clifftop sea temple, sunset kecak dance', 'Tegallalang Rice Terraces, Ubud — emerald stepped paddies', 'Tanah Lot — offshore temple on a rock', 'Sacred Monkey Forest, Ubud — jungle sanctuary and temples', 'Mount Batur — sunrise volcano trek'],
  colombo: ['Gangaramaya Temple — eclectic Buddhist temple', 'Galle Face Green — seaside promenade', 'Pettah Market & Red Mosque — vibrant bazaar district', 'National Museum — Sri Lankan history and art', 'Independence Square & Lotus Tower — landmark and tower'],
  // — Europe —
  london: ['Tower of London — Crown Jewels and medieval fortress', 'British Museum — Rosetta Stone and global antiquities', 'Buckingham Palace & Westminster — royal residence and Big Ben', 'London Eye & South Bank — riverside wheel and culture', 'Tower Bridge & St Paul’s — iconic bridge and cathedral'],
  paris: ['Eiffel Tower — the city’s iconic iron landmark', 'Louvre Museum — the Mona Lisa and vast art collection', 'Notre-Dame & Île de la Cité — Gothic cathedral, historic island', 'Montmartre & Sacré-Cœur — hilltop artists’ quarter', 'Champs-Élysées & Arc de Triomphe — grand avenue and arch'],
  rome: ['Colosseum & Roman Forum — ancient amphitheatre and ruins', 'Vatican Museums & St Peter’s — Sistine Chapel and basilica', 'Trevi Fountain — baroque coin-toss fountain', 'Pantheon — best-preserved Roman temple', 'Spanish Steps & Trastevere — piazza and trattoria quarter'],
  venice: ['St Mark’s Basilica & Square — golden mosaics and campanile', 'Grand Canal & Rialto Bridge — gondolas and iconic bridge', 'Doge’s Palace — Gothic seat of the Venetian Republic', 'Murano & Burano — glass and rainbow-house islands', 'Gallerie dell’Accademia — Venetian master paintings'],
  florence: ['Florence Cathedral (Duomo) — Brunelleschi’s red dome', 'Uffizi Gallery — Botticelli and Renaissance masters', 'Ponte Vecchio — medieval shop-lined bridge', 'Accademia (David) — Michelangelo’s masterpiece', 'Piazzale Michelangelo — panoramic city viewpoint'],
  milan: ['Duomo di Milano — vast Gothic cathedral and rooftop', 'The Last Supper — da Vinci’s mural at Santa Maria delle Grazie', 'Galleria Vittorio Emanuele II — grand 19th-century arcade', 'Sforza Castle & Navigli — fortress and canal nightlife', 'Brera District — art gallery and stylish streets'],
  barcelona: ['Sagrada Família — Gaudí’s soaring basilica', 'Park Güell — mosaic terraces and city views', 'La Rambla & Gothic Quarter — famous boulevard and old town', 'Casa Batlló & La Pedrera — Gaudí’s modernist houses', 'Montjuïc & Camp Nou — hilltop park and football'],
  madrid: ['Prado Museum — Velázquez and Goya masterpieces', 'Royal Palace — opulent state apartments', 'Retiro Park & Plaza Mayor — lakeside park and grand square', 'Puerta del Sol & Gran Vía — bustling heart and shopping', 'Reina Sofía — Picasso’s Guernica'],
  berlin: ['Brandenburg Gate — neoclassical symbol of reunification', 'Reichstag — glass-domed parliament', 'East Side Gallery — the painted Berlin Wall', 'Museum Island — five world-class museums', 'Checkpoint Charlie & TV Tower — Cold-War site and views'],
  munich: ['Marienplatz & Glockenspiel — square with chiming clock', 'English Garden — huge park with river surfers', 'Nymphenburg Palace — baroque royal residence', 'Viktualienmarkt & Hofbräuhaus — food market and beer hall', 'BMW Welt & Olympiapark — museum and Olympic grounds'],
  amsterdam: ['Rijksmuseum — Rembrandt’s Night Watch and Dutch art', 'Van Gogh Museum — the world’s largest Van Gogh collection', 'Anne Frank House & canals — moving history along the waterways', 'Jordaan & canal cruise — charming lanes by boat', 'Vondelpark & Heineken Experience — park and brewery'],
  vienna: ['Schönbrunn Palace — Habsburg palace and gardens', 'St Stephen’s Cathedral — Gothic spire over the old town', 'Belvedere — Klimt’s "The Kiss" in a baroque palace', 'Hofburg & Spanish Riding School — imperial palace, Lipizzaners', 'Naschmarkt & Prater — market and giant Ferris wheel'],
  prague: ['Charles Bridge — statue-lined medieval bridge', 'Prague Castle & St Vitus — hilltop castle and cathedral', 'Old Town Square & Astronomical Clock — Gothic heart of the city', 'Jewish Quarter (Josefov) — synagogues and old cemetery', 'Petřín Hill & Lennon Wall — views and famous mural'],
  athens: ['Acropolis & Parthenon — ancient temple crowning the city', 'Acropolis Museum — sculptures from the sacred hill', 'Plaka & Monastiraki — old town and flea market', 'Ancient Agora & Temple of Hephaestus — classical ruins', 'Mount Lycabettus — panoramic hilltop'],
  santorini: ['Oia — whitewashed village and famous sunsets', 'Fira — clifftop capital over the caldera', 'Red Beach & Akrotiri — volcanic sands and Bronze-Age ruins', 'Caldera boat & hot springs — cruise the volcano', 'Wineries & Pyrgos — assyrtiko tastings and hilltop village'],
  lisbon: ['Belém Tower & Jerónimos Monastery — Manueline landmarks', 'Alfama & São Jorge Castle — hilltop views over old lanes', 'Tram 28 — vintage tram through historic districts', 'Praça do Comércio & Baixa — grand riverside square', 'LX Factory & Sintra — arts hub and fairytale-palace day trip'],
  porto: ['Ribeira District — riverside old town alleys', 'Livraria Lello — ornate historic bookshop', 'Dom Luís I Bridge & port cellars — iron bridge and wine tasting', 'São Bento Station — azulejo-tiled hall', 'Clérigos Tower & Douro cruise — views and river trips'],
  istanbul: ['Hagia Sophia — Byzantine-Ottoman domed marvel', 'Blue Mosque — six-minaret imperial mosque', 'Topkapi Palace — sultans’ palace and harem', 'Grand Bazaar & Spice Bazaar — vast historic markets', 'Bosphorus cruise & Basilica Cistern — strait boat, sunken columns'],
  zurich: ['Old Town (Altstadt) — medieval lanes and churches', 'Lake Zurich — promenades and boat trips', 'Bahnhofstrasse — famous shopping boulevard', 'Grossmünster & Fraumünster — towers and Chagall windows', 'Uetliberg — mountain viewpoint over the city'],
  interlaken: ['Jungfraujoch — "Top of Europe" glacier station', 'Harder Kulm — funicular to a twin-lakes viewpoint', 'Lakes Brienz & Thun — turquoise alpine waters', 'Grindelwald First — cliff walk and mountain carts', 'Lauterbrunnen & Trümmelbach Falls — valley of waterfalls'],
  edinburgh: ['Edinburgh Castle — fortress above the city', 'Royal Mile — old-town spine to Holyrood Palace', 'Arthur’s Seat — extinct volcano with panoramic views', 'Calton Hill & New Town — monuments and Georgian streets', 'Holyrood Palace & Dean Village — royal residence, riverside hamlet'],
  dublin: ['Trinity College & Book of Kells — historic library and manuscript', 'Guinness Storehouse — brewery experience and Gravity Bar', 'Temple Bar — lively cultural and nightlife quarter', 'Dublin Castle & Christ Church — historic seat and cathedral', 'Kilmainham Gaol & Phoenix Park — history and vast park'],
  copenhagen: ['Nyhavn — colourful canal-side harbour', 'Tivoli Gardens — historic amusement park', 'The Little Mermaid & Amalienborg — icon statue and royal palace', 'Rosenborg Castle & Strøget — crown jewels and shopping street', 'Christiania & Round Tower — free town and spiral tower'],
  stockholm: ['Gamla Stan — cobbled medieval old town', 'Vasa Museum — salvaged 17th-century warship', 'Royal Palace — vast baroque royal residence', 'Skansen & ABBA Museum — open-air museum and pop history', 'City Hall & archipelago cruise — Nobel hall and island boats'],
  reykjavik: ['Hallgrímskirkja — striking basalt-inspired church', 'Blue Lagoon — geothermal spa nearby', 'Golden Circle — geysers, waterfalls and rift day trip', 'Harpa & Sun Voyager — concert hall and sculpture', 'Northern Lights & whale watching — seasonal tours'],
  moscow: ['Red Square & St Basil’s — iconic onion-domed cathedral', 'Moscow Kremlin — fortified seat of power', 'Bolshoi Theatre — historic ballet and opera house', 'Metro palaces & GUM — ornate stations and grand arcade', 'Tretyakov Gallery & Gorky Park — Russian art and riverside park'],
  // — Americas —
  'new york': ['Statue of Liberty & Ellis Island — harbour icon by ferry', 'Central Park — vast green heart of Manhattan', 'Times Square & Empire State Building — neon crossroads and skyline', 'Metropolitan Museum & 5th Avenue — world-class art and shopping', 'Brooklyn Bridge & High Line — iconic walk and elevated park'],
  'los angeles': ['Hollywood Sign & Walk of Fame — cinema landmarks', 'Griffith Observatory — city and canyon views', 'Santa Monica Pier — beachfront rides and boardwalk', 'Getty Center & Universal Studios — art museum and movie park', 'Venice Beach & Beverly Hills — boardwalk and glamour'],
  'san francisco': ['Golden Gate Bridge — the iconic red suspension span', 'Alcatraz Island — infamous former prison by ferry', 'Fisherman’s Wharf & cable cars — waterfront and vintage trams', 'Chinatown & Lombard Street — oldest Chinatown, crooked street', 'Golden Gate Park & Painted Ladies — park and Victorian houses'],
  'las vegas': ['The Strip — mega-resorts and Bellagio fountains', 'Fremont Street — downtown light canopy', 'Grand Canyon day trips — helicopter and bus tours', 'High Roller & Sphere — giant wheel and immersive venue', 'Red Rock Canyon & Hoover Dam — desert scenery and the dam'],
  washington: ['National Mall & monuments — Lincoln Memorial and Washington Monument', 'Smithsonian museums — world-class free museums', 'US Capitol & White House — seats of government', 'Arlington Cemetery & war memorials — hallowed grounds', 'Georgetown & Tidal Basin — historic streets and cherry blossoms'],
  chicago: ['Millennium Park & "The Bean" — reflective Cloud Gate sculpture', 'Willis Tower Skydeck — glass ledge high above the city', 'Navy Pier — lakefront pier and Ferris wheel', 'Art Institute of Chicago — world-famous collection', 'Riverwalk & architecture cruise — skyline by boat'],
  atlanta: ['Georgia Aquarium — one of the world’s largest aquariums', 'World of Coca-Cola — the Coke brand museum', 'MLK Jr. National Historical Park — birth home & memorial', 'Centennial Olympic Park — 1996 Olympics park & fountains', 'Atlanta BeltLine & Ponce City Market — trail and food hall'],
  miami: ['South Beach — art-deco beachfront', 'Art Deco Historic District — pastel 1930s architecture', 'Wynwood Walls — open-air street-art murals', 'Little Havana — Cuban culture and cafés', 'Everglades & Vizcaya — airboat tours and a bayside villa'],
  toronto: ['CN Tower — landmark tower with glass floor', 'Royal Ontario Museum — art and natural history', 'Niagara Falls — day trip to the thundering falls', 'Distillery District & St Lawrence Market — historic lanes and food hall', 'Toronto Islands & Casa Loma — skyline views and a castle'],
  vancouver: ['Stanley Park — seawall and totem poles', 'Granville Island — public market and artisans', 'Capilano Suspension Bridge — treetop walk over a canyon', 'Grouse Mountain & Gastown — mountain and historic quarter', 'Science World & Kitsilano — geodesic dome and beaches'],
  'mexico city': ['Zócalo & Metropolitan Cathedral — grand central square', 'Teotihuacan — pyramids of the Sun and Moon', 'Frida Kahlo Museum — the artist’s Blue House', 'Chapultepec & Anthropology Museum — park and Aztec treasures', 'Xochimilco & Coyoacán — colourful canal boats and artsy district'],
  'rio de janeiro': ['Christ the Redeemer — hilltop statue over the bay', 'Sugarloaf Mountain — cable car to panoramic peaks', 'Copacabana & Ipanema — world-famous beaches', 'Selarón Steps & Santa Teresa — mosaic stairs and hilltop tram', 'Maracanã & Tijuca Forest — legendary stadium and urban rainforest'],
  'buenos aires': ['La Boca & Caminito — colourful tango streets', 'Recoleta Cemetery — ornate mausoleums incl. Evita', 'Plaza de Mayo & Casa Rosada — historic political heart', 'San Telmo & Puerto Madero — antiques market and waterfront', 'Teatro Colón & Palermo parks — grand opera house and green barrios'],
  lima: ['Historic Centre & Plaza Mayor — colonial architecture', 'Miraflores & Larcomar — clifftop parks over the Pacific', 'Larco Museum — pre-Columbian art collection', 'Barranco — bohemian arts district', 'Huaca Pucllana & Magic Water Circuit — adobe pyramid and fountain show'],
  cusco: ['Machu Picchu — the legendary Inca citadel', 'Sacsayhuamán — massive Inca stone walls', 'Plaza de Armas — colonial square on Inca foundations', 'Sacred Valley & Ollantaytambo — Inca towns and terraces', 'Rainbow Mountain — striped high-altitude peak'],
  // — Africa & Middle East —
  cairo: ['Pyramids of Giza & the Sphinx — the last ancient wonder', 'Egyptian Museum — Tutankhamun’s treasures', 'Khan el-Khalili — historic bazaar', 'Grand Egyptian Museum — vast new pharaonic museum', 'Islamic Cairo & the Citadel — mosques and Saladin’s fortress'],
  marrakech: ['Jemaa el-Fnaa — bustling square of performers and food', 'Bahia Palace — ornate 19th-century palace', 'Majorelle Garden — cobalt-blue botanical retreat', 'Medina & souks — labyrinth of markets', 'Koutoubia Mosque & Saadian Tombs — landmark minaret and royal tombs'],
  'cape town': ['Table Mountain — cable car to the flat-topped summit', 'Cape of Good Hope — dramatic peninsula drive', 'V&A Waterfront & Robben Island — harbour hub and Mandela’s prison', 'Boulders Beach — African penguin colony', 'Kirstenbosch & Bo-Kaap — botanical garden and colourful quarter'],
  nairobi: ['Nairobi National Park — safari on the city’s edge', 'Giraffe Centre — feed endangered Rothschild giraffes', 'Sheldrick Elephant Orphanage — rescued elephant calves', 'Karen Blixen Museum — the Out of Africa farmhouse', 'Bomas of Kenya & National Museum — culture and history'],
  // — Oceania —
  sydney: ['Sydney Opera House — sail-shaped harbour icon', 'Sydney Harbour Bridge — climb or stroll the "Coathanger"', 'Bondi Beach & coastal walk — famous surf beach', 'Darling Harbour & The Rocks — waterfront and historic quarter', 'Taronga Zoo & Blue Mountains — harbour zoo and day-trip peaks'],
  melbourne: ['Federation Square & laneways — arts hub and street art', 'Great Ocean Road — day trip to the Twelve Apostles', 'Queen Victoria Market — historic open-air market', 'Royal Botanic Gardens & MCG — gardens and famous cricket ground', 'St Kilda & NGV — beach suburb and the national gallery'],
  auckland: ['Sky Tower — tallest tower in the Southern Hemisphere', 'Waiheke Island — vineyards and beaches by ferry', 'Auckland Domain & Museum — parkland and Māori collections', 'Mount Eden & Devonport — volcanic cone and seaside village', 'Rangitoto & Piha Beach — volcanic island and black-sand surf'],
  queenstown: ['Skyline Gondola & luge — panoramic ridge over the lake', 'Milford Sound — day trip to the fiord', 'Lake Wakatipu & TSS Earnslaw — cruises on a vintage steamship', 'Bungy & jet boating — adventure-capital thrills', 'Arrowtown & Glenorchy — historic gold town and scenic drives'],
};
// Aliases for name variations returned by geocoders
CITY_ATTRACTIONS['new delhi'] = CITY_ATTRACTIONS.delhi;
CITY_ATTRACTIONS['saigon'] = CITY_ATTRACTIONS['ho chi minh city'];
CITY_ATTRACTIONS['denpasar'] = CITY_ATTRACTIONS['ubud'] = CITY_ATTRACTIONS['kuta'] = CITY_ATTRACTIONS.bali;

const normCity = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/* ISO 639-3 → 639-1 for Google Translate deep links */
const LANG2 = { eng: 'en', jpn: 'ja', kor: 'ko', zho: 'zh-CN', cmn: 'zh-CN', fra: 'fr', spa: 'es', deu: 'de', ita: 'it', por: 'pt', nld: 'nl', tur: 'tr', ara: 'ar', ell: 'el', tha: 'th', vie: 'vi', ind: 'id', msa: 'ms', zsm: 'ms', hin: 'hi', rus: 'ru', pol: 'pl', swe: 'sv', ces: 'cs', dan: 'da', fin: 'fi', nor: 'no', heb: 'he', fas: 'fa', tgl: 'tl', fil: 'tl', ukr: 'uk', swa: 'sw', sin: 'si', nep: 'ne', khm: 'km', lao: 'lo', mya: 'my', ben: 'bn', urd: 'ur', hun: 'hu', ron: 'ro', hrv: 'hr', slk: 'sk', slv: 'sl', bul: 'bg', srp: 'sr', isl: 'is' };

/* Bundled country facts by ISO alpha-2: [currencyCode, primaryLangIso3, capital, displayName].
   Used because restcountries.com is not reachable in some environments. */
const COUNTRY_INFO = {
  SG: ['SGD', 'eng', 'Singapore', 'Singapore'], MY: ['MYR', 'msa', 'Kuala Lumpur', 'Malaysia'],
  TH: ['THB', 'tha', 'Bangkok', 'Thailand'], ID: ['IDR', 'ind', 'Jakarta', 'Indonesia'],
  VN: ['VND', 'vie', 'Hanoi', 'Vietnam'], PH: ['PHP', 'fil', 'Manila', 'Philippines'],
  JP: ['JPY', 'jpn', 'Tokyo', 'Japan'], KR: ['KRW', 'kor', 'Seoul', 'South Korea'],
  CN: ['CNY', 'zho', 'Beijing', 'China'], HK: ['HKD', 'zho', 'Hong Kong', 'Hong Kong'],
  TW: ['TWD', 'zho', 'Taipei', 'Taiwan'], IN: ['INR', 'hin', 'New Delhi', 'India'],
  AE: ['AED', 'ara', 'Abu Dhabi', 'United Arab Emirates'], AU: ['AUD', 'eng', 'Canberra', 'Australia'],
  NZ: ['NZD', 'eng', 'Wellington', 'New Zealand'], GB: ['GBP', 'eng', 'London', 'United Kingdom'],
  FR: ['EUR', 'fra', 'Paris', 'France'], IT: ['EUR', 'ita', 'Rome', 'Italy'],
  ES: ['EUR', 'spa', 'Madrid', 'Spain'], DE: ['EUR', 'deu', 'Berlin', 'Germany'],
  CH: ['CHF', 'deu', 'Bern', 'Switzerland'], NL: ['EUR', 'nld', 'Amsterdam', 'Netherlands'],
  US: ['USD', 'eng', 'Washington, D.C.', 'United States'], TR: ['TRY', 'tur', 'Ankara', 'Turkey'],
  EG: ['EGP', 'ara', 'Cairo', 'Egypt'], GR: ['EUR', 'ell', 'Athens', 'Greece'],
  PT: ['EUR', 'por', 'Lisbon', 'Portugal'], CA: ['CAD', 'eng', 'Ottawa', 'Canada'],
  MX: ['MXN', 'spa', 'Mexico City', 'Mexico'], BR: ['BRL', 'por', 'Brasília', 'Brazil'],
  AR: ['ARS', 'spa', 'Buenos Aires', 'Argentina'], CL: ['CLP', 'spa', 'Santiago', 'Chile'],
  PE: ['PEN', 'spa', 'Lima', 'Peru'], CO: ['COP', 'spa', 'Bogotá', 'Colombia'],
  ZA: ['ZAR', 'eng', 'Pretoria', 'South Africa'], MA: ['MAD', 'ara', 'Rabat', 'Morocco'],
  KE: ['KES', 'eng', 'Nairobi', 'Kenya'], NG: ['NGN', 'eng', 'Abuja', 'Nigeria'],
  RU: ['RUB', 'rus', 'Moscow', 'Russia'], UA: ['UAH', 'ukr', 'Kyiv', 'Ukraine'],
  PL: ['PLN', 'pol', 'Warsaw', 'Poland'], CZ: ['CZK', 'ces', 'Prague', 'Czechia'],
  AT: ['EUR', 'deu', 'Vienna', 'Austria'], BE: ['EUR', 'nld', 'Brussels', 'Belgium'],
  IE: ['EUR', 'eng', 'Dublin', 'Ireland'], SE: ['SEK', 'swe', 'Stockholm', 'Sweden'],
  NO: ['NOK', 'nor', 'Oslo', 'Norway'], DK: ['DKK', 'dan', 'Copenhagen', 'Denmark'],
  FI: ['EUR', 'fin', 'Helsinki', 'Finland'], IS: ['ISK', 'isl', 'Reykjavík', 'Iceland'],
  HU: ['HUF', 'hun', 'Budapest', 'Hungary'], RO: ['RON', 'ron', 'Bucharest', 'Romania'],
  HR: ['EUR', 'hrv', 'Zagreb', 'Croatia'], IL: ['ILS', 'heb', 'Jerusalem', 'Israel'],
  SA: ['SAR', 'ara', 'Riyadh', 'Saudi Arabia'], QA: ['QAR', 'ara', 'Doha', 'Qatar'],
  JO: ['JOD', 'ara', 'Amman', 'Jordan'], LK: ['LKR', 'sin', 'Colombo', 'Sri Lanka'],
  NP: ['NPR', 'nep', 'Kathmandu', 'Nepal'], KH: ['KHR', 'khm', 'Phnom Penh', 'Cambodia'],
  LA: ['LAK', 'lao', 'Vientiane', 'Laos'], MM: ['MMK', 'mya', 'Naypyidaw', 'Myanmar'],
  BD: ['BDT', 'ben', 'Dhaka', 'Bangladesh'], PK: ['PKR', 'urd', 'Islamabad', 'Pakistan'],
  MV: ['MVR', 'div', 'Malé', 'Maldives'], FJ: ['FJD', 'eng', 'Suva', 'Fiji'],
  MO: ['MOP', 'zho', 'Macau', 'Macau'], BN: ['BND', 'msa', 'Bandar Seri Begawan', 'Brunei'],
};

/* Currency symbol + name for display (fallback = code only) */
const CUR_META = {
  SGD: ['S$', 'Singapore Dollar'], USD: ['$', 'US Dollar'], EUR: ['€', 'Euro'], GBP: ['£', 'British Pound'],
  JPY: ['¥', 'Japanese Yen'], CNY: ['¥', 'Chinese Yuan'], HKD: ['HK$', 'Hong Kong Dollar'], TWD: ['NT$', 'New Taiwan Dollar'],
  KRW: ['₩', 'South Korean Won'], THB: ['฿', 'Thai Baht'], MYR: ['RM', 'Malaysian Ringgit'], IDR: ['Rp', 'Indonesian Rupiah'],
  VND: ['₫', 'Vietnamese Dong'], PHP: ['₱', 'Philippine Peso'], INR: ['₹', 'Indian Rupee'], AED: ['', 'UAE Dirham'],
  AUD: ['A$', 'Australian Dollar'], NZD: ['NZ$', 'New Zealand Dollar'], CHF: ['', 'Swiss Franc'], TRY: ['₺', 'Turkish Lira'],
  EGP: ['E£', 'Egyptian Pound'], CAD: ['C$', 'Canadian Dollar'], MXN: ['$', 'Mexican Peso'], BRL: ['R$', 'Brazilian Real'],
  ARS: ['$', 'Argentine Peso'], CLP: ['$', 'Chilean Peso'], PEN: ['S/', 'Peruvian Sol'], COP: ['$', 'Colombian Peso'],
  ZAR: ['R', 'South African Rand'], MAD: ['', 'Moroccan Dirham'], KES: ['KSh', 'Kenyan Shilling'], NGN: ['₦', 'Nigerian Naira'],
  RUB: ['₽', 'Russian Ruble'], UAH: ['₴', 'Ukrainian Hryvnia'], PLN: ['zł', 'Polish Złoty'], CZK: ['Kč', 'Czech Koruna'],
  SEK: ['kr', 'Swedish Krona'], NOK: ['kr', 'Norwegian Krone'], DKK: ['kr', 'Danish Krone'], ISK: ['kr', 'Icelandic Króna'],
  HUF: ['Ft', 'Hungarian Forint'], RON: ['lei', 'Romanian Leu'], ILS: ['₪', 'Israeli Shekel'], SAR: ['', 'Saudi Riyal'],
  QAR: ['', 'Qatari Riyal'], JOD: ['', 'Jordanian Dinar'], LKR: ['Rs', 'Sri Lankan Rupee'], NPR: ['Rs', 'Nepalese Rupee'],
  KHR: ['៛', 'Cambodian Riel'], LAK: ['₭', 'Lao Kip'], MMK: ['K', 'Myanmar Kyat'], BDT: ['৳', 'Bangladeshi Taka'],
  PKR: ['Rs', 'Pakistani Rupee'], MVR: ['', 'Maldivian Rufiyaa'], FJD: ['FJ$', 'Fijian Dollar'], MOP: ['MOP$', 'Macanese Pataca'],
  BND: ['B$', 'Brunei Dollar'],
};

/* Emergency numbers by ISO alpha-2 — "Label Number · Label Number" (rendered as chips) */
const EMERGENCY = {
  SG: 'Police 999 · Ambulance/Fire 995', MY: 'Emergency 999', TH: 'Tourist Police 1155 · Police 191 · Ambulance 1669',
  ID: 'Emergency 112 · Police 110 · Ambulance 118', VN: 'Police 113 · Ambulance 115 · Fire 114', PH: 'Emergency 911',
  JP: 'Police 110 · Ambulance/Fire 119', KR: 'Police 112 · Ambulance/Fire 119', CN: 'Police 110 · Ambulance 120 · Fire 119',
  HK: 'Emergency 999', TW: 'Police 110 · Ambulance/Fire 119', IN: 'Emergency 112 · Police 100 · Ambulance 102',
  AE: 'Police 999 · Ambulance 998 · Fire 997', AU: 'Emergency 000', NZ: 'Emergency 111', GB: 'Emergency 999 (or 112)',
  FR: 'Emergency 112 · Police 17 · Ambulance 15', IT: 'Emergency 112', ES: 'Emergency 112', DE: 'Emergency 112 · Police 110',
  CH: 'Emergency 112 · Police 117 · Ambulance 144', NL: 'Emergency 112', US: 'Emergency 911', TR: 'Emergency 112',
  EG: 'Police 122 · Ambulance 123 · Tourist Police 126', GR: 'Emergency 112', PT: 'Emergency 112', CA: 'Emergency 911',
  MX: 'Emergency 911', BR: 'Police 190 · Ambulance 192 · Fire 193', AR: 'Emergency 911 · Police 101', CL: 'Police 133 · Ambulance 131',
  PE: 'Emergency 105 · Ambulance 106', CO: 'Emergency 123', ZA: 'Police 10111 · Ambulance 10177', MA: 'Police 19 · Ambulance 15',
  KE: 'Emergency 999 (or 112)', NG: 'Emergency 112', RU: 'Emergency 112', UA: 'Emergency 112', PL: 'Emergency 112',
  CZ: 'Emergency 112', AT: 'Emergency 112', BE: 'Emergency 112', IE: 'Emergency 112 (or 999)', SE: 'Emergency 112',
  NO: 'Police 112 · Ambulance 113 · Fire 110', DK: 'Emergency 112', FI: 'Emergency 112', IS: 'Emergency 112',
  HU: 'Emergency 112', RO: 'Emergency 112', HR: 'Emergency 112', IL: 'Police 100 · Ambulance 101 · Fire 102',
  SA: 'Police 999 · Ambulance 997 · Fire 998', QA: 'Emergency 999', JO: 'Emergency 911', LK: 'Police 119 · Ambulance 110',
  NP: 'Police 100 · Ambulance 102', KH: 'Police 117 · Ambulance 119 · Fire 118', LA: 'Police 191 · Ambulance 195',
  MM: 'Emergency 999', BD: 'Emergency 999', PK: 'Police 15 · Ambulance 1122', MV: 'Police 119 · Ambulance 102',
  FJ: 'Emergency 911 · Police 917', MO: 'Emergency 999', BN: 'Police 993 · Ambulance 991 · Fire 995',
};

/* Reverse index: lowercased country name → alpha-2, for when a saved place lacks a code */
const NAME_TO_CC = {};
for (const [cc, info] of Object.entries(COUNTRY_INFO)) NAME_TO_CC[info[3].toLowerCase()] = cc;
Object.assign(NAME_TO_CC, { 'united states of america': 'US', usa: 'US', uk: 'GB', 'great britain': 'GB', 'south korea': 'KR', 'republic of korea': 'KR', 'united arab emirates': 'AE', czechia: 'CZ', 'czech republic': 'CZ' });

const enc = encodeURIComponent;
let ratesCache = null;
let travelToken = 0;
let convRate = null;      // base → destination rate for the live converter (null = none)
let convBase = 'SGD';     // user-chosen base currency (must differ from destination)
let lastCurCode = null;   // destination currency of the current view
let lastRates = null;     // last fetched SGD-based rate table
const CURRENCY_LIST = Object.keys(CUR_META); // selectable base currencies (have symbol/name)

function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '🏳️';
  return cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

async function fetchRates() {
  if (ratesCache) return ratesCache;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/SGD');
    const j = await r.json();
    ratesCache = j.rates || null;
    return ratesCache;
  } catch { return null; }
}

function tvCard(title, inner, cls = '') {
  return `<div class="tv-card ${cls}"><div class="tv-card-title">${title}</div>${inner}</div>`;
}
const fmtMoney = (n) => (n < 1 ? n.toFixed(4) : n.toFixed(2));
const fmtAmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

function currencyBlock(code, rates) {
  convRate = null; lastCurCode = code; lastRates = rates;
  if (!code) return tvCard('Currency', '<div class="tv-muted">Currency data unavailable for this destination.</div>');
  const name = (CUR_META[code] || ['', code])[1];
  if (!rates || !rates[code]) return tvCard(`Currency · ${code}`, `<div class="tv-muted">Live rate for ${name} (${code}) is unavailable right now.</div>`);
  return tvCard(`Currency · ${code}`, `<div id="curDyn">${currencyInner(code, rates)}</div>`);
}

/* Inner currency UI — re-rendered when the user picks a different base currency */
function currencyInner(code, rates) {
  // Base must differ from the destination currency; default to SGD, else USD/EUR.
  let base = convBase;
  if (base === code || !rates[base]) base = code === 'USD' ? 'EUR' : 'USD';
  convBase = base;
  const rate = rates[code] / rates[base]; // 1 base = rate × destination
  convRate = rate;
  const [dSym, dName] = CUR_META[code] || ['', code];
  const [bSym] = CUR_META[base] || ['', base];
  const options = CURRENCY_LIST
    .filter((cur) => cur !== code && rates[cur])
    .map((cur) => `<option value="${cur}"${cur === base ? ' selected' : ''}>${cur} · ${(CUR_META[cur] || ['', cur])[1]}</option>`)
    .join('');
  return `
    <div class="cur-base-row">
      <label class="cur-base-label" for="curBaseSelect">Convert from</label>
      <select class="cur-base-select" id="curBaseSelect" aria-label="Base currency">${options}</select>
    </div>
    <div class="cur-row"><span class="cur-big">1 ${base}</span><span class="cur-eq">=</span><span class="cur-big">${dSym}${fmtMoney(rate)} ${code}</span></div>
    <div class="cur-sub">1 ${code} = ${bSym}${fmtMoney(1 / rate)} ${base} · ${dName}</div>
    <div class="cur-convert">
      <label class="cur-field"><span class="cur-fc">${base}</span><input type="number" id="convBaseAmt" min="0" inputmode="decimal" value="1"></label>
      <span class="cur-swap">⇄</span>
      <label class="cur-field"><span class="cur-fc">${code}</span><input type="number" id="convDestAmt" min="0" inputmode="decimal" value="${fmtMoney(rate)}"></label>
    </div>
    <div class="cur-note">Live mid-market cross-rate · type any amount</div>`;
}

function emergencyBlock(cc) {
  const line = EMERGENCY[cc];
  if (!line) return tvCard('Emergency', '<div class="tv-muted">Dial the local emergency number on arrival — 112 works in many countries.</div>');
  const chips = line.split(' · ').map((part) => {
    const m = part.match(/^(.*?)(\d[\d/]*)$/);
    const label = m ? m[1].trim() : part;
    const num = m ? m[2] : '';
    return `<div class="emg-chip"><span class="emg-label">${label}</span><span class="emg-num">${num}</span></div>`;
  }).join('');
  return tvCard('Emergency numbers', `<div class="emg-chips">${chips}</div>`);
}

/* Visa requirements for SINGAPORE passport holders, by ISO alpha-2: [type, stayLimit, note].
   type: free | eta | evisa | arrival | required | home. Curated — always confirm officially. */
const VISA = {
  SG: ['home', '', ''],
  MY: ['free', '30 days', 'ASEAN — visa-free entry'], TH: ['free', '30 days', 'Visa-exemption on arrival'],
  ID: ['free', '30 days', 'ASEAN visa-free'], VN: ['free', '30 days', 'ASEAN visa-free'],
  PH: ['free', '30 days', 'ASEAN visa-free'], BN: ['free', '30 days', 'ASEAN visa-free'],
  KH: ['free', '30 days', 'ASEAN visa-free'], LA: ['free', '30 days', 'ASEAN visa-free'],
  MM: ['free', '30 days', 'ASEAN visa-free'],
  JP: ['free', '90 days', ''], KR: ['free', '90 days', 'K-ETA may be required — check before travel'],
  CN: ['free', '30 days', '30-day visa-free (current policy)'], HK: ['free', '90 days', ''],
  MO: ['free', '30 days', ''], TW: ['free', '30 days', ''],
  IN: ['evisa', 'per eVisa', 'Apply for an e-Visa online before travel'],
  AE: ['free', '30 days', 'Free visa-on-arrival stamp'], QA: ['free', '30 days', ''],
  SA: ['evisa', 'per eVisa', 'Tourist eVisa / visa on arrival available'],
  JO: ['arrival', '30 days', 'Visa on arrival, or the Jordan Pass'],
  IL: ['free', '90 days', ''], TR: ['free', '90 days', ''],
  LK: ['eta', '30 days', 'Electronic Travel Authorisation (ETA) required'],
  NP: ['arrival', '90 days', 'Visa on arrival'], BD: ['arrival', 'per visa', 'Visa on arrival for tourists'],
  PK: ['evisa', 'per eVisa', 'Apply for an e-Visa before travel'],
  MV: ['arrival', '30 days', 'Free visa on arrival'],
  GB: ['free', '6 months', ''], IE: ['free', '90 days', ''],
  FR: ['free', '90 days', 'Schengen — 90 days in any 180'], IT: ['free', '90 days', 'Schengen — 90 days in any 180'],
  ES: ['free', '90 days', 'Schengen — 90 days in any 180'], DE: ['free', '90 days', 'Schengen — 90 days in any 180'],
  CH: ['free', '90 days', 'Schengen — 90 days in any 180'], NL: ['free', '90 days', 'Schengen — 90 days in any 180'],
  AT: ['free', '90 days', 'Schengen — 90 days in any 180'], BE: ['free', '90 days', 'Schengen — 90 days in any 180'],
  GR: ['free', '90 days', 'Schengen — 90 days in any 180'], PT: ['free', '90 days', 'Schengen — 90 days in any 180'],
  PL: ['free', '90 days', 'Schengen — 90 days in any 180'], CZ: ['free', '90 days', 'Schengen — 90 days in any 180'],
  HU: ['free', '90 days', 'Schengen — 90 days in any 180'], HR: ['free', '90 days', 'Schengen — 90 days in any 180'],
  SE: ['free', '90 days', 'Schengen — 90 days in any 180'], NO: ['free', '90 days', 'Schengen — 90 days in any 180'],
  DK: ['free', '90 days', 'Schengen — 90 days in any 180'], FI: ['free', '90 days', 'Schengen — 90 days in any 180'],
  IS: ['free', '90 days', 'Schengen — 90 days in any 180'], RO: ['free', '90 days', 'Schengen — 90 days in any 180'],
  RU: ['evisa', 'per eVisa', 'Unified e-Visa — apply online'], UA: ['free', '90 days', 'Check safety advisories before travel'],
  US: ['eta', '90 days', 'ESTA under the Visa Waiver Program'], CA: ['eta', '6 months', 'eTA — apply online before travel'],
  MX: ['free', '180 days', ''], BR: ['free', '90 days', ''], AR: ['free', '90 days', ''],
  CL: ['free', '90 days', ''], PE: ['free', '183 days', ''], CO: ['free', '90 days', ''],
  AU: ['eta', '90 days', 'ETA (subclass 601) — apply online'], NZ: ['eta', '3 months', 'NZeTA — apply online before travel'],
  ZA: ['free', '90 days', ''], MA: ['free', '90 days', ''],
  EG: ['arrival', '30 days', 'Visa on arrival, or e-Visa'], KE: ['eta', 'per eTA', 'Electronic Travel Authorisation required'],
  NG: ['evisa', 'per visa', 'Visa required — apply (e-Visa) before travel'],
  FJ: ['free', '4 months', ''],
};
const VISA_META = {
  free: ['Visa-free', 'v-free'], eta: ['ETA / authorisation', 'v-eta'], evisa: ['eVisa required', 'v-eta'],
  arrival: ['Visa on arrival', 'v-eta'], required: ['Visa required', 'v-req'],
};
function visaBlock(cc, countryName) {
  const link = `https://www.google.com/search?q=${enc('Singapore passport visa requirements ' + countryName)}`;
  const v = VISA[cc];
  if (v && v[0] === 'home') return tvCard('Visa · SG passport', '<div class="tv-muted">🇸🇬 Home country — no visa needed.</div>');
  if (!v) {
    return tvCard('Visa · SG passport', `<div class="tv-muted">Visa rules for ${countryName} aren’t curated yet.</div>
      <a class="tv-inline-link" target="_blank" rel="noopener" href="${link}">Check visa requirements →</a>`);
  }
  const [type, days, note] = v;
  const [label, cls] = VISA_META[type] || ['Check requirements', 'v-eta'];
  return tvCard('Visa · SG passport', `
    <div class="visa-status"><span class="visa-badge ${cls}">${label}</span>${days && /\d/.test(days) ? `<span class="visa-days">Up to ${days}</span>` : ''}</div>
    ${note ? `<div class="visa-note">${note}</div>` : ''}
    <div class="visa-disclaimer">For 🇸🇬 Singapore passport holders · always confirm with the embassy — rules change.</div>
    <a class="tv-inline-link" target="_blank" rel="noopener" href="${link}">Official visa details →</a>`);
}

const attrEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
function attractionsList(list, context) {
  const items = list.map((a, i) => {
    const [n, d] = a.split(' — ');
    return `<li class="tv-attraction" data-name="${attrEsc(n)}" data-context="${attrEsc(context || '')}" role="button" tabindex="0" title="Show ${attrEsc(n)} on the map">
      <span class="tv-rank">${i + 1}</span>
      <div><div class="tv-a-name">${n} <span class="tv-a-pin">📍</span></div>${d ? `<div class="tv-a-desc">${d}</div>` : ''}</div>
    </li>`;
  }).join('');
  return `<ol class="tv-attractions">${items}</ol>`;
}
function wikivoyageLink(place) {
  return `<a class="tv-inline-link" target="_blank" rel="noopener" href="https://en.wikivoyage.org/wiki/${enc(place.replace(/ /g, '_'))}">Explore ${place} on Wikivoyage →</a>`;
}
function attractionsBlock(cityName, cc, countryName) {
  const cityList = CITY_ATTRACTIONS[normCity(cityName)];
  if (cityList) return tvCard(`Top 5 attractions · ${cityName}`, attractionsList(cityList, cityName));
  // City not found → default to the country's capital city.
  const capital = (COUNTRY_INFO[cc]?.[2] || '').split(',')[0].trim();
  const capList = capital && CITY_ATTRACTIONS[normCity(capital)];
  if (capList) {
    return tvCard(`Top 5 attractions · ${capital}`,
      attractionsList(capList, capital) +
      `<div class="tv-fallback-note">No picks for ${cityName} yet — showing the capital, ${capital}.</div>`);
  }
  // Last resort: country highlights, then a guide link.
  const countryList = TRAVEL_DATA[cc]?.attractions;
  if (countryList) {
    return tvCard(`Top attractions · ${countryName}`,
      attractionsList(countryList, countryName) +
      `<div class="tv-fallback-note">No picks for ${cityName || countryName} yet — showing country highlights.</div>` +
      wikivoyageLink(cityName || countryName));
  }
  return tvCard('Top attractions', `<div class="tv-muted">No curated picks for ${cityName || countryName} yet.</div>${wikivoyageLink(cityName || countryName)}`);
}

function risksBlock(cc) {
  const list = TRAVEL_DATA[cc]?.risks || [
    'Check your government’s travel advisory before departure.',
    'Get comprehensive travel insurance covering health and cancellations.',
    'Keep digital and paper copies of your passport and emergency contacts.',
  ];
  return tvCard('Key risks & safety', `<ul class="tv-risks">${list.map((r) => `<li>${r}</li>`).join('')}</ul>`);
}

function linksBlock(countryName, langIso3) {
  const slug = countryName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const q = enc(countryName);
  const wiki = enc(countryName.replace(/ /g, '_'));
  const lang = LANG2[langIso3] || '';
  const links = [
    ['Safety', 'Travel advisory (UK FCDO)', `https://www.gov.uk/foreign-travel-advice/${slug}`, '🛡️'],
    ['Safety', 'Register trip · MFA Singapore', 'https://eregister.mfa.gov.sg/', '🇸🇬'],
    ['Stay', 'Hotels · Booking.com', `https://www.booking.com/searchresults.html?ss=${q}`, '🏨'],
    ['Stay', 'Homes · Airbnb', `https://www.airbnb.com/s/${q}/homes`, '🛏️'],
    ['Language', lang ? 'Translate to local language' : 'Google Translate', lang ? `https://translate.google.com/?sl=auto&tl=${lang}` : 'https://translate.google.com/', '💬'],
    ['Guide', 'Wikivoyage travel guide', `https://en.wikivoyage.org/wiki/${wiki}`, '🧭'],
  ];
  const items = links.map(([tag, label, href, ic]) => `
    <a class="tv-link" href="${href}" target="_blank" rel="noopener">
      <span class="tv-link-ic">${ic}</span>
      <span class="tv-link-text"><span class="tv-link-tag">${tag}</span><span class="tv-link-label">${label}</span></span>
      <span class="tv-link-arrow">→</span>
    </a>`).join('');
  return `<div class="tv-links">${items}</div>`;
}

/* Essential links live in their own section at the end of the page */
function renderLinks(place) {
  let cc = (place.cc || '').toUpperCase();
  if (!COUNTRY_INFO[cc] && place.country) cc = NAME_TO_CC[place.country.toLowerCase()] || cc;
  const info = COUNTRY_INFO[cc];
  const countryName = info?.[3] || place.country || place.name || 'this destination';
  el.linksBody.innerHTML = linksBlock(countryName, info?.[1] || '');
}

async function renderTravel(place) {
  const token = ++travelToken;
  el.travelBody.innerHTML = '<div class="travel-loading"><div class="spinner"></div><p>Loading travel info…</p></div>';
  el.travelCountry.textContent = '';
  el.travelSub.textContent = `Travelling to ${place.country || place.name}`;

  // Resolve the country: prefer the ISO code, fall back to matching the name.
  let cc = (place.cc || '').toUpperCase();
  if (!COUNTRY_INFO[cc] && place.country) cc = NAME_TO_CC[place.country.toLowerCase()] || cc;
  const info = COUNTRY_INFO[cc];
  const countryName = info?.[3] || place.country || place.name || 'this destination';
  const curCode = info?.[0];
  const langIso3 = info?.[1] || '';
  const capital = info?.[2];

  el.travelCountry.textContent = `${flagEmoji(cc)} ${countryName}`;
  el.travelSub.textContent = capital ? `Capital: ${capital}` : `Travelling to ${countryName}`;

  const rates = await fetchRates();
  if (token !== travelToken) return;

  el.travelBody.innerHTML =
    currencyBlock(curCode, rates) +
    visaBlock(cc, countryName) +
    attractionsBlock(place.name, cc, countryName) +
    risksBlock(cc) +
    emergencyBlock(cc);
}

/* Click an attraction → geocode it (OpenStreetMap Nominatim) and pin it on the map */
async function showAttractionOnMap(name, context) {
  if (!name) return;
  toast(`Locating ${name}…`);
  const query = `${name.replace(/\s*\(.*?\)\s*/g, ' ').trim()}${context ? `, ${context}` : ''}`;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${enc(query)}&format=json&limit=1`);
    const j = await r.json();
    if (!j.length) { toast(`Couldn't find ${name} on the map`); return; }
    placeAttractionMarker(parseFloat(j[0].lat), parseFloat(j[0].lon), name);
  } catch { toast(`Couldn't load ${name} location`); }
}
function placeAttractionMarker(lat, lon, name) {
  if (!state.map) return;
  if (state.attractionMarker) state.map.removeLayer(state.attractionMarker);
  const ic = L.divIcon({ className: '', html: '<div class="attraction-marker"></div>', iconSize: [28, 28], iconAnchor: [14, 28] });
  state.attractionMarker = L.marker([lat, lon], { icon: ic, zIndexOffset: 1000 }).addTo(state.map)
    .bindPopup(`<b>${name}</b>`, { closeButton: false });
  document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  state.map.invalidateSize();
  state.map.setView([lat, lon], 15, { animate: true });
  state.attractionMarker.openPopup();
}
el.travelBody.addEventListener('click', (e) => {
  const li = e.target.closest('.tv-attraction');
  if (li) showAttractionOnMap(li.dataset.name, li.dataset.context);
});
el.travelBody.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const li = e.target.closest('.tv-attraction');
  if (li) { e.preventDefault(); showAttractionOnMap(li.dataset.name, li.dataset.context); }
});

/* Live currency converter — delegated so it survives travel-section re-renders */
el.travelBody.addEventListener('input', (e) => {
  if (!convRate) return;
  const b = document.getElementById('convBaseAmt');
  const d = document.getElementById('convDestAmt');
  if (!b || !d) return;
  if (e.target === b) {
    const v = parseFloat(b.value);
    d.value = b.value === '' || isNaN(v) ? '' : fmtMoney(v * convRate);
  } else if (e.target === d) {
    const v = parseFloat(d.value);
    b.value = d.value === '' || isNaN(v) ? '' : fmtMoney(v / convRate);
  }
});
/* Base-currency selector — re-render just the currency card with the chosen currency */
el.travelBody.addEventListener('change', (e) => {
  if (e.target.id !== 'curBaseSelect') return;
  convBase = e.target.value;
  const dyn = document.getElementById('curDyn');
  if (dyn && lastCurCode && lastRates) dyn.innerHTML = currencyInner(lastCurCode, lastRates);
});

/* ============================================================
   EVENTS — curated annual festivals/events by city, with
   approximate date ranges (many vary yearly). Flags current
   vs upcoming and shows the next occurrence.
   ============================================================ */
const EVENTS = {
  singapore: [
    { name: 'Chinese New Year', sm: 2, sd: 17, em: 2, ed: 23, vary: true, desc: 'Chinatown light-up, lion dances & River Hongbao' },
    { name: 'National Day Parade', sm: 8, sd: 9, em: 8, ed: 9, desc: 'Fireworks & parade over Marina Bay' },
    { name: 'F1 Singapore Grand Prix', sm: 10, sd: 2, em: 10, ed: 4, desc: 'Marina Bay night street race & concerts' },
    { name: 'Deepavali · Little India', sm: 11, sd: 1, em: 11, ed: 14, vary: true, desc: 'Festival of Lights street light-up' } ],
  tokyo: [
    { name: 'Cherry Blossom (Hanami)', sm: 3, sd: 25, em: 4, ed: 10, vary: true, desc: 'Sakura in Ueno Park & Shinjuku Gyoen' },
    { name: 'Sanja Matsuri', sm: 5, sd: 16, em: 5, ed: 18, desc: 'Asakusa’s wild portable-shrine festival' },
    { name: 'Sumida River Fireworks', sm: 7, sd: 25, em: 7, ed: 25, vary: true, desc: 'Huge summer hanabi display' } ],
  kyoto: [
    { name: 'Gion Matsuri', sm: 7, sd: 1, em: 7, ed: 31, desc: 'Japan’s most famous festival; grand float parades' },
    { name: 'Cherry Blossom', sm: 3, sd: 28, em: 4, ed: 12, vary: true, desc: 'Philosopher’s Path & Maruyama Park' },
    { name: 'Aoi Matsuri', sm: 5, sd: 15, em: 5, ed: 15, desc: 'Heian-era imperial procession' } ],
  osaka: [
    { name: 'Tenjin Matsuri', sm: 7, sd: 24, em: 7, ed: 25, desc: 'Land & river processions plus fireworks' },
    { name: 'Cherry Blossom (Osaka Castle)', sm: 3, sd: 27, em: 4, ed: 10, vary: true, desc: 'Sakura around the castle park' } ],
  seoul: [
    { name: 'Cherry Blossom (Yeouido)', sm: 4, sd: 5, em: 4, ed: 12, vary: true, desc: 'Blossoms along the Han River' },
    { name: 'Lotus Lantern Festival', sm: 5, sd: 15, em: 5, ed: 17, vary: true, desc: 'Buddha’s Birthday lantern parade' },
    { name: 'Seoul Lantern Festival', sm: 11, sd: 1, em: 11, ed: 17, desc: 'Cheonggyecheon stream light displays' } ],
  'hong kong': [
    { name: 'Chinese New Year Parade', sm: 2, sd: 17, em: 2, ed: 19, vary: true, desc: 'TST parade & Victoria Harbour fireworks' },
    { name: 'Cheung Chau Bun Festival', sm: 5, sd: 5, em: 5, ed: 5, vary: true, desc: 'Bun towers & floating-children parade' },
    { name: 'Mid-Autumn Fire Dragon (Tai Hang)', sm: 9, sd: 15, em: 9, ed: 17, vary: true, desc: 'Fire-dragon dance through the streets' } ],
  taipei: [
    { name: 'Lantern Festival', sm: 2, sd: 24, em: 3, ed: 3, vary: true, desc: 'City lanterns; nearby Pingxi sky lanterns' },
    { name: 'NYE Fireworks (Taipei 101)', sm: 12, sd: 31, em: 12, ed: 31, desc: 'Famous tower firework show' } ],
  bangkok: [
    { name: 'Songkran (Thai New Year)', sm: 4, sd: 13, em: 4, ed: 15, desc: 'Nationwide water-fight festival' },
    { name: 'Loy Krathong', sm: 11, sd: 5, em: 11, ed: 5, vary: true, desc: 'Floating candle-lit krathongs on the rivers' } ],
  'kuala lumpur': [
    { name: 'Thaipusam (Batu Caves)', sm: 1, sd: 24, em: 1, ed: 25, vary: true, desc: 'Kavadi procession to Batu Caves' },
    { name: 'Merdeka (National Day)', sm: 8, sd: 31, em: 8, ed: 31, desc: 'Independence Day parades' },
    { name: 'Deepavali', sm: 11, sd: 1, em: 11, ed: 14, vary: true, desc: 'Festival of Lights celebrations' } ],
  bali: [
    { name: 'Nyepi (Day of Silence)', sm: 3, sd: 29, em: 3, ed: 29, vary: true, desc: 'Ogoh-ogoh parades, then island-wide silence' },
    { name: 'Bali Arts Festival', sm: 6, sd: 14, em: 7, ed: 12, desc: 'Month-long Balinese arts in Denpasar' } ],
  mumbai: [
    { name: 'Ganesh Chaturthi', sm: 8, sd: 27, em: 9, ed: 6, vary: true, desc: 'Giant Ganesha immersions along the coast' },
    { name: 'Diwali', sm: 11, sd: 8, em: 11, ed: 12, vary: true, desc: 'Festival of Lights; fireworks & sweets' },
    { name: 'Kala Ghoda Arts Festival', sm: 2, sd: 1, em: 2, ed: 9, desc: 'Street art & culture festival' } ],
  pune: [
    { name: 'Ganesh Chaturthi', sm: 8, sd: 27, em: 9, ed: 6, vary: true, desc: 'Pune’s grandest festival — processions & pandals' },
    { name: 'Pune International Film Festival', sm: 1, sd: 9, em: 1, ed: 16, desc: 'PIFF — world & Marathi cinema' },
    { name: 'Sawai Gandharva Bhimsen Festival', sm: 12, sd: 11, em: 12, ed: 13, vary: true, desc: 'Renowned Indian classical music festival' },
    { name: 'Diwali', sm: 11, sd: 8, em: 11, ed: 12, vary: true, desc: 'Festival of Lights' } ],
  shanghai: [
    { name: 'Chinese New Year (Yu Garden Lanterns)', sm: 2, sd: 17, em: 2, ed: 24, vary: true, desc: 'Lantern displays & festivities at Yu Garden' },
    { name: 'F1 Chinese Grand Prix', sm: 4, sd: 18, em: 4, ed: 20, vary: true, desc: 'Formula 1 at the Shanghai International Circuit' },
    { name: 'Shanghai International Film Festival', sm: 6, sd: 14, em: 6, ed: 23, desc: 'Major Asian film festival (SIFF)' },
    { name: 'Mid-Autumn Festival', sm: 9, sd: 15, em: 9, ed: 17, vary: true, desc: 'Mooncakes & lantern celebrations' } ],
  delhi: [
    { name: 'Republic Day Parade', sm: 1, sd: 26, em: 1, ed: 26, desc: 'Grand parade on Kartavya Path' },
    { name: 'Holi', sm: 3, sd: 14, em: 3, ed: 14, vary: true, desc: 'Festival of colours' },
    { name: 'Diwali', sm: 11, sd: 8, em: 11, ed: 12, vary: true, desc: 'Festival of Lights' } ],
  dubai: [
    { name: 'Dubai Shopping Festival', sm: 12, sd: 15, em: 1, ed: 29, desc: 'Sales, fireworks & entertainment citywide' },
    { name: 'UAE National Day', sm: 12, sd: 2, em: 12, ed: 3, desc: 'Union Day celebrations & shows' } ],
  london: [
    { name: 'Wimbledon', sm: 6, sd: 29, em: 7, ed: 12, desc: 'The Championships tennis' },
    { name: 'Notting Hill Carnival', sm: 8, sd: 24, em: 8, ed: 25, desc: 'Europe’s biggest street carnival' },
    { name: 'Winter Wonderland', sm: 11, sd: 21, em: 1, ed: 4, desc: 'Hyde Park Christmas fair' },
    { name: 'NYE Fireworks', sm: 12, sd: 31, em: 12, ed: 31, desc: 'London Eye fireworks over the Thames' } ],
  paris: [
    { name: 'Fête de la Musique', sm: 6, sd: 21, em: 6, ed: 21, desc: 'City-wide free music day' },
    { name: 'Bastille Day', sm: 7, sd: 14, em: 7, ed: 14, desc: 'Parade & Eiffel Tower fireworks' },
    { name: 'Paris Fashion Week', sm: 9, sd: 29, em: 10, ed: 7, desc: 'Ready-to-wear runway shows' } ],
  rome: [
    { name: 'Natale di Roma', sm: 4, sd: 21, em: 4, ed: 21, desc: 'Rome’s birthday; historical parades' },
    { name: 'Estate Romana', sm: 6, sd: 1, em: 9, ed: 1, desc: 'Summer-long open-air arts & film' } ],
  milan: [
    { name: 'Salone del Mobile (Design Week)', sm: 4, sd: 14, em: 4, ed: 19, desc: 'Global furniture & design fair' },
    { name: 'Milan Fashion Week', sm: 9, sd: 22, em: 9, ed: 28, desc: 'World-famous runway shows' } ],
  barcelona: [
    { name: 'Sant Jordi', sm: 4, sd: 23, em: 4, ed: 23, desc: 'Books & roses across the city' },
    { name: 'Primavera Sound', sm: 5, sd: 28, em: 6, ed: 1, desc: 'Major international music festival' },
    { name: 'La Mercè', sm: 9, sd: 20, em: 9, ed: 24, desc: 'City festival; castellers & correffoc' } ],
  madrid: [
    { name: 'San Isidro', sm: 5, sd: 8, em: 5, ed: 15, desc: 'Madrid’s patron-saint fiesta' },
    { name: 'Pride (Orgullo)', sm: 6, sd: 28, em: 7, ed: 6, desc: 'One of the world’s biggest Pride events' } ],
  munich: [
    { name: 'Oktoberfest', sm: 9, sd: 20, em: 10, ed: 5, desc: 'The world’s largest beer festival' },
    { name: 'Christkindlmarkt', sm: 11, sd: 24, em: 12, ed: 24, desc: 'Marienplatz Christmas market' } ],
  amsterdam: [
    { name: 'King’s Day', sm: 4, sd: 27, em: 4, ed: 27, desc: 'Orange-clad citywide street party' },
    { name: 'Amsterdam Light Festival', sm: 11, sd: 28, em: 1, ed: 19, desc: 'Canal-side illuminated art' } ],
  'new york': [
    { name: 'US Open (Tennis)', sm: 8, sd: 25, em: 9, ed: 7, desc: 'Grand Slam in Flushing Meadows' },
    { name: 'Macy’s Thanksgiving Parade', sm: 11, sd: 27, em: 11, ed: 27, vary: true, desc: 'Giant balloons through Manhattan' },
    { name: 'NYE Times Square Ball Drop', sm: 12, sd: 31, em: 12, ed: 31, desc: 'Iconic New Year countdown' } ],
  'los angeles': [
    { name: 'Rose Parade (Pasadena)', sm: 1, sd: 1, em: 1, ed: 1, desc: 'New Year floral parade' },
    { name: 'The Oscars', sm: 3, sd: 15, em: 3, ed: 15, vary: true, desc: 'Academy Awards, Hollywood' } ],
  'san francisco': [
    { name: 'SF Pride', sm: 6, sd: 28, em: 6, ed: 29, desc: 'Huge Pride parade & festival' },
    { name: 'Outside Lands', sm: 8, sd: 8, em: 8, ed: 10, desc: 'Golden Gate Park music festival' } ],
  chicago: [
    { name: "St. Patrick's Day River Dyeing", sm: 3, sd: 15, em: 3, ed: 15, vary: true, desc: 'The Chicago River is dyed green downtown' },
    { name: 'Lollapalooza', sm: 8, sd: 1, em: 8, ed: 4, desc: 'Huge music festival in Grant Park' },
    { name: 'Chicago Air & Water Show', sm: 8, sd: 16, em: 8, ed: 17, desc: 'Free lakefront aerial show' },
    { name: 'Christkindlmarket', sm: 11, sd: 21, em: 12, ed: 24, desc: 'German-style Christmas market at Daley Plaza' } ],
  atlanta: [
    { name: 'Atlanta Dogwood Festival', sm: 4, sd: 11, em: 4, ed: 13, vary: true, desc: 'Arts festival in Piedmont Park' },
    { name: 'Atlanta Jazz Festival', sm: 5, sd: 24, em: 5, ed: 26, vary: true, desc: 'Free Memorial-Day-weekend jazz in Piedmont Park' },
    { name: 'Peachtree Road Race', sm: 7, sd: 4, em: 7, ed: 4, desc: 'The world’s largest 10K, every July 4th' },
    { name: 'Music Midtown', sm: 9, sd: 19, em: 9, ed: 20, vary: true, desc: 'Major music festival in Piedmont Park' } ],
  'las vegas': [
    { name: 'Las Vegas Grand Prix (F1)', sm: 11, sd: 20, em: 11, ed: 22, desc: 'Formula 1 night race down the Strip' },
    { name: 'EDC (Electric Daisy Carnival)', sm: 5, sd: 16, em: 5, ed: 18, vary: true, desc: 'Massive electronic-music festival' },
    { name: 'Life is Beautiful', sm: 9, sd: 19, em: 9, ed: 21, desc: 'Downtown music, art & food festival' },
    { name: 'NYE on the Strip', sm: 12, sd: 31, em: 12, ed: 31, desc: 'Fireworks along Las Vegas Boulevard' } ],
  sydney: [
    { name: 'Sydney Mardi Gras', sm: 2, sd: 15, em: 3, ed: 2, desc: 'Iconic LGBTQ+ parade & festival' },
    { name: 'Vivid Sydney', sm: 5, sd: 23, em: 6, ed: 14, desc: 'Festival of light, music & ideas' },
    { name: 'NYE Harbour Fireworks', sm: 12, sd: 31, em: 12, ed: 31, desc: 'World-famous Harbour Bridge fireworks' } ],
  melbourne: [
    { name: 'Australian Open', sm: 1, sd: 12, em: 1, ed: 25, desc: 'Grand Slam tennis' },
    { name: 'Melbourne Cup', sm: 11, sd: 3, em: 11, ed: 3, desc: '“The race that stops a nation”' } ],
};
EVENTS['new delhi'] = EVENTS.delhi;
EVENTS['denpasar'] = EVENTS.bali;

function eventOccurrence(ev) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const make = (y) => {
    const s = new Date(y, ev.sm - 1, ev.sd);
    let e = new Date(y, ev.em - 1, ev.ed);
    if (e < s) e = new Date(y + 1, ev.em - 1, ev.ed); // wraps the year end
    return { s, e };
  };
  let { s, e } = make(now.getFullYear());
  if (e < now) ({ s, e } = make(now.getFullYear() + 1)); // already finished this year
  return { start: s, end: e, status: now >= s && now <= e ? 'now' : 'upcoming' };
}
function fmtEventRange(start, end) {
  const mo = (d) => d.toLocaleDateString(undefined, { month: 'short' });
  let r;
  if (start.getTime() === end.getTime()) r = `${mo(start)} ${start.getDate()}`;
  else if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) r = `${mo(start)} ${start.getDate()}–${end.getDate()}`;
  else r = `${mo(start)} ${start.getDate()} – ${mo(end)} ${end.getDate()}`;
  if (start.getFullYear() !== new Date().getFullYear()) r += ` ${start.getFullYear()}`;
  return r;
}
function renderEvents(place) {
  const city = place.name;
  const list = EVENTS[normCity(city)];
  if (!list) {
    el.eventsBody.innerHTML = `<div class="cycling-empty">
      <div class="cycling-empty-ic">🎉</div>
      <div><strong>No events curated for ${city}</strong><span>Festivals aren’t listed for ${city} yet.</span></div>
      <a class="tv-inline-link" target="_blank" rel="noopener" href="https://www.google.com/search?q=${enc('events festivals in ' + city + ' ' + new Date().getFullYear())}">Search what’s on in ${city} →</a>
    </div>`;
    return;
  }
  const rows = list.map((ev) => ({ ev, ...eventOccurrence(ev) })).sort((a, b) => a.start - b.start);
  const items = rows.map(({ ev, start, end, status }) => `
    <div class="event">
      <div class="event-date"><span class="event-mon">${start.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</span><span class="event-day">${start.getDate()}</span></div>
      <div class="event-info">
        <div class="event-name">${ev.name} <span class="event-badge ${status}">${status === 'now' ? 'Happening now' : 'Upcoming'}</span></div>
        <div class="event-when">${fmtEventRange(start, end)}${ev.vary ? ' · dates vary yearly' : ''}</div>
        <div class="event-desc">${ev.desc}</div>
      </div>
    </div>`).join('');
  el.eventsBody.innerHTML = `<div class="cycling-note">Current &amp; upcoming in ${city}</div>${items}`;
}

/* ============================================================
   NEWS — live top-5 headlines (Singapore / Global / city) from
   Google News RSS via a public CORS proxy. Falls back to an
   "Open in Google News" link if the live fetch can't be reached.
   ============================================================ */
let newsToken = 0;
const relTime = (dateStr) => {
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

// Public CORS proxies (keyless). The free ones are flaky and cache per-feed, so we
// RACE them in parallel — the first that returns valid RSS wins, avoiding slow
// sequential timeouts (which made cached feeds work but uncached ones "fail").
const PUBLIC_NEWS_PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
];
function parseRssItems(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  return [...doc.querySelectorAll('item')].slice(0, 5).map((it) => {
    let title = it.querySelector('title')?.textContent || '';
    const source = it.querySelector('source')?.textContent || '';
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return { title, link: it.querySelector('link')?.textContent || '', source, date: it.querySelector('pubDate')?.textContent || '' };
  }).filter((x) => x.title);
}
async function fetchViaProxy(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`news ${r.status}`);
    const items = parseRssItems(await r.text());
    if (!items.length) throw new Error('no items');
    return items;
  } finally { clearTimeout(timer); }
}
// rss2json is CORS-enabled, so it works directly from a static site (no proxy needed).
async function fetchViaRss2Json(feedUrl, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`, { signal: ctl.signal });
    if (!r.ok) throw new Error(`rss2json ${r.status}`);
    const j = await r.json();
    if (j.status !== 'ok' || !j.items?.length) throw new Error('rss2json empty');
    const items = j.items.slice(0, 5).map((it) => {
      let title = it.title || '', source = '';
      const idx = title.lastIndexOf(' - ');
      if (idx > 0) { source = title.slice(idx + 3).trim(); title = title.slice(0, idx); }
      return { title, link: it.link || '', source, date: it.pubDate || '' };
    }).filter((x) => x.title);
    if (!items.length) throw new Error('rss2json no items');
    return items;
  } finally { clearTimeout(timer); }
}
async function fetchHeadlines(feedUrl) {
  // 1. Same-origin server proxy first (reliable when server.js is running; fast 404 on static hosts).
  try { return await fetchViaProxy(`/api/news?url=${encodeURIComponent(feedUrl)}`, 5000); } catch { /* fall through */ }
  // 2. Race every CORS-capable source together — rss2json + public proxies — so each feed
  //    (incl. the uncached city query) gets several simultaneous chances; first valid wins.
  return Promise.any([
    fetchViaRss2Json(feedUrl, 9000),
    ...PUBLIC_NEWS_PROXIES.map((mk) => fetchViaProxy(mk(feedUrl), 9000)),
  ]);
}

function renderNews(place) {
  const token = ++newsToken;
  const city = place.name;
  const groups = [
    { key: 'sg', label: '🇸🇬 Singapore', feed: 'https://news.google.com/rss/search?q=Singapore&hl=en-SG&gl=SG&ceid=SG:en', view: 'https://news.google.com/home?hl=en-SG&gl=SG&ceid=SG:en' },
    { key: 'global', label: '🌐 Global', feed: 'https://news.google.com/rss/search?q=world%20news&hl=en-US&gl=US&ceid=US:en', view: 'https://news.google.com/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB?hl=en-US' },
    { key: 'local', label: `📍 ${city}`, feed: `https://news.google.com/rss/search?q=${enc(city)}&hl=en-US&gl=US&ceid=US:en`, view: `https://news.google.com/search?q=${enc(city)}&hl=en-US` },
  ];
  el.newsBody.innerHTML = groups.map((g) => `
    <div class="news-col" data-key="${g.key}">
      <div class="news-head"><span>${g.label}</span><a class="news-view" href="${g.view}" target="_blank" rel="noopener" title="Open in Google News">↗</a></div>
      <div class="news-list" id="news-${g.key}"><div class="news-loading">Loading headlines…</div></div>
    </div>`).join('');

  groups.forEach(async (g) => {
    try {
      const items = await fetchHeadlines(g.feed);
      if (token !== newsToken) return;
      document.getElementById(`news-${g.key}`).innerHTML = items.map((a, i) => `
        <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
          <span class="news-rank">${i + 1}</span>
          <span class="news-text"><span class="news-title">${a.title}</span><span class="news-meta">${[a.source, relTime(a.date)].filter(Boolean).join(' · ')}</span></span>
        </a>`).join('');
    } catch {
      if (token !== newsToken) return;
      const node = document.getElementById(`news-${g.key}`);
      if (node) node.innerHTML = `<div class="news-fallback">Couldn’t load live headlines here.<a class="tv-inline-link" href="${g.view}" target="_blank" rel="noopener">Open in Google News →</a></div>`;
    }
  });
}

/* ============================================================
   FOOD — curated must-eat dishes + top-5 places to eat by city.
   Matched by city; unlisted cities get a Google Maps search.
   ============================================================ */
const FOOD = {
  singapore: { dishes: ['Hainanese chicken rice', 'Chilli crab', 'Laksa', 'Char kway teow', 'Kaya toast & soft eggs'], places: [
    { name: 'Maxwell Food Centre', note: 'Tian Tian Hainanese chicken rice & classic hawker stalls' },
    { name: 'Newton Food Centre', note: 'Satay, BBQ stingray and seafood' },
    { name: 'Lau Pa Sat & Satay Street', note: 'Historic hawker hall; satay grills at night' },
    { name: 'Jumbo Seafood (East Coast)', note: 'The definitive chilli & black-pepper crab' },
    { name: 'Old Airport Road Food Centre', note: 'Local favourite for char kway teow & lor mee' } ] },
  tokyo: { dishes: ['Sushi', 'Ramen', 'Tempura', 'Tonkatsu', 'Unagi'], places: [
    { name: 'Toyosu / Tsukiji Outer Market', note: 'Fresh sushi breakfasts & street bites' },
    { name: 'Ichiran / Ippudo', note: 'Iconic tonkotsu ramen chains' },
    { name: 'Omoide Yokocho (Shinjuku)', note: 'Smoky yakitori alley' },
    { name: 'Ginza sushi counters', note: 'Omakase from casual to Michelin' },
    { name: 'Tsukiji tempura & unagi shops', note: 'Old-school fry & grill specialists' } ] },
  osaka: { dishes: ['Takoyaki', 'Okonomiyaki', 'Kushikatsu', 'Kitsune udon', 'Yakiniku'], places: [
    { name: 'Dotonbori', note: 'Takoyaki & okonomiyaki street-food strip' },
    { name: 'Kuromon Ichiba Market', note: 'Seafood, wagyu skewers & produce' },
    { name: 'Shinsekai', note: 'Kushikatsu (deep-fried skewers) heartland' },
    { name: 'Namba', note: 'Late-night izakaya & ramen' },
    { name: 'Tsuruhashi', note: 'Koreatown for yakiniku BBQ' } ] },
  seoul: { dishes: ['Korean BBQ', 'Bibimbap', 'Tteokbokki', 'Korean fried chicken', 'Naengmyeon'], places: [
    { name: 'Gwangjang Market', note: 'Bindaetteok, mayak gimbap & live octopus' },
    { name: 'Myeongdong street food', note: 'Tteokbokki, hotteok & skewers' },
    { name: 'Hongdae', note: 'Fried chicken & buzzy student eats' },
    { name: 'Mapo galbi street', note: 'Charcoal pork BBQ' },
    { name: 'Tongin Market', note: 'Coin lunchbox stalls' } ] },
  'hong kong': { dishes: ['Dim sum', 'Roast goose', 'Wonton noodles', 'Egg tarts', 'Milk tea'], places: [
    { name: 'Tim Ho Wan', note: 'Michelin dim sum, famed BBQ pork buns' },
    { name: 'Yat Lok', note: 'Legendary roast goose' },
    { name: "Mak's Noodle", note: 'Classic wonton noodle soup' },
    { name: 'Australia Dairy Company', note: 'Cha chaan teng eggs & milk tea' },
    { name: 'Temple Street Night Market', note: 'Clay-pot rice & seafood dai pai dong' } ] },
  taipei: { dishes: ['Beef noodle soup', 'Xiaolongbao', 'Braised pork rice', 'Stinky tofu', 'Bubble tea'], places: [
    { name: 'Din Tai Fung (original)', note: 'World-famous soup dumplings' },
    { name: 'Raohe Street Night Market', note: 'Pepper buns & street classics' },
    { name: 'Shilin Night Market', note: 'Taipei’s biggest street-food scene' },
    { name: 'Yongkang Beef Noodle', note: 'Benchmark beef noodle soup' },
    { name: 'Ningxia Night Market', note: 'Old-school Taiwanese snacks' } ] },
  bangkok: { dishes: ['Pad thai', 'Green curry', 'Tom yum goong', 'Mango sticky rice', 'Boat noodles'], places: [
    { name: 'Thipsamai', note: 'Bangkok’s most famous pad thai' },
    { name: 'Jay Fai', note: 'Michelin street wok, crab omelette' },
    { name: 'Yaowarat (Chinatown)', note: 'Night-time seafood & noodle feast' },
    { name: 'Or Tor Kor Market', note: 'Premium Thai produce & curries' },
    { name: 'Victory Monument boat noodles', note: 'Cheap, intense noodle bowls' } ] },
  'kuala lumpur': { dishes: ['Nasi lemak', 'Char kuey teow', 'Satay', 'Roti canai', 'Cendol'], places: [
    { name: 'Jalan Alor', note: 'KL’s buzzing night food street' },
    { name: 'Village Park Restaurant', note: 'Famous nasi lemak with fried chicken' },
    { name: 'Lot 10 Hutong', note: 'Heritage hawker brands under one roof' },
    { name: 'Madras Lane (Petaling St)', note: 'Curry laksa & yong tau foo' },
    { name: 'Petaling Street', note: 'Chinatown street snacks' } ] },
  jakarta: { dishes: ['Nasi goreng', 'Sate', 'Gado-gado', 'Soto Betawi', 'Bakso'], places: [
    { name: 'Sabang street food', note: 'Legendary sate & nasi goreng carts' },
    { name: 'Kota Tua', note: 'Old-town Betawi classics' },
    { name: 'Pasar Santa', note: 'Hipster food market' },
    { name: 'Grand Indonesia food hall', note: 'A/C spread of Indonesian favourites' },
    { name: 'Pantjoran PIK', note: 'Chinese-Indonesian dining street' } ] },
  bali: { dishes: ['Babi guling', 'Nasi campur', 'Satay lilit', 'Bebek betutu', 'Lawar'], places: [
    { name: 'Ibu Oka (Ubud)', note: 'Iconic Balinese suckling pig' },
    { name: 'Jimbaran Bay', note: 'Grilled seafood on the beach' },
    { name: 'Warung Nia', note: 'Classic babi guling & campur' },
    { name: "Naughty Nuri's", note: 'Famous BBQ pork ribs' },
    { name: 'Nasi Ayam Kedewatan', note: 'Beloved spicy chicken rice' } ] },
  manila: { dishes: ['Adobo', 'Sinigang', 'Lechon', 'Sisig', 'Halo-halo'], places: [
    { name: 'Binondo (Chinatown)', note: 'World’s oldest Chinatown food walk' },
    { name: 'Manam', note: 'Modern Filipino comfort classics' },
    { name: 'Aristocrat', note: 'Heritage chicken barbecue' },
    { name: 'Mercato Centrale', note: 'BGC night food market' },
    { name: 'Salcedo Saturday Market', note: 'Makati weekend food stalls' } ] },
  'ho chi minh city': { dishes: ['Pho', 'Banh mi', 'Bun thit nuong', 'Com tam', 'Vietnamese coffee'], places: [
    { name: 'Banh Mi Huynh Hoa', note: 'The city’s most loved banh mi' },
    { name: 'Pho Le', note: 'Famous southern-style pho' },
    { name: 'Com Tam Ba Ghien', note: 'Michelin-listed broken-rice pork' },
    { name: 'Ben Thanh Market', note: 'Street classics under one roof' },
    { name: 'Turtle Lake stalls', note: 'Evening street-food hub' } ] },
  mumbai: { dishes: ['Vada pav', 'Pav bhaji', 'Bhel puri', 'Bombay biryani', 'Butter chicken'], places: [
    { name: 'Bademiya', note: 'Late-night kebabs & rolls' },
    { name: 'Chowpatty Beach', note: 'Bhel puri & chaat by the sea' },
    { name: 'Britannia & Co.', note: 'Iconic Parsi berry pulao' },
    { name: 'Trishna', note: 'Legendary butter-pepper-garlic crab' },
    { name: 'Mohammed Ali Road', note: 'Ramadan-season meat feast' } ] },
  pune: { dishes: ['Misal pav', 'Vada pav', 'Puran poli', 'Mastani', 'Bhakarwadi'], places: [
    { name: 'Bedekar Misal', note: 'Famous fiery Puneri misal pav' },
    { name: 'Vaishali (FC Road)', note: 'Iconic South Indian dosas & filter coffee' },
    { name: 'Goodluck Cafe', note: 'Classic Irani cafe — bun maska & chai' },
    { name: 'Sujata Mastani', note: 'Legendary mastani (thick ice-cream shake)' },
    { name: 'German Bakery (Koregaon Park)', note: 'Beloved cafe & bakery' } ] },
  shanghai: { dishes: ['Xiaolongbao (soup dumplings)', 'Shengjianbao (pan-fried buns)', 'Hairy crab', 'Scallion-oil noodles', 'Red-braised pork'], places: [
    { name: 'Din Tai Fung', note: 'World-famous soup dumplings' },
    { name: "Yang's Fry Dumplings", note: 'Iconic shengjianbao (pan-fried buns)' },
    { name: 'Jia Jia Tang Bao', note: 'Beloved hole-in-the-wall soup dumplings' },
    { name: 'Nanxiang Steamed Bun (Yu Garden)', note: 'Historic xiaolongbao house' },
    { name: 'Lost Heaven', note: 'Upscale Yunnan folk cuisine' } ] },
  delhi: { dishes: ['Butter chicken', 'Chole bhature', 'Parathas', 'Kebabs', 'Chaat'], places: [
    { name: "Karim's (Old Delhi)", note: 'Mughlai kebabs & korma since 1913' },
    { name: 'Paranthe Wali Gali', note: 'Stuffed fried parathas alley' },
    { name: 'Chandni Chowk', note: 'Street-food institution' },
    { name: 'Bukhara', note: 'World-renowned dal & tandoori' },
    { name: 'Dilli Haat', note: 'Regional cuisines food court' } ] },
  dubai: { dishes: ['Shawarma', 'Machboos', 'Hummus & mezze', 'Manakish', 'Luqaimat'], places: [
    { name: 'Al Ustad Special Kabab', note: 'Beloved old-Dubai Iranian grill' },
    { name: 'Ravi Restaurant', note: 'Cult Pakistani curries' },
    { name: 'Bu Qtair', note: 'No-frills fresh fried seafood' },
    { name: 'Arabian Tea House', note: 'Emirati breakfast & machboos' },
    { name: 'Global Village', note: 'Pan-world street food (seasonal)' } ] },
  london: { dishes: ['Fish & chips', 'Sunday roast', 'Full English', 'Chicken tikka masala', 'Pie & mash'], places: [
    { name: 'Borough Market', note: 'Britain’s best food market' },
    { name: 'Dishoom', note: 'Bombay-café classics; famous bacon naan' },
    { name: 'Brick Lane', note: 'Curry houses & salt-beef bagels' },
    { name: 'Poppies', note: 'Proper fish & chips' },
    { name: 'Maltby Street Market', note: 'Weekend railway-arch food stalls' } ] },
  paris: { dishes: ['Croissant', 'Steak frites', 'Escargot', 'Crêpes', 'Macarons'], places: [
    { name: "L'As du Fallafel (Le Marais)", note: 'Legendary falafel queue' },
    { name: 'Bouillon Chartier', note: 'Historic, affordable French classics' },
    { name: 'Marché des Enfants Rouges', note: 'Oldest covered market, global stalls' },
    { name: 'Pierre Hermé', note: 'World-class macarons & pastries' },
    { name: 'Rue Cler', note: 'Market street of cheese, bread & wine' } ] },
  rome: { dishes: ['Cacio e pepe', 'Carbonara', 'Supplì', 'Roman pizza al taglio', 'Gelato'], places: [
    { name: 'Trastevere', note: 'Trattoria-packed cobbled quarter' },
    { name: 'Roscioli', note: 'Deli-restaurant; superb carbonara' },
    { name: 'Testaccio Market', note: 'Roman street food & supplì' },
    { name: 'Da Enzo al 29', note: 'Beloved classic trattoria' },
    { name: 'Giolitti', note: 'Historic gelateria' } ] },
  milan: { dishes: ['Risotto alla milanese', 'Ossobuco', 'Cotoletta', 'Panzerotti', 'Aperitivo'], places: [
    { name: 'Luini', note: 'Iconic panzerotti near the Duomo' },
    { name: 'Navigli canals', note: 'Aperitivo & buffet bars at dusk' },
    { name: 'Mercato Centrale', note: 'Artisan food hall at Centrale' },
    { name: 'Trattoria Masuelli', note: 'Classic Milanese cooking' },
    { name: 'Peck', note: 'Legendary gourmet food emporium' } ] },
  barcelona: { dishes: ['Tapas', 'Paella', 'Jamón ibérico', 'Pan con tomate', 'Crema catalana'], places: [
    { name: 'La Boqueria Market', note: 'Iconic market with tapas bars' },
    { name: 'El Xampanyet', note: 'Buzzy cava & tapas institution' },
    { name: 'Cervecería Catalana', note: 'Crowd-favourite tapas' },
    { name: 'Quimet & Quimet', note: 'Standing bar; famous montaditos' },
    { name: 'Bar del Pla', note: 'Modern tapas near El Born' } ] },
  madrid: { dishes: ['Cocido madrileño', 'Bocadillo de calamares', 'Churros con chocolate', 'Jamón', 'Tortilla española'], places: [
    { name: 'Mercado de San Miguel', note: 'Gourmet tapas market' },
    { name: 'Chocolatería San Ginés', note: 'Churros since 1894' },
    { name: 'Sobrino de Botín', note: 'World’s oldest restaurant; roast suckling pig' },
    { name: 'Casa Labra', note: 'Historic cod fritters & croquetas' },
    { name: 'Mercado de San Antón', note: 'Chueca food market & rooftop' } ] },
  istanbul: { dishes: ['Kebab', 'Meze', 'Balık ekmek (fish sandwich)', 'Baklava', 'Turkish breakfast'], places: [
    { name: 'Eminönü waterfront', note: 'Balık ekmek fish-sandwich boats' },
    { name: 'Karaköy Güllüoğlu', note: 'The baklava benchmark' },
    { name: 'Çiya Sofrası (Kadıköy)', note: 'Anatolian regional cooking' },
    { name: 'Spice Bazaar', note: 'Turkish delight, spices & snacks' },
    { name: 'Van Kahvaltı Evi', note: 'Epic Turkish breakfast' } ] },
  'new york': { dishes: ['NY pizza slice', 'Bagel & lox', 'Pastrami on rye', 'Hot dogs', 'Cheesecake'], places: [
    { name: "Katz's Delicatessen", note: 'The pastrami-on-rye legend' },
    { name: "Joe's Pizza", note: 'Classic NY foldable slice' },
    { name: 'Russ & Daughters', note: 'Appetizing: bagels, lox & schmear' },
    { name: 'Chelsea Market', note: 'Indoor food hall' },
    { name: 'Smorgasburg', note: 'Huge open-air food market (seasonal)' } ] },
  'los angeles': { dishes: ['Tacos', 'In-N-Out burger', 'Korean BBQ', 'Sushi', 'Food-truck fare'], places: [
    { name: 'Grand Central Market', note: 'Historic downtown food hall' },
    { name: 'Guisados', note: 'Braised-meat tacos' },
    { name: 'Koreatown', note: 'Late-night KBBQ & tofu houses' },
    { name: 'Sqirl', note: 'California brunch icon' },
    { name: 'Bestia', note: 'Buzzy Italian; book ahead' } ] },
  'san francisco': { dishes: ['Sourdough', 'Cioppino', 'Mission burrito', 'Dungeness crab', 'Dim sum'], places: [
    { name: 'Ferry Building Marketplace', note: 'Artisan food & farmers market' },
    { name: 'La Taqueria', note: 'Definitive Mission burrito' },
    { name: 'Swan Oyster Depot', note: 'Century-old seafood counter' },
    { name: 'Tartine Bakery', note: 'Country bread & pastries' },
    { name: 'Chinatown', note: 'Dim sum & classic Cantonese' } ] },
  chicago: { dishes: ['Deep-dish pizza', 'Italian beef', 'Chicago-style hot dog', 'Garrett popcorn', 'Jibarito'], places: [
    { name: "Lou Malnati's", note: 'The deep-dish pizza institution' },
    { name: "Portillo's", note: 'Italian beef & Chicago dogs' },
    { name: "Al's Beef", note: 'Original-style Italian beef sandwiches' },
    { name: 'Girl & the Goat', note: 'Stephanie Izard’s acclaimed small plates' },
    { name: "Pequod's Pizza", note: 'Famous caramelized-crust pan pizza' } ] },
  atlanta: { dishes: ['Southern fried chicken', 'Soul food', 'Shrimp & grits', 'Peach cobbler', 'BBQ'], places: [
    { name: 'The Varsity', note: 'Iconic 1928 drive-in — chili dogs & onion rings' },
    { name: "Mary Mac's Tea Room", note: 'Classic Southern comfort food' },
    { name: 'Busy Bee Cafe', note: 'Famous soul-food fried chicken' },
    { name: 'Fox Bros. Bar-B-Q', note: 'Beloved Texas-style barbecue' },
    { name: 'Ponce City Market', note: 'Food hall in a historic building' } ] },
  'las vegas': { dishes: ['Buffets', 'Steakhouse', 'Celebrity-chef tasting menus', 'Shrimp cocktail', '24-hour diners'], places: [
    { name: 'Bacchanal Buffet (Caesars)', note: 'The ultimate Vegas buffet' },
    { name: 'Lotus of Siam', note: 'Legendary northern-Thai, off-Strip' },
    { name: "Gordon Ramsay Hell's Kitchen", note: 'Celebrity-chef dining on the Strip' },
    { name: 'Secret Pizza (Cosmopolitan)', note: 'Hidden late-night pizza joint' },
    { name: 'Joël Robuchon (MGM)', note: '3-Michelin-star tasting menu' } ] },
  sydney: { dishes: ['Fresh oysters', 'Barramundi', 'Flat white & brunch', 'Meat pie', 'Lamington'], places: [
    { name: 'Sydney Fish Market', note: 'Seafood platters by the water' },
    { name: 'Bourke Street Bakery', note: 'Famous sausage rolls & pastries' },
    { name: 'Spice Alley (Chippendale)', note: 'Pan-Asian hawker-style lanes' },
    { name: 'Haymarket / Chinatown', note: 'Yum cha & night eats' },
    { name: 'Bondi cafés', note: 'Beachside brunch culture' } ] },
  melbourne: { dishes: ['Flat white & brunch', 'Parmigiana', 'Dim sim', 'Souvlaki', 'Cannoli'], places: [
    { name: 'Queen Victoria Market', note: 'Historic market & food stalls' },
    { name: 'Lygon Street', note: 'Melbourne’s Italian heart' },
    { name: 'Chinatown', note: 'Dumplings & late-night Asian eats' },
    { name: 'Hardware Lane', note: 'Laneway café & dining strip' },
    { name: 'Footscray', note: 'Vietnamese pho & banh mi' } ] },
};
FOOD['new delhi'] = FOOD.delhi;
FOOD['denpasar'] = FOOD.bali;
FOOD['saigon'] = FOOD['ho chi minh city'];

function renderFood(place) {
  const city = place.name;
  const f = FOOD[normCity(city)];
  const mapsSearch = `https://www.google.com/maps/search/?api=1&query=${enc('best food in ' + city)}`;
  if (!f) {
    el.foodBody.innerHTML = `<div class="cycling-empty">
      <div class="cycling-empty-ic">🍽️</div>
      <div><strong>No food guide for ${city}</strong><span>Curated eats aren’t listed for ${city} yet.</span></div>
      <a class="tv-inline-link" target="_blank" rel="noopener" href="${mapsSearch}">Find top-rated food on Google Maps →</a>
    </div>`;
    return;
  }
  const chips = f.dishes.map((d) => `<span class="food-chip">${d}</span>`).join('');
  const places = f.places.map((p, i) => `<li class="tv-attraction" data-name="${attrEsc(p.name)}" data-context="${attrEsc(city)}" role="button" tabindex="0" title="Show ${attrEsc(p.name)} on the map"><span class="tv-rank">${i + 1}</span><div><div class="tv-a-name">${p.name} <span class="tv-a-pin">📍</span></div><div class="tv-a-desc">${p.note}</div></div></li>`).join('');
  el.foodBody.innerHTML = `<div class="food-label">🍜 Must-eat in ${city}</div>
    <div class="food-dishes">${chips}</div>
    <div class="food-label">📍 Top 5 places to eat</div>
    <ol class="tv-attractions">${places}</ol>`;
}
// Click a food place → pin it on the map. Restaurants/markets have patchy OSM
// coverage, so try a few query forms and fall back to the city if not pinpointed.
async function showPlaceOnMap(name, city) {
  toast(`Locating ${name}…`);
  const clean = name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const firstPart = clean.split(/\s+[&/]\s+|,/)[0].trim();
  const geo = async (q) => { try { const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${enc(q)}&format=json&limit=1`); const j = await r.json(); return j[0]; } catch { return null; } };
  const queries = [...new Set([`${clean}, ${city}`, `${clean} ${city}`, `${firstPart}, ${city}`])];
  let hit = null;
  for (const q of queries) { hit = await geo(q); if (hit) break; }
  let approx = false;
  if (!hit) { hit = await geo(city); approx = true; }
  if (!hit) { toast(`Couldn't find ${name} on the map`); return; }
  placeAttractionMarker(parseFloat(hit.lat), parseFloat(hit.lon), approx ? `${name} (approx.)` : name);
  if (approx) toast(`Couldn't pinpoint ${name} — showing ${city}`);
}
if (el.foodBody) {
  el.foodBody.addEventListener('click', (e) => {
    const li = e.target.closest('.tv-attraction');
    if (li) showPlaceOnMap(li.dataset.name, li.dataset.context);
  });
  el.foodBody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const li = e.target.closest('.tv-attraction');
    if (li) { e.preventDefault(); showPlaceOnMap(li.dataset.name, li.dataset.context); }
  });
}

/* ============================================================
   TRANSPORTATION — curated airport→city transfer options by
   city (ride-hailing, rail/metro/MRT, bus, taxi). Matched by
   city; unlisted cities get a Google Maps transit route link.
   ============================================================ */
const TRANSPORT = {
  singapore: { airport: 'Changi Airport (SIN)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Grab · Gojek', detail: '~S$20–40 to city · 20–30 min' },
    { ic: '🚇', type: 'MRT', name: 'East–West Line (green)', detail: 'From Changi stn, change at Tanah Merah · ~S$2 · ~45 min' },
    { ic: '🚌', type: 'Bus', name: 'City buses 36 / 858', detail: '~S$2 · 60+ min to Orchard / city' },
    { ic: '🚕', type: 'Taxi', name: 'Metered taxi', detail: '~S$20–40 + airport surcharge · 25 min' } ] },
  tokyo: { airport: 'Narita / Haneda (NRT / HND)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'GO · Uber (taxi)', detail: 'Pricey from Narita; reasonable from Haneda' },
    { ic: '🚆', type: 'Airport train', name: "Narita Express · Keisei Skyliner", detail: 'Narita→city ~60 min; Haneda: Keikyu/Monorail ~20 min' },
    { ic: '🚌', type: 'Bus', name: 'Airport Limousine Bus', detail: 'Direct to major hotels · 60–90 min' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: 'Narita flat fares to some wards; expensive' } ] },
  osaka: { airport: 'Kansai (KIX)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · GO', detail: 'Limited; taxi apps common' },
    { ic: '🚆', type: 'Airport train', name: 'Haruka Express · Nankai', detail: 'To Namba/Tennoji/Shin-Osaka · 35–50 min' },
    { ic: '🚌', type: 'Bus', name: 'Airport Limousine Bus', detail: 'To Umeda / hotels · ~60 min' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: '~¥15,000+ to city · 50 min' } ] },
  seoul: { airport: 'Incheon (ICN)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Kakao T', detail: 'Book taxis in-app · 60–70 min' },
    { ic: '🚆', type: 'Airport rail', name: 'AREX Airport Railroad', detail: 'Express to Seoul Stn ~43 min; all-stop cheaper' },
    { ic: '🚌', type: 'Bus', name: 'Airport Limousine Bus', detail: 'Direct to districts/hotels · 60–90 min' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: '~₩60–90k to city · 60–70 min' } ] },
  'hong kong': { airport: 'Hong Kong Intl (HKG)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber', detail: 'Available; ~HK$300+ to Central' },
    { ic: '🚆', type: 'Airport rail', name: 'Airport Express (MTR)', detail: 'To Central in 24 min · ~HK$115' },
    { ic: '🚌', type: 'Bus', name: 'Citybus A-lines (A11/A21)', detail: 'Cheaper · 45–70 min to city' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi (red urban)', detail: '~HK$270–360 to HK Island · 40 min' } ] },
  taipei: { airport: 'Taoyuan (TPE)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber', detail: '~NT$1,000 to city · 40 min' },
    { ic: '🚇', type: 'Airport MRT', name: 'Taoyuan Airport MRT', detail: 'Express to Taipei Main ~38 min · NT$150' },
    { ic: '🚌', type: 'Bus', name: 'Kuo-Kuang 1819', detail: 'To Taipei Main · ~60 min · NT$140' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: '~NT$1,000–1,200 to city' } ] },
  bangkok: { airport: 'Suvarnabhumi (BKK)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Grab · Bolt', detail: '~฿350–500 to city (+tolls) · 40–60 min' },
    { ic: '🚆', type: 'Airport rail', name: 'Airport Rail Link (ARL)', detail: 'To Phaya Thai ~30 min · ฿35' },
    { ic: '🚌', type: 'Bus', name: 'Airport buses', detail: 'Cheap; slower in traffic' },
    { ic: '🚕', type: 'Taxi', name: 'Metered taxi', detail: 'Meter + ฿50 fee + tolls · 40–60 min' } ] },
  'kuala lumpur': { airport: 'KLIA / KLIA2 (KUL)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Grab', detail: '~RM75–90 to city · 45–60 min' },
    { ic: '🚆', type: 'Airport rail', name: 'KLIA Ekspres', detail: 'To KL Sentral ~28 min · RM55' },
    { ic: '🚌', type: 'Bus', name: 'Airport Coach', detail: 'To KL Sentral · ~60 min · ~RM15' },
    { ic: '🚕', type: 'Taxi', name: 'Airport taxi (coupon)', detail: '~RM75–110 · 45–60 min' } ] },
  jakarta: { airport: 'Soekarno–Hatta (CGK)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Grab · Gojek', detail: 'Pickup at set points · 60–90 min' },
    { ic: '🚆', type: 'Airport rail', name: 'Soetta Airport Rail Link', detail: 'To BNI City / Manggarai · ~50 min' },
    { ic: '🚌', type: 'Bus', name: 'DAMRI bus', detail: 'To multiple city points · cheap' },
    { ic: '🚕', type: 'Taxi', name: 'Blue Bird taxi', detail: 'Reliable metered · 60–90 min' } ] },
  bali: { airport: 'Ngurah Rai (DPS)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Grab · Gojek', detail: 'Restricted at airport; pickup outside terminal' },
    { ic: '🚕', type: 'Taxi', name: 'Official airport taxi', detail: 'Fixed-price counter by zone' },
    { ic: '🚐', type: 'Shuttle', name: 'Hotel / private transfer', detail: 'Common; pre-book for Ubud/Seminyak' } ] },
  manila: { airport: 'NAIA (MNL)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Grab', detail: 'Surge-priced; heavy traffic' },
    { ic: '🚌', type: 'Bus', name: 'UBE Express', detail: 'Airport bus to Makati/city points' },
    { ic: '🚕', type: 'Taxi', name: 'Yellow airport taxi', detail: 'Metered; use official coupon taxis' } ] },
  mumbai: { airport: 'Chhatrapati Shivaji (BOM)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Ola', detail: 'Common; traffic-dependent' },
    { ic: '🚕', type: 'Taxi', name: 'Prepaid taxi', detail: 'Fixed-fare counter at terminal' },
    { ic: '🚇', type: 'Metro', name: 'Metro Line 3 (partial)', detail: 'Growing network; check current stations' } ] },
  pune: { airport: 'Pune Airport (PNQ)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Ola', detail: '~₹300–500 to city · 30–45 min' },
    { ic: '🚇', type: 'Metro', name: 'Pune Metro', detail: 'Purple & Aqua lines serve central Pune' },
    { ic: '🚌', type: 'Bus', name: 'PMPML bus', detail: 'Cheap city buses' },
    { ic: '🚕', type: 'Taxi', name: 'Prepaid taxi', detail: 'Fixed-fare counter at the terminal' } ] },
  shanghai: { airport: 'Pudong / Hongqiao (PVG / SHA)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'DiDi', detail: 'Dominant app (Chinese UI) · ~¥150–200 from Pudong' },
    { ic: '🚄', type: 'Maglev', name: 'Shanghai Maglev + Metro', detail: 'Pudong→Longyang Rd at 430 km/h (~8 min), then Metro' },
    { ic: '🚇', type: 'Metro', name: 'Metro Line 2 / 10', detail: 'Direct to the city centre; cheap' },
    { ic: '🚕', type: 'Taxi', name: 'Metered taxi', detail: '~¥160 from Pudong · 45–60 min' } ] },
  delhi: { airport: 'Indira Gandhi (DEL)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Ola', detail: '~₹400–600 to central Delhi' },
    { ic: '🚇', type: 'Airport metro', name: 'Airport Express (Orange)', detail: 'To New Delhi Stn ~20 min · ~₹60' },
    { ic: '🚌', type: 'Bus', name: 'DTC / AISATS bus', detail: 'To city hubs · cheap' },
    { ic: '🚕', type: 'Taxi', name: 'Prepaid taxi', detail: 'Fixed-fare counter' } ] },
  dubai: { airport: 'Dubai Intl (DXB)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Careem', detail: '~AED 50–90 to Downtown · 15–25 min' },
    { ic: '🚇', type: 'Metro', name: 'Dubai Metro Red Line', detail: 'Direct from T1/T3 · ~AED 5–8' },
    { ic: '🚌', type: 'Bus', name: 'RTA airport buses', detail: 'Cheap; to city hubs' },
    { ic: '🚕', type: 'Taxi', name: 'RTA taxi', detail: 'Metered + AED 25 airport fee' } ] },
  london: { airport: 'Heathrow (LHR)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Bolt', detail: '~£40–70 to central · 45–70 min' },
    { ic: '🚇', type: 'Rail / Tube', name: 'Elizabeth line · Piccadilly · Heathrow Express', detail: 'Elizabeth ~40 min; Express to Paddington 15 min' },
    { ic: '🚌', type: 'Coach', name: 'National Express', detail: 'To Victoria Coach Stn · budget' },
    { ic: '🚕', type: 'Taxi', name: 'Black cab', detail: '~£50–100 · 45–70 min' } ] },
  paris: { airport: 'Charles de Gaulle (CDG)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Bolt', detail: '~€50–70 to central · 40–60 min' },
    { ic: '🚆', type: 'Airport rail', name: 'RER B', detail: 'To Gare du Nord / Châtelet ~35 min · ~€11' },
    { ic: '🚌', type: 'Bus', name: 'Roissybus', detail: 'To Opéra · ~60 min · ~€16' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi (flat fare)', detail: '€56 to Right Bank, €65 Left Bank' } ] },
  berlin: { airport: 'Brandenburg (BER)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Bolt · FreeNow', detail: '~€40–55 to Mitte · 35–45 min' },
    { ic: '🚆', type: 'Rail', name: 'FEX · S-Bahn S9 · RE', detail: 'FEX to Hauptbahnhof ~30 min · ~€4.40' },
    { ic: '🚌', type: 'Bus', name: 'BVG buses', detail: 'Included in ABC ticket' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: '~€50–60 to central' } ] },
  amsterdam: { airport: 'Schiphol (AMS)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Bolt', detail: '~€40–55 to centre · 25–35 min' },
    { ic: '🚆', type: 'Train', name: 'NS train to Centraal', detail: 'Direct · ~17 min · ~€5.90' },
    { ic: '🚌', type: 'Bus', name: 'Bus 397 (Amsterdam Express)', detail: 'To Museumplein · ~30 min' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: '~€45–60 · 25–35 min' } ] },
  barcelona: { airport: 'El Prat (BCN)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Cabify · Uber', detail: '~€30–45 to centre · 25–35 min' },
    { ic: '🚇', type: 'Rail / Metro', name: 'Aerobús · Metro L9 Sud · Rodalies R2', detail: 'R2 to Sants/Passeig de Gràcia ~25 min' },
    { ic: '🚌', type: 'Bus', name: 'Aerobús', detail: 'To Plaça Catalunya · ~35 min · ~€6' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi (flat ~€39)', detail: 'Fixed airport fare · 25–30 min' } ] },
  rome: { airport: 'Fiumicino (FCO)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber (Black) · FreeNow', detail: 'Premium only · 40–55 min' },
    { ic: '🚆', type: 'Airport train', name: 'Leonardo Express', detail: 'To Termini ~32 min · €14' },
    { ic: '🚌', type: 'Bus', name: 'Terravision / SIT', detail: 'To Termini · budget · ~55 min' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi (flat €50)', detail: 'Fixed fare to city walls · 45 min' } ] },
  milan: { airport: 'Malpensa (MXP)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber (Black) · FreeNow', detail: 'Premium · 50 min' },
    { ic: '🚆', type: 'Airport train', name: 'Malpensa Express', detail: 'To Cadorna/Centrale ~50 min · €13' },
    { ic: '🚌', type: 'Bus', name: 'Airport shuttle bus', detail: 'To Centrale · ~60 min · ~€10' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi (flat €104)', detail: 'Fixed fare to city · 50 min' } ] },
  'new york': { airport: 'JFK', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Lyft', detail: '~$70–110 to Manhattan · 45–75 min' },
    { ic: '🚇', type: 'AirTrain + Subway', name: 'AirTrain → E / LIRR', detail: 'To Manhattan ~50–65 min · ~$11' },
    { ic: '🚌', type: 'Bus', name: 'NYC Airporter', detail: 'To Midtown terminals' },
    { ic: '🚕', type: 'Taxi', name: 'Yellow cab (flat $70)', detail: 'Flat to Manhattan + tolls/tip' } ] },
  'los angeles': { airport: 'LAX', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Lyft (LAX-it)', detail: 'Pickup at LAX-it lot · varies widely' },
    { ic: '🚇', type: 'Metro', name: 'Metro C Line + APM', detail: 'People-mover to Metro rail (opening phased)' },
    { ic: '🚌', type: 'Bus', name: 'FlyAway bus', detail: 'To Union Station / Van Nuys' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: 'Metered; heavy traffic' } ] },
  'san francisco': { airport: 'SFO', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Lyft', detail: '~$40–70 to downtown · 25–40 min' },
    { ic: '🚆', type: 'BART', name: 'BART', detail: 'Direct to downtown SF ~30 min · ~$10' },
    { ic: '🚌', type: 'Bus', name: 'SamTrans', detail: 'Budget; slower' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: '~$55–70 to downtown' } ] },
  chicago: { airport: "O'Hare / Midway (ORD / MDW)", options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Lyft', detail: '~$35–55 to the Loop · 30–50 min' },
    { ic: '🚇', type: 'CTA train', name: 'Blue Line (O’Hare) · Orange Line (Midway)', detail: 'Direct to downtown · ~$5 · 40–45 min' },
    { ic: '🚌', type: 'Shuttle', name: 'Airport shuttles', detail: 'Shared vans to hotels' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: '~$40–60 to downtown' } ] },
  atlanta: { airport: 'Hartsfield-Jackson (ATL)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Lyft', detail: '~$30–45 to Midtown/Downtown · 20–30 min' },
    { ic: '🚆', type: 'MARTA rail', name: 'MARTA Red/Gold Line', detail: 'Direct from airport to downtown ~20 min · ~$2.50' },
    { ic: '🚌', type: 'Bus', name: 'MARTA buses', detail: 'Cheap; wider coverage' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: 'Flat ~$30 to a downtown zone' } ] },
  'las vegas': { airport: 'Harry Reid Intl (LAS)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Lyft', detail: 'Level 2M pickup · ~$25–35 to the Strip · 15 min' },
    { ic: '🚌', type: 'Bus', name: 'RTC WAX / CX', detail: 'To the Strip & downtown · ~$6 day pass' },
    { ic: '🚕', type: 'Taxi', name: 'Metered taxi', detail: '~$25–40 to the Strip · 15–20 min' },
    { ic: '🚈', type: 'Monorail', name: 'Las Vegas Monorail', detail: 'Runs along the Strip (not from airport) · $5–13' } ] },
  sydney: { airport: 'Kingsford Smith (SYD)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · DiDi · Ola', detail: '~A$35–55 to CBD · 20–30 min' },
    { ic: '🚆', type: 'Train', name: 'Airport Link', detail: 'To Central ~13 min (+ station access fee)' },
    { ic: '🚌', type: 'Bus', name: 'Route 400', detail: 'Cheaper; to Bondi Junction' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: '~A$45–60 to CBD' } ] },
  melbourne: { airport: 'Tullamarine (MEL)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · DiDi', detail: '~A$45–65 to CBD · 25–40 min' },
    { ic: '🚌', type: 'Bus', name: 'SkyBus', detail: 'To Southern Cross ~30 min (no train yet)' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: '~A$55–75 to CBD' } ] },
  auckland: { airport: 'Auckland (AKL)', options: [
    { ic: '🚗', type: 'Ride-hailing', name: 'Uber · Ola', detail: '~NZ$45–65 to city · 30–45 min' },
    { ic: '🚌', type: 'Bus', name: 'SkyDrive', detail: 'Express to city centre (no train)' },
    { ic: '🚕', type: 'Taxi', name: 'Taxi', detail: '~NZ$75–90 to city' } ] },
};
TRANSPORT['new delhi'] = TRANSPORT.delhi;
TRANSPORT['denpasar'] = TRANSPORT.bali;

function renderTransport(place) {
  const city = place.name;
  const t = TRANSPORT[normCity(city)];
  const mapsRoute = (o, d) => `https://www.google.com/maps/dir/?api=1&origin=${enc(o)}&destination=${enc(d)}&travelmode=transit`;
  if (!t) {
    el.transportBody.innerHTML = `<div class="cycling-empty">
      <div class="cycling-empty-ic">🚕</div>
      <div><strong>No transport guide for ${city}</strong><span>Airport-transfer options aren’t curated for ${city} yet.</span></div>
      <a class="tv-inline-link" target="_blank" rel="noopener" href="${mapsRoute(city + ' airport', city + ' city centre')}">Plan a route on Google Maps →</a>
    </div>`;
    return;
  }
  const items = t.options.map((o) => `
    <div class="trip">
      <div class="trip-ic">${o.ic}</div>
      <div class="trip-info">
        <div class="trip-top"><span class="trip-type">${o.type}</span><span class="trip-name">${o.name}</span></div>
        <div class="trip-detail">${o.detail}</div>
      </div>
    </div>`).join('');
  el.transportBody.innerHTML = `<div class="cycling-note">From ${t.airport} → ${city}</div>${items}
    <a class="tv-inline-link" target="_blank" rel="noopener" href="${mapsRoute(t.airport, city + ' city centre')}">Plan a route on Google Maps →</a>`;
}

/* ============================================================
   CYCLING — curated MAAP weekly group-ride schedule by city.
   Matched by city first, then any ride in the same country;
   each ride recurs weekly and shows its next upcoming date.
   Shows "No Maap Rides found" when nothing matches.
   ============================================================ */
const MAAP_RIDES = [
  // Australia / NZ
  { city: 'Melbourne', cc: 'AU', name: 'Saturday Shop Ride', day: 6, time: '7:00 AM', meet: 'MAAP Store, Collingwood', dist: '70 km', pace: 'Endurance' },
  { city: 'Melbourne', cc: 'AU', name: 'Wednesday Coffee Ride', day: 3, time: '6:30 AM', meet: 'Alexandra Gardens', dist: '40 km', pace: 'Social' },
  { city: 'Sydney', cc: 'AU', name: 'Saturday Beaches Ride', day: 6, time: '6:30 AM', meet: 'Bondi Beach', dist: '65 km', pace: 'Tempo' },
  { city: 'Brisbane', cc: 'AU', name: 'Mt Coot-tha Ride', day: 6, time: '6:00 AM', meet: 'South Bank', dist: '55 km', pace: 'Climbing' },
  { city: 'Perth', cc: 'AU', name: 'Kings Park Ride', day: 6, time: '6:00 AM', meet: 'Kings Park', dist: '50 km', pace: 'Social' },
  { city: 'Auckland', cc: 'NZ', name: 'Devonport Loop', day: 0, time: '7:00 AM', meet: 'Devonport Ferry', dist: '60 km', pace: 'Endurance' },
  // Asia
  { city: 'Singapore', cc: 'SG', name: 'Coastal Loop Ride', day: 0, time: '6:30 AM', meet: 'MAAP pop-up, Tanjong Pagar', dist: '55 km', pace: 'Social' },
  { city: 'Singapore', cc: 'SG', name: 'Mandai Hills Ride', day: 6, time: '6:00 AM', meet: 'Woodlands', dist: '70 km', pace: 'Tempo' },
  { city: 'Tokyo', cc: 'JP', name: 'Tamagawa Morning Ride', day: 6, time: '6:00 AM', meet: 'Futako-Tamagawa', dist: '60 km', pace: 'Endurance' },
  { city: 'Hong Kong', cc: 'HK', name: 'Tai Mo Shan Climb', day: 0, time: '6:30 AM', meet: 'Tsuen Wan', dist: '45 km', pace: 'Climbing' },
  { city: 'Seoul', cc: 'KR', name: 'Han River Ride', day: 6, time: '6:30 AM', meet: 'Ttukseom Resort', dist: '50 km', pace: 'Social' },
  { city: 'Taipei', cc: 'TW', name: 'Riverside Ride', day: 6, time: '6:00 AM', meet: 'Dadaocheng Wharf', dist: '60 km', pace: 'Endurance' },
  { city: 'Bangkok', cc: 'TH', name: 'Sky Lane Ride', day: 0, time: '6:00 AM', meet: 'Suvarnabhumi Sky Lane', dist: '50 km', pace: 'Social' },
  { city: 'Kuala Lumpur', cc: 'MY', name: 'Genting Foothills Ride', day: 0, time: '6:30 AM', meet: 'KLCC Park', dist: '70 km', pace: 'Climbing' },
  { city: 'Bali', cc: 'ID', name: 'Sanur Sunrise Ride', day: 6, time: '5:30 AM', meet: 'Sanur Beach', dist: '45 km', pace: 'Social' },
  { city: 'Jakarta', cc: 'ID', name: 'Car-Free-Day Ride', day: 0, time: '6:00 AM', meet: 'Bundaran HI', dist: '40 km', pace: 'Social' },
  { city: 'Ho Chi Minh City', cc: 'VN', name: 'Thu Thiem Ride', day: 0, time: '5:30 AM', meet: 'Landmark 81', dist: '50 km', pace: 'Social' },
  { city: 'Manila', cc: 'PH', name: 'Nuvali Ride', day: 0, time: '5:30 AM', meet: 'BGC', dist: '60 km', pace: 'Endurance' },
  { city: 'Mumbai', cc: 'IN', name: 'Marine Drive Ride', day: 0, time: '5:30 AM', meet: 'Marine Drive', dist: '40 km', pace: 'Social' },
  { city: 'Dubai', cc: 'AE', name: 'Al Qudra Ride', day: 5, time: '6:00 AM', meet: 'Al Qudra Cycle Track', dist: '80 km', pace: 'Endurance' },
  // Europe
  { city: 'London', cc: 'GB', name: 'Sunday Surrey Hills Ride', day: 0, time: '8:00 AM', meet: 'Clubhouse, Soho', dist: '90 km', pace: 'Endurance' },
  { city: 'London', cc: 'GB', name: "Regent's Park Laps", day: 2, time: '6:45 AM', meet: "Regent's Park", dist: '30 km', pace: 'Chaingang' },
  { city: 'Paris', cc: 'FR', name: 'Longchamp Loops', day: 0, time: '8:30 AM', meet: 'Bois de Boulogne', dist: '50 km', pace: 'Social' },
  { city: 'Berlin', cc: 'DE', name: 'Grunewald Ride', day: 6, time: '9:00 AM', meet: 'Brandenburg Gate', dist: '65 km', pace: 'Endurance' },
  { city: 'Munich', cc: 'DE', name: 'Starnberg Lake Ride', day: 0, time: '8:30 AM', meet: 'Marienplatz', dist: '70 km', pace: 'Endurance' },
  { city: 'Amsterdam', cc: 'NL', name: 'Waterland Ride', day: 0, time: '9:00 AM', meet: 'Amsterdam Noord ferry', dist: '55 km', pace: 'Social' },
  { city: 'Barcelona', cc: 'ES', name: 'Montjuïc Loops', day: 6, time: '8:00 AM', meet: 'Arc de Triomf', dist: '60 km', pace: 'Climbing' },
  { city: 'Madrid', cc: 'ES', name: 'Sierra Ride', day: 0, time: '8:00 AM', meet: 'Plaza de Castilla', dist: '80 km', pace: 'Endurance' },
  { city: 'Milan', cc: 'IT', name: 'Naviglio Ride', day: 6, time: '8:30 AM', meet: 'Darsena', dist: '70 km', pace: 'Endurance' },
  { city: 'Rome', cc: 'IT', name: 'Appia Antica Ride', day: 0, time: '8:00 AM', meet: 'Circo Massimo', dist: '55 km', pace: 'Social' },
  { city: 'Zurich', cc: 'CH', name: 'Lake Loop', day: 6, time: '8:30 AM', meet: 'Bürkliplatz', dist: '60 km', pace: 'Endurance' },
  { city: 'Vienna', cc: 'AT', name: 'Danube Ride', day: 6, time: '8:30 AM', meet: 'Prater', dist: '55 km', pace: 'Social' },
  { city: 'Copenhagen', cc: 'DK', name: 'Amager Ride', day: 6, time: '9:00 AM', meet: 'Nyhavn', dist: '50 km', pace: 'Social' },
  { city: 'Stockholm', cc: 'SE', name: 'Archipelago Ride', day: 0, time: '9:00 AM', meet: 'Djurgården', dist: '55 km', pace: 'Endurance' },
  { city: 'Dublin', cc: 'IE', name: 'Wicklow Ride', day: 0, time: '8:00 AM', meet: 'Phoenix Park', dist: '85 km', pace: 'Climbing' },
  // Americas
  { city: 'New York', cc: 'US', name: 'River Road Ride', day: 6, time: '7:00 AM', meet: 'GWB, Manhattan side', dist: '75 km', pace: 'Endurance' },
  { city: 'Los Angeles', cc: 'US', name: 'Nichols Canyon Ride', day: 6, time: '7:30 AM', meet: 'Griffith Park', dist: '60 km', pace: 'Climbing' },
  { city: 'San Francisco', cc: 'US', name: 'Marin Headlands Ride', day: 6, time: '8:00 AM', meet: 'Golden Gate Bridge', dist: '65 km', pace: 'Climbing' },
  { city: 'Chicago', cc: 'US', name: 'Lakefront Trail Ride', day: 6, time: '7:30 AM', meet: 'Millennium Park', dist: '50 km', pace: 'Social' },
  { city: 'Toronto', cc: 'CA', name: 'Don Valley Ride', day: 6, time: '8:00 AM', meet: 'Evergreen Brick Works', dist: '55 km', pace: 'Endurance' },
  { city: 'Vancouver', cc: 'CA', name: 'Seawall Ride', day: 6, time: '8:00 AM', meet: 'Stanley Park', dist: '45 km', pace: 'Social' },
];

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function nextRideDate(weekday) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7)); // next occurrence (today counts)
  return d;
}

/* Rapha RCC clubhouse weekly rides (curated — events.rapha.cc blocks scraping, HTTP 403) */
const RAPHA_RIDES = [
  { city: 'London', cc: 'GB', name: 'RCC Saturday Ride', day: 6, time: '8:00 AM', meet: 'Rapha Clubhouse, Brewer St', dist: '80 km', pace: 'Endurance' },
  { city: 'London', cc: 'GB', name: 'Prospect Ride', day: 3, time: '6:30 AM', meet: 'Rapha Clubhouse, Spitalfields', dist: '40 km', pace: 'Social' },
  { city: 'Manchester', cc: 'GB', name: 'Peak District Ride', day: 0, time: '8:00 AM', meet: 'Rapha Clubhouse, Manchester', dist: '100 km', pace: 'Endurance' },
  { city: 'Amsterdam', cc: 'NL', name: 'RCC Waterland Ride', day: 6, time: '9:00 AM', meet: 'Rapha Clubhouse, Amsterdam', dist: '65 km', pace: 'Social' },
  { city: 'Berlin', cc: 'DE', name: 'RCC Brandenburg Ride', day: 6, time: '9:00 AM', meet: 'Rapha Clubhouse, Berlin', dist: '70 km', pace: 'Endurance' },
  { city: 'Munich', cc: 'DE', name: 'RCC Alpine Foothills Ride', day: 0, time: '8:00 AM', meet: 'Rapha Clubhouse, Munich', dist: '90 km', pace: 'Climbing' },
  { city: 'Copenhagen', cc: 'DK', name: 'RCC Coast Ride', day: 0, time: '9:00 AM', meet: 'Rapha Clubhouse, Copenhagen', dist: '60 km', pace: 'Social' },
  { city: 'Milan', cc: 'IT', name: 'RCC Lake Como Ride', day: 0, time: '7:30 AM', meet: 'Rapha Clubhouse, Milan', dist: '110 km', pace: 'Endurance' },
  { city: 'Paris', cc: 'FR', name: 'RCC Chevreuse Ride', day: 0, time: '8:00 AM', meet: 'Rapha Clubhouse, Paris', dist: '90 km', pace: 'Endurance' },
  { city: 'Tokyo', cc: 'JP', name: 'RCC Okutama Ride', day: 0, time: '6:30 AM', meet: 'Rapha Clubhouse, Daikanyama', dist: '100 km', pace: 'Climbing' },
  { city: 'Tokyo', cc: 'JP', name: 'RCC Morning Ride', day: 6, time: '6:30 AM', meet: 'Rapha Clubhouse, Daikanyama', dist: '50 km', pace: 'Social' },
  { city: 'Osaka', cc: 'JP', name: 'RCC Hokusetsu Ride', day: 0, time: '7:00 AM', meet: 'Rapha Clubhouse, Osaka', dist: '80 km', pace: 'Endurance' },
  { city: 'Seoul', cc: 'KR', name: 'RCC Namhan River Ride', day: 6, time: '6:30 AM', meet: 'Rapha Clubhouse, Seoul', dist: '70 km', pace: 'Endurance' },
  { city: 'Hong Kong', cc: 'HK', name: 'RCC Clearwater Bay Ride', day: 0, time: '6:30 AM', meet: 'Rapha Clubhouse, Hong Kong', dist: '70 km', pace: 'Endurance' },
  { city: 'Sydney', cc: 'AU', name: 'RCC West Head Ride', day: 6, time: '6:30 AM', meet: 'Rapha Clubhouse, Sydney', dist: '90 km', pace: 'Endurance' },
  { city: 'Melbourne', cc: 'AU', name: 'RCC Kinglake Ride', day: 6, time: '7:00 AM', meet: 'Rapha Clubhouse, Melbourne', dist: '95 km', pace: 'Climbing' },
  { city: 'New York', cc: 'US', name: 'RCC Nyack Ride', day: 6, time: '7:30 AM', meet: 'Rapha Clubhouse, Prince St', dist: '80 km', pace: 'Endurance' },
  { city: 'San Francisco', cc: 'US', name: 'RCC Paradise Loop', day: 6, time: '8:00 AM', meet: 'Rapha Clubhouse, San Francisco', dist: '70 km', pace: 'Tempo' },
  { city: 'Los Angeles', cc: 'US', name: 'RCC Malibu Ride', day: 6, time: '7:30 AM', meet: 'Rapha Clubhouse, Los Angeles', dist: '100 km', pace: 'Endurance' },
  { city: 'Chicago', cc: 'US', name: 'RCC North Shore Ride', day: 6, time: '7:30 AM', meet: 'Rapha Clubhouse, Chicago', dist: '70 km', pace: 'Social' },
  { city: 'Washington', cc: 'US', name: 'RCC Beach Drive Ride', day: 6, time: '8:00 AM', meet: 'Rapha Clubhouse, Washington DC', dist: '65 km', pace: 'Social' },
  { city: 'Toronto', cc: 'CA', name: 'RCC Forks of the Credit Ride', day: 0, time: '8:00 AM', meet: 'Rapha Clubhouse, Toronto', dist: '90 km', pace: 'Climbing' },
];

/* Shared renderer for a curated ride dataset (MAAP / Rapha) */
function renderRideList(bodyEl, dataset, place, brand, emptyName) {
  const key = normCity(place.name);
  const cc = (place.cc || '').toUpperCase();
  // Match on city first, then fall back to any ride in the same country.
  let rides = dataset.filter((r) => normCity(r.city) === key);
  let scope = 'city';
  if (!rides.length && cc) { rides = dataset.filter((r) => r.cc === cc); scope = 'country'; }

  if (!rides.length) {
    bodyEl.innerHTML = `<div class="cycling-empty">
      <div class="cycling-empty-ic">🚲</div>
      <div><strong>No ${emptyName} Rides found</strong><span>No ${brand} group rides listed for ${place.name}.</span></div>
    </div>`;
    return;
  }

  const withDates = rides.map((r) => ({ r, date: nextRideDate(r.day) })).sort((a, b) => a.date - b.date);
  const items = withDates.map(({ r, date }) => `
    <div class="ride">
      <div class="ride-date"><span class="ride-dow">${DOW_SHORT[date.getDay()]}</span><span class="ride-num">${date.getDate()}</span><span class="ride-mon">${date.toLocaleDateString(undefined, { month: 'short' })}</span></div>
      <div class="ride-info">
        <div class="ride-name">${r.name}</div>
        <div class="ride-meta">📍 ${r.meet} · ${r.time}${scope === 'country' ? ` · ${r.city}` : ''}</div>
        <div class="ride-tags"><span class="ride-tag">${r.dist}</span><span class="ride-tag">${r.pace}</span></div>
      </div>
    </div>`).join('');
  bodyEl.innerHTML = `<div class="cycling-note">Upcoming ${brand} rides ${scope === 'country' ? `in ${place.country || 'this country'}` : `near ${place.name}`}</div>${items}`;
}
function renderCycling(place) { renderRideList(el.cyclingBody, MAAP_RIDES, place, 'MAAP', 'Maap'); }
function renderRapha(place) { renderRideList(el.raphaBody, RAPHA_RIDES, place, 'Rapha', 'Rapha'); }

/* ---------- Core flow: load a location ---------- */
let loadToken = 0;
async function loadLocation(place, { moveMap = true } = {}) {
  const token = ++loadToken;
  state.current = place;
  el.heroContent.hidden = true;
  el.heroLoading.hidden = false;
  el.heroLoading.querySelector('p').textContent = `Loading ${place.name}…`;
  renderSaved();

  if (moveMap && state.map) setPin(place.lat, place.lon, { fly: true });

  renderTravel(place); // independent of weather fetch; runs in parallel
  renderWorkdayOffice(place);
  renderEssentials(place);
  updateAirQuality(place);
  renderEvents(place);
  renderNews(place);
  renderTransport(place);
  renderFood(place);
  renderCycling(place);
  renderRapha(place);
  renderLinks(place);
  updateSpotifyEmbed(place);
  setHotelCityDefault(place.name);
  setExpCurDefault(place.cc);

  try {
    const data = await fetchWeather(place.lat, place.lon);
    if (token !== loadToken) return; // superseded
    state.weather = data;
    state.selectedDay = 0;
    renderCurrent(place, data);
    renderHourly(data, 0);
    renderDaily(data);
    renderPacking(data, place);
    el.heroLoading.hidden = true;
    el.heroContent.hidden = false;
  } catch (e) {
    if (token !== loadToken) return;
    el.heroLoading.querySelector('p').textContent = 'Could not load weather. Try again.';
    toast('Weather request failed');
  }
}

/* ---------- Map ---------- */
function initMap() {
  state.map = L.map('map', { zoomControl: true, attributionControl: true }).setView([DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon], 4);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(state.map);

  const pinIcon = L.divIcon({ className: '', html: '<div class="pin-marker"></div>', iconSize: [26, 26], iconAnchor: [13, 26] });
  state.marker = L.marker([DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon], { icon: pinIcon, draggable: true }).addTo(state.map);

  state.marker.on('dragend', () => {
    const { lat, lng } = state.marker.getLatLng();
    onPinDropped(lat, lng);
  });
  state.map.on('click', (e) => {
    setPin(e.latlng.lat, e.latlng.lng, { fly: false });
    onPinDropped(e.latlng.lat, e.latlng.lng);
  });

  addWindControl();
  initRadar();
}

/* Wind-direction compass overlaid on the map (needle points the way the wind blows) */
function addWindControl() {
  if (state.windCtrl) return;
  const ctrl = L.control({ position: 'topright' });
  ctrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'wind-compass');
    div.innerHTML = `
      <svg viewBox="0 0 44 44" class="wind-dial">
        <circle cx="22" cy="22" r="19" class="wind-ring"/>
        <text x="22" y="10" class="wind-lbl wind-n">N</text>
        <text x="22" y="40" class="wind-lbl">S</text>
        <text x="39" y="25" class="wind-lbl">E</text>
        <text x="5" y="25" class="wind-lbl">W</text>
        <g class="wind-needle"><path d="M22 7 L27 24 L22 20 L17 24 Z"/></g>
      </svg>
      <div class="wind-readout"><b class="wind-speed">–</b><span class="wind-unit">km/h</span><b class="wind-card"></b></div>`;
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  ctrl.addTo(state.map);
  state.windCtrl = ctrl;
}
function updateWindIndicator(speed, dir) {
  if (!state.windCtrl) return;
  const box = state.windCtrl.getContainer();
  const needle = box.querySelector('.wind-needle');
  if (needle) needle.setAttribute('transform', `rotate(${(dir + 180) % 360} 22 22)`);
  box.querySelector('.wind-speed').textContent = Math.round(speed);
  box.querySelector('.wind-card').textContent = windCardinal(dir);
  box.setAttribute('title', `Wind from ${windCardinal(dir)} · ${Math.round(speed)} km/h`);
}

/* ============================================================
   ANIMATED RAIN RADAR — RainViewer (keyless): past frames +
   short-range nowcast, animated as a looping overlay.
   ============================================================ */
// maxNativeZoom: RainViewer serves real radar tiles only up to a limited zoom
// (≈7, and it varies by region); beyond it every tile is a "Zoom Level Not Supported"
// placeholder. Capping native zoom makes Leaflet upscale the deepest real tile instead.
const radar = { frames: [], layers: {}, current: null, playing: false, timer: null, nowIndex: 0, enabled: true, ctrl: null, colorScheme: 4, maxNativeZoom: 7, opacity: 0.82 };

async function initRadar() {
  try {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const j = await r.json();
    const past = j.radar?.past || [];
    const nowcast = j.radar?.nowcast || [];
    const frames = [...past, ...nowcast];
    if (!frames.length) { el.radarToggle.style.display = 'none'; return; }
    radar.frames = frames.map((f) => ({ time: f.time, url: `${j.host}${f.path}/256/{z}/{x}/{y}/${radar.colorScheme}/1_1.png` }));
    radar.nowIndex = Math.max(0, past.length - 1);
    addRadarControls();
    showFrame(radar.nowIndex);
    playRadar();
  } catch { el.radarToggle.style.display = 'none'; }
}

function frameLabel(i) {
  const t = new Date(radar.frames[i].time * 1000);
  const hhmm = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const tag = i < radar.nowIndex ? 'Past' : i === radar.nowIndex ? 'Now' : 'Forecast';
  return `${tag} · ${hhmm}`;
}

function showFrame(i) {
  if (!radar.frames[i]) return;
  if (!radar.layers[i]) {
    radar.layers[i] = L.tileLayer(radar.frames[i].url, { opacity: 0, tileSize: 256, zIndex: 500, maxNativeZoom: radar.maxNativeZoom, maxZoom: 19, className: 'radar-tiles' }).addTo(state.map);
  }
  if (radar.current != null && radar.current !== i && radar.layers[radar.current]) radar.layers[radar.current].setOpacity(0);
  radar.layers[i].setOpacity(radar.enabled ? radar.opacity : 0);
  radar.current = i;
  const seek = document.getElementById('radarSeek'); if (seek) seek.value = i;
  const time = document.getElementById('radarTime'); if (time) time.textContent = frameLabel(i);
}

function playRadar() {
  if (!radar.frames.length || !radar.enabled) return;
  radar.playing = true;
  clearInterval(radar.timer);
  radar.timer = setInterval(() => showFrame((radar.current + 1) % radar.frames.length), 600);
  updatePlayBtn();
}
function pauseRadar() { radar.playing = false; clearInterval(radar.timer); updatePlayBtn(); }
function updatePlayBtn() { const b = document.getElementById('radarPlay'); if (b) b.textContent = radar.playing ? '❚❚' : '►'; }

function addRadarControls() {
  if (radar.ctrl) return;
  const ctrl = L.control({ position: 'bottomleft' });
  ctrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'radar-ctrl');
    div.innerHTML = `
      <button class="radar-play" id="radarPlay" title="Play / pause">❚❚</button>
      <input type="range" class="radar-seek" id="radarSeek" min="0" max="${radar.frames.length - 1}" value="${radar.nowIndex}" aria-label="Radar time">
      <span class="radar-time" id="radarTime">—</span>
      <span class="radar-legend"><span>Light</span><i class="radar-grad"></i><span>Heavy</span></span>`;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  };
  ctrl.addTo(state.map);
  radar.ctrl = ctrl;
  document.getElementById('radarPlay').addEventListener('click', () => (radar.playing ? pauseRadar() : playRadar()));
  document.getElementById('radarSeek').addEventListener('input', (e) => { pauseRadar(); showFrame(Number(e.target.value)); });
}

function setRadarEnabled(on) {
  radar.enabled = on;
  el.radarToggle.classList.toggle('active', on);
  el.radarToggle.setAttribute('aria-pressed', String(on));
  if (radar.ctrl?.getContainer()) radar.ctrl.getContainer().style.display = on ? '' : 'none';
  if (!on) {
    pauseRadar();
    if (radar.current != null && radar.layers[radar.current]) radar.layers[radar.current].setOpacity(0);
  } else {
    showFrame(radar.current ?? radar.nowIndex);
    playRadar();
  }
}
function setPin(lat, lon, { fly = false } = {}) {
  if (!state.marker) return;
  state.marker.setLatLng([lat, lon]);
  if (fly) state.map.flyTo([lat, lon], Math.max(state.map.getZoom(), 8), { duration: 0.8 });
}
async function onPinDropped(lat, lon) {
  state.pinned = { lat, lon };
  el.savePinBtn.hidden = false;
  el.pinBadgeText.textContent = 'Pinned';
  const place = await reverseGeocode(lat, lon);
  loadLocation({ lat, lon, name: place.name, country: place.country, cc: place.cc, admin: '' }, { moveMap: false });
}

/* ---------- Geolocation ---------- */
function useMyLocation() {
  if (!navigator.geolocation) { loadLocation(DEFAULT_LOCATION); return; }
  el.heroLoading.querySelector('p').textContent = 'Locating you…';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      setPin(lat, lon, { fly: true });
      state.pinned = { lat, lon };
      const place = await reverseGeocode(lat, lon);
      loadLocation({ lat, lon, name: place.name, country: place.country, cc: place.cc, admin: '' }, { moveMap: false });
    },
    () => {
      toast('Location blocked — showing London');
      loadLocation(DEFAULT_LOCATION);
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
  );
}

/* ---------- Search suggestions ---------- */
let searchTimer;
function renderSuggestions(results) {
  state.suggestionData = results;
  state.activeSuggestion = -1;
  if (!results.length) {
    el.suggestions.innerHTML = `<div class="suggestion empty">No matches found</div>`;
  } else {
    el.suggestions.innerHTML = results.map((r, i) => `
      <div class="suggestion" data-i="${i}">
        <span class="s-name">${r.name}</span>
        <span class="s-meta">${[r.admin, r.country].filter(Boolean).join(', ')}</span>
      </div>`).join('');
  }
  el.suggestions.hidden = false;
}
function hideSuggestions() { el.suggestions.hidden = true; state.activeSuggestion = -1; }

function chooseSuggestion(i) {
  const r = state.suggestionData[i];
  if (!r) return;
  el.searchInput.value = '';
  hideSuggestions();
  addCity(r);
  loadLocation(r);
  refreshSavedTemps();
}

/* ---------- Events ---------- */
el.searchInput.addEventListener('input', () => {
  const q = el.searchInput.value.trim();
  clearTimeout(searchTimer);
  if (q.length < 2) { hideSuggestions(); return; }
  searchTimer = setTimeout(async () => {
    try { renderSuggestions(await geocode(q)); }
    catch { hideSuggestions(); }
  }, 280);
});
el.searchInput.addEventListener('keydown', (e) => {
  if (el.suggestions.hidden) return;
  const items = state.suggestionData.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); state.activeSuggestion = Math.min(items - 1, state.activeSuggestion + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); state.activeSuggestion = Math.max(0, state.activeSuggestion - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); chooseSuggestion(state.activeSuggestion < 0 ? 0 : state.activeSuggestion); return; }
  else if (e.key === 'Escape') { hideSuggestions(); return; }
  [...el.suggestions.querySelectorAll('.suggestion')].forEach((n, i) => n.classList.toggle('active', i === state.activeSuggestion));
});
el.searchForm.addEventListener('submit', (e) => { e.preventDefault(); if (!el.suggestions.hidden) chooseSuggestion(state.activeSuggestion < 0 ? 0 : state.activeSuggestion); });
el.suggestions.addEventListener('click', (e) => {
  const node = e.target.closest('.suggestion[data-i]');
  if (node) chooseSuggestion(Number(node.dataset.i));
});
document.addEventListener('click', (e) => {
  if (!el.searchForm.contains(e.target)) hideSuggestions();
});

el.savedList.addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); removeCity(del.dataset.del); return; }
  const city = e.target.closest('.city');
  if (city) {
    const c = state.cities.find((x) => cityKey(x) === city.dataset.key);
    if (c) loadLocation(c);
  }
});

el.daily.addEventListener('click', (e) => {
  const row = e.target.closest('.day[data-day]');
  if (row) selectDay(Number(row.dataset.day));
});
el.daily.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('.day[data-day]');
  if (row) { e.preventDefault(); selectDay(Number(row.dataset.day)); }
});

el.radarToggle.addEventListener('click', () => setRadarEnabled(!radar.enabled));

el.locateBtn.addEventListener('click', useMyLocation);
el.savePinBtn.addEventListener('click', () => {
  if (state.current) { addCity(state.current); refreshSavedTemps(); }
});

/* ---------- Boot ---------- */
/* ============================================================
   SPOTIFY — client-side OAuth (PKCE, no secret / no backend).
   Free account: profile, top tracks + 30-second preview playback.
   Needs the user's own Spotify app Client ID + registered redirect URI.
   ============================================================ */
const SP = { key: 'spotify', scope: 'user-read-private user-read-email user-top-read user-read-recently-played user-read-currently-playing streaming user-read-playback-state user-modify-playback-state' };
const SP_LOGO = '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm4.6 14.4a.62.62 0 01-.86.21c-2.35-1.44-5.3-1.76-8.79-.96a.62.62 0 11-.28-1.22c3.8-.87 7.08-.5 9.72 1.11.3.18.39.57.21.86zm1.23-2.73a.78.78 0 01-1.07.26c-2.69-1.65-6.79-2.13-9.98-1.16a.78.78 0 11-.45-1.49c3.64-1.1 8.16-.57 11.24 1.32.37.22.49.7.26 1.07zm.11-2.85C14.83 8.98 9.4 8.8 6.3 9.74a.94.94 0 11-.54-1.8c3.56-1.08 9.56-.87 13.35 1.38a.94.94 0 11-.96 1.6z"/></svg>';
// Public PKCE Client ID (safe to ship — it's a public identifier, not a secret).
// A user can still override it via the setup panel; stored value wins.
const SP_DEFAULT_CLIENT_ID = '23d530c955d44e7d9a59f6f3303e5eb4';
const spRedirectUri = () => location.origin + location.pathname;
const spGet = (k) => localStorage.getItem(`${SP.key}.${k}`);
const spSet = (k, v) => localStorage.setItem(`${SP.key}.${k}`, v);
const spDel = (k) => localStorage.removeItem(`${SP.key}.${k}`);
const spClientId = () => spGet('clientId') || SP_DEFAULT_CLIENT_ID;

// Verified Spotify "Top 50 – {Country}" chart playlists, keyed by ISO alpha-2.
const SPOTIFY_COUNTRY_PLAYLIST = {
  SG: '37i9dQZEVXbK4gjvS1FjPY', MY: '37i9dQZEVXbJlfUljuZExa', JP: '37i9dQZEVXbKXQ4mDTEBXq',
  US: '37i9dQZEVXbLRQDuF5jeBp', GB: '37i9dQZEVXbLnolsZ8PSNw', ID: '37i9dQZEVXbObFQZ3JLcXt',
  IN: '37i9dQZEVXbLZ52XmnySJg', AU: '37i9dQZEVXbJPcfkRz0wJ0', TW: '37i9dQZEVXbMnZEatlMSiu',
  TH: '37i9dQZEVXbMnz8KIWsvf9', PH: '37i9dQZEVXbNBz9cRCSFkY', VN: '37i9dQZEVXbLdGSmz6xilI',
  KR: '37i9dQZEVXbNxXF4SkHj9F', HK: '37i9dQZEVXbLwpL8TjsxOG', FR: '37i9dQZEVXbIPWwFssbupI',
  DE: '37i9dQZEVXbJiZcmkrIHGU', IT: '37i9dQZEVXbIQnj7RRhdSX', ES: '37i9dQZEVXbNFJfN1Vw8d9',
  NL: '37i9dQZEVXbKCF6dqVpDkS', CA: '37i9dQZEVXbKj23U1GF4IR', BR: '37i9dQZEVXbMXbN3EUUhlg',
  MX: '37i9dQZEVXbO3qyFxbkOE1',
};
const SPOTIFY_GLOBAL_PLAYLIST = '37i9dQZEVXbMDoHDwVN2tF';
let spEmbedToken = 0;

// Point the embed at a playlist that reflects the selected place.
async function updateSpotifyEmbed(place) {
  const iframe = document.getElementById('spotifyEmbed');
  if (!iframe || !place) return;
  const token = ++spEmbedToken;
  const label = document.getElementById('spotifyNow');
  const cc = (place.cc || '').toUpperCase();
  let playlistId = SPOTIFY_COUNTRY_PLAYLIST[cc] || SPOTIFY_GLOBAL_PLAYLIST;

  // Logged in → find a good city playlist via Search; prefer Spotify-curated
  // ("This Is…/vibes") editorial playlists over random user ones for quality.
  if (spGet('token') && Date.now() < Number(spGet('expires'))) {
    try {
      const res = await spApi(`search?q=${enc(place.name)}&type=playlist&limit=10${cc ? `&market=${cc}` : ''}`);
      const items = (res?.playlists?.items || []).filter((p) => p && p.id);
      const nameHit = (re) => items.find((p) => re.test(p.name || ''));
      const hit = items.find((p) => p.owner?.id === 'spotify')      // editorial, curated
        || nameHit(new RegExp(`(this is|sound of|essentials|vibes).*${place.name}|${place.name}.*(vibes|essentials|hits)`, 'i'))
        || items[0];                                                 // fallback: top result
      if (hit) playlistId = hit.id;
    } catch { /* keep country/global chart */ }
    if (token !== spEmbedToken) return;
  }

  iframe.src = `https://open.spotify.com/embed/playlist/${playlistId}?utm_source=generator`;
  if (label) {
    label.textContent = '';
    try {
      const o = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/playlist/${playlistId}`);
      if (o.ok && token === spEmbedToken) { const j = await o.json(); label.textContent = `🎵 ${j.title} · picked for ${place.name}`; }
    } catch { /* label optional */ }
  }
}
let spAudio = null; // shared <audio> for 30s previews

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function spChallenge(verifier) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}
async function spotifyLogin() {
  const input = document.getElementById('spClientId');
  const clientId = ((input?.value || '').trim()) || spClientId();
  // Spotify Client IDs are 32 hex characters — validate before redirecting so the user
  // gets a clear message instead of Spotify's "client_id: Invalid" error page.
  if (!/^[0-9a-f]{32}$/i.test(clientId)) {
    const setup = document.querySelector('details.sp-setup');
    if (setup) setup.open = true;
    if (input) { input.focus(); input.select?.(); }
    toast(clientId ? 'That Client ID looks wrong — it should be 32 characters from the Dashboard (not the secret)' : 'Enter your Spotify Client ID first');
    return;
  }
  spSet('clientId', clientId);
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  spSet('verifier', verifier);
  const p = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: spRedirectUri(),
    code_challenge_method: 'S256', code_challenge: await spChallenge(verifier), scope: SP.scope,
  });
  location.href = `https://accounts.spotify.com/authorize?${p}`;
}
async function spotifyHandleRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (params.get('error')) { history.replaceState({}, '', spRedirectUri()); toast('Spotify authorisation cancelled'); return; }
  if (!code) return;
  history.replaceState({}, '', spRedirectUri()); // clean ?code from the URL
  try {
    const body = new URLSearchParams({
      client_id: spClientId(), grant_type: 'authorization_code', code,
      redirect_uri: spRedirectUri(), code_verifier: spGet('verifier'),
    });
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const j = await r.json();
    if (!j.access_token) throw new Error('no token');
    spSet('token', j.access_token);
    spSet('expires', Date.now() + (j.expires_in - 60) * 1000);
    if (j.refresh_token) spSet('refresh', j.refresh_token);
  } catch { toast('Spotify sign-in failed'); }
}
async function spotifyRefresh() {
  const refresh = spGet('refresh'), clientId = spClientId();
  if (!refresh || !clientId) return false;
  try {
    const body = new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refresh });
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const j = await r.json();
    if (!j.access_token) return false;
    spSet('token', j.access_token);
    spSet('expires', Date.now() + (j.expires_in - 60) * 1000);
    if (j.refresh_token) spSet('refresh', j.refresh_token);
    return true;
  } catch { return false; }
}
async function spApi(path) {
  const r = await fetch(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${spGet('token')}` } });
  if (!r.ok) throw new Error(`spotify ${r.status}`);
  return r.json();
}
function spotifyDisconnect() {
  ['token', 'expires', 'refresh', 'verifier'].forEach(spDel);
  if (spAudio) { spAudio.pause(); spAudio = null; }
  renderSpotify();
}

/* ---- Web Playback SDK (Premium only) for full in-browser playback ---- */
let spPlayer = null, spDeviceId = null, spSdkLoading = null;
function loadSpotifySDK() {
  if (window.Spotify) return Promise.resolve(true);
  if (spSdkLoading) return spSdkLoading;
  spSdkLoading = new Promise((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve(true);
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js'; s.async = true;
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
    setTimeout(() => resolve(!!window.Spotify), 8000);
  });
  return spSdkLoading;
}
async function spInitPlayer() {
  if (spPlayer) return true;
  if (!(await loadSpotifySDK()) || !window.Spotify) return false;
  spPlayer = new Spotify.Player({ name: 'My Travel Pocket App', volume: 0.6, getOAuthToken: (cb) => cb(spGet('token')) });
  spPlayer.addListener('ready', ({ device_id }) => { spDeviceId = device_id; });
  spPlayer.addListener('not_ready', () => { spDeviceId = null; });
  spPlayer.addListener('player_state_changed', updateSpNowPlaying);
  spPlayer.addListener('account_error', () => toast('Full playback needs Spotify Premium'));
  spPlayer.addListener('authentication_error', () => toast('Spotify auth error — reconnect'));
  return spPlayer.connect();
}
async function spPlayTrack(uri, btn) {
  try {
    if (!spDeviceId) { await spInitPlayer(); await new Promise((r) => setTimeout(r, 1200)); }
    if (!spDeviceId) { toast('Player connecting — tap again in a moment'); return; }
    const r = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spDeviceId}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${spGet('token')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    });
    if (r.status === 403) toast('Full playback needs Spotify Premium');
  } catch { toast('Playback failed'); }
}
function updateSpNowPlaying(state) {
  const bar = document.getElementById('spNowPlaying');
  if (!bar) return;
  const t = state?.track_window?.current_track;
  bar.innerHTML = t ? `<span class="sp-np-ic">${state.paused ? '❚❚' : '♪'}</span><span class="sp-np-text">${t.name} — ${t.artists.map((a) => a.name).join(', ')}</span><button class="sp-np-toggle" id="spToggle">${state.paused ? '▶' : '❚❚'}</button>` : '';
}

async function renderSpotify() {
  if (!el.spotifyAccount) return;
  const hasToken = spGet('token') && Date.now() < Number(spGet('expires'));
  if (!hasToken) {
    if (spGet('refresh') && await spotifyRefresh()) return renderSpotify();
    const clientId = spClientId();
    const validId = /^[0-9a-f]{32}$/i.test(clientId);
    el.spotifyAccount.innerHTML = `
      <div class="sp-connect">
        <div class="sp-free-note">🎧 Showing <b>Spotify Free</b> — 30-second previews. Log in for playback tied to your account (Premium plays full tracks).</div>
        <button id="spConnectBtn" class="sp-login">${SP_LOGO}<span>Log in with Spotify</span></button>
        <details class="sp-setup">
          <summary>Setup &amp; troubleshooting</summary>
          <p class="sp-hint">The app's Client ID is preconfigured. For login to work, that Spotify app must have <b>this exact Redirect URI</b> registered (Dashboard → Edit settings → Redirect URIs):</p>
          <div class="sp-redirect">Redirect URI · <code>${spRedirectUri()}</code></div>
          <p class="sp-hint">Override the Client ID with your own app if you prefer:</p>
          <input id="spClientId" class="sp-input" placeholder="Spotify Client ID (32 hex characters)" value="${clientId}" spellcheck="false" autocomplete="off">
          <p class="sp-hint sp-warn">Getting “client_id: Invalid”? The app doesn’t exist or the ID is wrong. Getting a redirect error? The Redirect URI above must be registered in the Spotify app <b>exactly</b> (Spotify requires <code>127.0.0.1</code>, not <code>localhost</code>, for local http).</p>
        </details>
      </div>`;
    return;
  }
  el.spotifyAccount.innerHTML = '<div class="sp-loading">Loading your Spotify…</div>';
  try {
    const [me, top] = await Promise.all([spApi('me'), spApi('me/top/tracks?limit=5&time_range=short_term')]);
    const premium = me.product === 'premium';
    const avatar = me.images?.[0]?.url;
    const tracks = (top.items || []).map((t, i) => {
      const art = t.album?.images?.slice(-1)[0]?.url || '';
      const artists = (t.artists || []).map((a) => a.name).join(', ');
      const btn = premium
        ? `<button class="sp-play" data-uri="${t.uri}" title="Play full track">▶</button>`
        : (t.preview_url ? `<button class="sp-play" data-preview="${t.preview_url}" title="Play 30s preview">▶</button>` : `<a class="sp-play" href="${t.external_urls?.spotify}" target="_blank" rel="noopener" title="Open in Spotify">↗</a>`);
      return `<div class="sp-track">
        <span class="sp-rank">${i + 1}</span>
        ${art ? `<img class="sp-art" src="${art}" alt="">` : ''}
        <span class="sp-track-text"><span class="sp-track-name">${t.name}</span><span class="sp-track-artist">${artists}</span></span>
        ${btn}
      </div>`;
    }).join('');
    el.spotifyAccount.innerHTML = `
      <div class="sp-profile">
        ${avatar ? `<img class="sp-avatar" src="${avatar}" alt="">` : ''}
        <div class="sp-profile-text"><span class="sp-name">${me.display_name || 'Spotify user'}</span><span class="sp-plan">${premium ? 'Premium · full playback' : 'Free · 30s previews'}</span></div>
        <button id="spDisconnect" class="sp-disconnect">Log out</button>
      </div>
      ${premium ? '<div class="sp-nowplaying" id="spNowPlaying"></div>' : ''}
      <div class="sp-tracks-label">Your top tracks</div>
      <div class="sp-tracks">${tracks || '<div class="sp-hint">No top tracks yet — listen on Spotify and check back.</div>'}</div>`;
    if (premium) spInitPlayer(); // connect the Web Playback SDK device
    if (state.current) updateSpotifyEmbed(state.current); // now logged in → city-specific playlist
  } catch {
    spotifyDisconnect();
    toast('Spotify session expired — reconnect');
  }
}

/* Delegated controls for the Spotify account panel */
el.spotifyAccount.addEventListener('click', (e) => {
  if (e.target.closest('#spConnectBtn')) { spotifyLogin(); return; }
  if (e.target.closest('#spDisconnect')) { spotifyDisconnect(); return; }
  if (e.target.closest('#spToggle')) { if (spPlayer) spPlayer.togglePlay(); return; }
  const full = e.target.closest('.sp-play[data-uri]');
  if (full) { spPlayTrack(full.dataset.uri, full); return; }
  const play = e.target.closest('.sp-play[data-preview]');
  if (play) {
    const url = play.dataset.preview;
    if (spAudio && !spAudio.paused && spAudio.dataset.url === url) { spAudio.pause(); play.textContent = '▶'; return; }
    if (spAudio) spAudio.pause();
    document.querySelectorAll('.sp-play[data-preview]').forEach((b) => { b.textContent = '▶'; });
    spAudio = new Audio(url); spAudio.dataset.url = url; spAudio.volume = 0.7;
    spAudio.play().then(() => { play.textContent = '❚❚'; }).catch(() => toast('Preview unavailable'));
    spAudio.onended = () => { play.textContent = '▶'; };
  }
});

/* ============================================================
   AIR QUALITY — live US AQI from Open-Meteo (keyless), shown in the hero.
   ============================================================ */
const AQI_LEVELS = [
  [50, 'Good', 'aqi-good'], [100, 'Moderate', 'aqi-mod'], [150, 'Unhealthy for sensitive', 'aqi-usg'],
  [200, 'Unhealthy', 'aqi-bad'], [300, 'Very unhealthy', 'aqi-vbad'], [Infinity, 'Hazardous', 'aqi-haz'],
];
let aqiToken = 0;
async function updateAirQuality(place) {
  if (!el.heroAqi) return;
  const token = ++aqiToken;
  el.heroAqi.hidden = true;
  try {
    const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.lat}&longitude=${place.lon}&current=us_aqi&timezone=auto`);
    const aqi = (await r.json()).current?.us_aqi;
    if (token !== aqiToken || aqi == null) return;
    const [, label, cls] = AQI_LEVELS.find((l) => aqi <= l[0]);
    el.heroAqi.className = `aqi-badge ${cls}`;
    el.heroAqi.textContent = `AQI ${Math.round(aqi)} · ${label}`;
    el.heroAqi.hidden = false;
  } catch { /* leave hidden */ }
}

/* ============================================================
   PACKING SUGGESTIONS — derived from the destination's 7-day forecast.
   ============================================================ */
function renderPacking(data, place) {
  if (!el.packingBody) return;
  const d = data && data.daily;
  if (!d) { el.packingBody.innerHTML = '<div class="cycling-empty"><div class="cycling-empty-ic">🎒</div><div><strong>Forecast unavailable</strong><span>Packing tips appear once the forecast loads.</span></div></div>'; return; }
  const maxT = Math.max(...d.temperature_2m_max);
  const minT = Math.min(...d.temperature_2m_min);
  const uvMax = Math.max(...(d.uv_index_max || [0]));
  const rainy = (d.weather_code || []).some((c) => c >= 51) || (data.hourly?.precipitation_probability || []).some((p) => p >= 50);
  const items = [];
  if (minT < 0) items.push(['🧥', 'Heavy winter coat, gloves & hat', `Freezing — lows ~${Math.round(minT)}°C`]);
  else if (minT < 10) items.push(['🧥', 'Warm jacket & layers', `Cold — lows ~${Math.round(minT)}°C`]);
  else if (minT < 18) items.push(['🧥', 'A light jacket or sweater', `Cooler evenings (~${Math.round(minT)}°C)`]);
  if (maxT >= 30) items.push(['👕', 'Light, breathable clothing', `Hot — highs ~${Math.round(maxT)}°C`]);
  else if (maxT >= 22) items.push(['👕', 'Comfortable warm-weather clothes', `Pleasant highs ~${Math.round(maxT)}°C`]);
  if (rainy) items.push(['☔', 'Umbrella or rain jacket', 'Rain in the forecast']);
  if (uvMax >= 6) items.push(['🧴', 'Sunscreen, sunglasses & a hat', `Strong sun (UV ${Math.round(uvMax)})`]);
  let cc = (place.cc || '').toUpperCase();
  if (!ESSENTIALS[cc] && place.country) cc = NAME_TO_CC[place.country.toLowerCase()] || cc;
  if (ESSENTIALS[cc]) items.push(['🔌', `Power adapter — ${ESSENTIALS[cc].plug}, ${ESSENTIALS[cc].volt}`, 'Matches this country’s sockets']);
  items.push(['🧳', 'Passport, cards & any medication', 'Trip essentials']);
  el.packingBody.innerHTML = `<div class="cycling-note">Packing for ${place.name} · next 7 days</div>${items.map(([ic, t, sub]) => `<div class="pack-item"><span class="pack-ic">${ic}</span><div class="pack-info"><div class="pack-t">${t}</div><div class="pack-sub">${sub}</div></div></div>`).join('')}`;
}

/* ============================================================
   COUNTRY ESSENTIALS — plugs, water, driving side, tipping, phrases.
   { plug, volt, water: safe|bottled|treated, drive: L|R, tip, hello, thanks }
   ============================================================ */
const ESSENTIALS = {
  SG: { plug: 'Type G', volt: '230V', water: 'safe', drive: 'L', tip: 'Not expected (service charge added)', hello: 'Hello', thanks: 'Thank you' },
  MY: { plug: 'Type G', volt: '240V', water: 'bottled', drive: 'L', tip: 'Optional; round up', hello: 'Helo', thanks: 'Terima kasih' },
  TH: { plug: 'Type A/B/C', volt: '230V', water: 'bottled', drive: 'L', tip: 'Optional; ~10%', hello: 'Sawasdee', thanks: 'Khop khun' },
  ID: { plug: 'Type C/F', volt: '230V', water: 'bottled', drive: 'L', tip: 'Optional; round up', hello: 'Halo', thanks: 'Terima kasih' },
  VN: { plug: 'Type A/C/F', volt: '220V', water: 'bottled', drive: 'R', tip: 'Optional; round up', hello: 'Xin chào', thanks: 'Cảm ơn' },
  PH: { plug: 'Type A/B/C', volt: '220V', water: 'bottled', drive: 'R', tip: 'Optional; ~10%', hello: 'Kumusta', thanks: 'Salamat' },
  JP: { plug: 'Type A/B', volt: '100V', water: 'safe', drive: 'L', tip: 'Not customary — don’t tip', hello: 'Konnichiwa', thanks: 'Arigatō' },
  KR: { plug: 'Type C/F', volt: '220V', water: 'safe', drive: 'R', tip: 'Not expected', hello: 'Annyeong', thanks: 'Gamsahamnida' },
  CN: { plug: 'Type A/I', volt: '220V', water: 'bottled', drive: 'R', tip: 'Not expected', hello: 'Nǐ hǎo', thanks: 'Xièxie' },
  HK: { plug: 'Type G', volt: '220V', water: 'safe', drive: 'L', tip: 'Optional; round up', hello: 'Néih hóu', thanks: 'Mgoi' },
  TW: { plug: 'Type A/B', volt: '110V', water: 'bottled', drive: 'R', tip: 'Not expected', hello: 'Nǐ hǎo', thanks: 'Xièxie' },
  IN: { plug: 'Type C/D/M', volt: '230V', water: 'bottled', drive: 'L', tip: '~5–10%', hello: 'Namaste', thanks: 'Dhanyavaad' },
  AE: { plug: 'Type G', volt: '230V', water: 'treated', drive: 'R', tip: '10–15% common', hello: 'Marhaba', thanks: 'Shukran' },
  AU: { plug: 'Type I', volt: '230V', water: 'safe', drive: 'L', tip: 'Not expected (optional)', hello: 'G’day', thanks: 'Thanks' },
  NZ: { plug: 'Type I', volt: '230V', water: 'safe', drive: 'L', tip: 'Not expected', hello: 'Kia ora', thanks: 'Thanks' },
  GB: { plug: 'Type G', volt: '230V', water: 'safe', drive: 'L', tip: '10–12.5% (often included)', hello: 'Hello', thanks: 'Thanks' },
  IE: { plug: 'Type G', volt: '230V', water: 'safe', drive: 'L', tip: '10–15%', hello: 'Hello', thanks: 'Go raibh maith agat' },
  FR: { plug: 'Type C/E', volt: '230V', water: 'safe', drive: 'R', tip: 'Service included; round up', hello: 'Bonjour', thanks: 'Merci' },
  IT: { plug: 'Type C/F/L', volt: '230V', water: 'safe', drive: 'R', tip: 'Coperto included; round up', hello: 'Buongiorno', thanks: 'Grazie' },
  ES: { plug: 'Type C/F', volt: '230V', water: 'safe', drive: 'R', tip: 'Round up; small tip', hello: 'Hola', thanks: 'Gracias' },
  DE: { plug: 'Type C/F', volt: '230V', water: 'safe', drive: 'R', tip: 'Round up ~5–10%', hello: 'Hallo', thanks: 'Danke' },
  CH: { plug: 'Type J', volt: '230V', water: 'safe', drive: 'R', tip: 'Service included; round up', hello: 'Grüezi', thanks: 'Danke' },
  NL: { plug: 'Type C/F', volt: '230V', water: 'safe', drive: 'R', tip: 'Round up ~5–10%', hello: 'Hallo', thanks: 'Dank je' },
  AT: { plug: 'Type C/F', volt: '230V', water: 'safe', drive: 'R', tip: 'Round up ~5–10%', hello: 'Servus', thanks: 'Danke' },
  BE: { plug: 'Type C/E', volt: '230V', water: 'safe', drive: 'R', tip: 'Service included', hello: 'Hallo', thanks: 'Bedankt' },
  PT: { plug: 'Type C/F', volt: '230V', water: 'safe', drive: 'R', tip: 'Round up ~5–10%', hello: 'Olá', thanks: 'Obrigado' },
  GR: { plug: 'Type C/F', volt: '230V', water: 'safe', drive: 'R', tip: 'Round up ~5–10%', hello: 'Yassou', thanks: 'Efcharistó' },
  CZ: { plug: 'Type C/E', volt: '230V', water: 'safe', drive: 'R', tip: '~10%', hello: 'Ahoj', thanks: 'Děkuji' },
  PL: { plug: 'Type C/E', volt: '230V', water: 'safe', drive: 'R', tip: '~10%', hello: 'Cześć', thanks: 'Dziękuję' },
  SE: { plug: 'Type C/F', volt: '230V', water: 'safe', drive: 'R', tip: 'Service included', hello: 'Hej', thanks: 'Tack' },
  NO: { plug: 'Type C/F', volt: '230V', water: 'safe', drive: 'R', tip: 'Round up', hello: 'Hei', thanks: 'Takk' },
  DK: { plug: 'Type C/K', volt: '230V', water: 'safe', drive: 'R', tip: 'Service included', hello: 'Hej', thanks: 'Tak' },
  FI: { plug: 'Type C/F', volt: '230V', water: 'safe', drive: 'R', tip: 'Service included', hello: 'Hei', thanks: 'Kiitos' },
  TR: { plug: 'Type C/F', volt: '230V', water: 'bottled', drive: 'R', tip: '~5–10%', hello: 'Merhaba', thanks: 'Teşekkürler' },
  EG: { plug: 'Type C/F', volt: '220V', water: 'bottled', drive: 'R', tip: '~10% (baksheesh)', hello: 'Ahlan', thanks: 'Shukran' },
  US: { plug: 'Type A/B', volt: '120V', water: 'safe', drive: 'R', tip: '15–20% expected', hello: 'Hi', thanks: 'Thanks' },
  CA: { plug: 'Type A/B', volt: '120V', water: 'safe', drive: 'R', tip: '15–20% expected', hello: 'Hi', thanks: 'Thanks' },
  MX: { plug: 'Type A/B', volt: '127V', water: 'bottled', drive: 'R', tip: '10–15%', hello: 'Hola', thanks: 'Gracias' },
  BR: { plug: 'Type N/C', volt: '127/220V', water: 'bottled', drive: 'R', tip: '10% (often included)', hello: 'Olá', thanks: 'Obrigado' },
  ZA: { plug: 'Type M/N', volt: '230V', water: 'safe', drive: 'L', tip: '10–15%', hello: 'Hello', thanks: 'Ngiyabonga' },
  SA: { plug: 'Type G', volt: '230V', water: 'bottled', drive: 'R', tip: 'Not expected (optional)', hello: 'Marhaba', thanks: 'Shukran' },
  QA: { plug: 'Type G', volt: '240V', water: 'treated', drive: 'R', tip: 'Optional', hello: 'Marhaba', thanks: 'Shukran' },
  IL: { plug: 'Type H/C', volt: '230V', water: 'safe', drive: 'R', tip: '~10–12%', hello: 'Shalom', thanks: 'Toda' },
};
function renderEssentials(place) {
  if (!el.essentialsBody) return;
  let cc = (place.cc || '').toUpperCase();
  if (!ESSENTIALS[cc] && place.country) cc = NAME_TO_CC[place.country.toLowerCase()] || cc;
  const e = ESSENTIALS[cc];
  if (!e) {
    el.essentialsBody.innerHTML = `<div class="cycling-empty"><div class="cycling-empty-ic">🧳</div><div><strong>Not curated for ${place.name}</strong><span>Country essentials aren’t listed for this location yet.</span></div></div>`;
    return;
  }
  const water = e.water === 'safe' ? '<span class="ess-ok">Tap water is safe to drink</span>'
    : e.water === 'treated' ? 'Tap is treated; locals prefer bottled'
    : '<span class="ess-warn">Drink bottled water</span>';
  const drive = e.drive === 'L' ? 'Drives on the left ⬅' : 'Drives on the right ➡';
  const cell = (ic, k, v) => `<div class="ess"><span class="ess-ic">${ic}</span><div class="ess-info"><div class="ess-k">${k}</div><div class="ess-v">${v}</div></div></div>`;
  el.essentialsBody.innerHTML = `<div class="ess-grid">
    ${cell('🔌', 'Power', `${e.plug} · ${e.volt}`)}
    ${cell('🚰', 'Tap water', water)}
    ${cell('🚗', 'Driving', drive)}
    ${cell('💵', 'Tipping', e.tip)}
    <div class="ess ess-span"><span class="ess-ic">🗣️</span><div class="ess-info"><div class="ess-k">Say hello / thanks</div><div class="ess-v">“${e.hello}” · “${e.thanks}”</div></div></div>
  </div>`;
}

/* ============================================================
   WORKDAY OFFICES — from workday.com/company/about-workday/contact-us
   Matched by city, then by country. { c: city, cc, a: address, p: phone, hq }
   ============================================================ */
const WORKDAY_OFFICES = [
  // Asia Pacific
  { c: 'Singapore', cc: 'SG', a: '1 Wallich Street, #08-02 Guoco Tower, Singapore 078881', p: '+65 6800 0600' },
  { c: 'Bangkok', cc: 'TH', a: '28/F One Bangkok Tower 4, Witthayu Rd, Lumphini, Pathumwan, Bangkok 10330' },
  { c: 'Jakarta', cc: 'ID', a: 'Sequis Tower, Level 17, Jl. Jend. Sudirman kav 71, Jakarta 12190' },
  { c: 'Kuala Lumpur', cc: 'MY', a: 'Level 8, Centrepoint North, Mid Valley City, Lingkaran Syed Putra, 58000 KL' },
  { c: 'Auckland', cc: 'NZ', a: 'Level 2, 152 Fanshawe St, Westhaven, Auckland 1010', p: '+64 9 980 7100' },
  { c: 'Brisbane', cc: 'AU', a: 'Level 6, 88 Tribune Street, Brisbane, QLD 4101' },
  { c: 'Chennai', cc: 'IN', a: 'Campus 1C, Millenia Business Park, Phase 1, MGR Salai, Perungudi, Chennai 600096' },
  { c: 'Da Nang', cc: 'VN', a: '2nd–3rd Floor, Viettronimex Building, 460 Nguyen Huu Tho St, Cam Le, Da Nang' },
  { c: 'Ho Chi Minh City', cc: 'VN', a: '9th Floor, Alpha Tower, 151-153 Nguyen Dinh Chieu St, Xuan Hoa Ward' },
  { c: 'Hong Kong', cc: 'HK', a: 'Suite 3301-04, 33/F Tower One Times Square, 1 Matheson St, Causeway Bay' },
  { c: 'Melbourne', cc: 'AU', a: 'Level 24, 360 Collins St, Melbourne, Victoria 3000' },
  { c: 'Mumbai', cc: 'IN', a: '4th Floor, Godrej BKC, Plot C-68, G Block BKC, Bandra East, Mumbai 400051' },
  { c: 'Osaka', cc: 'JP', a: '19F Osaka Umeda Twin Towers North, 8-1 Kakudacho, Kita-Ku, Osaka 530-0017' },
  { c: 'Taipei', cc: 'TW', a: 'Level 34, Taipei Nanshan Plaza, 100 Songren Rd, Xinyi District, Taipei 11073' },
  { c: 'Pune', cc: 'IN', a: '1st–2nd Floor, Tower A, Panchshil Business Park, Vimannagar, Pune 411014' },
  { c: 'Tokyo', cc: 'JP', a: '20F Roppongi Hills Mori Tower, 6-10-1 Roppongi, Minato-ku, Tokyo 106-6120' },
  { c: 'Sydney', cc: 'AU', a: 'Level 12, 100 Pacific Highway, North Sydney, NSW 2060' },
  { c: 'Seoul', cc: 'KR', a: '14F Gangnam N Tower, 129 Teheran-ro, Gangnam-gu, Seoul 06133', p: '+82 70 4784 4300' },
  // Americas
  { c: 'Pleasanton', cc: 'US', a: '6110 Stoneridge Mall Road, Pleasanton, CA 94588', p: '+1 925 951 9000', hq: true },
  { c: 'Atlanta', cc: 'US', a: '3350 Peachtree Road NE, Suite 1000, Atlanta, GA 30326' },
  { c: 'Austin', cc: 'US', a: '3815 S. Capital of Texas Hwy, Suite 500, Austin, TX 78704' },
  { c: 'Beaverton', cc: 'US', a: '4145 SW Watson Avenue, Suite 500, Beaverton, OR 97005' },
  { c: 'Boston', cc: 'US', a: '33 Arch Street, Suite 2200, Boston, MA 02110' },
  { c: 'Boulder', cc: 'US', a: '4900 Pearl East Circle, Suite 100, Boulder, CO 80301' },
  { c: 'Chicago', cc: 'US', a: '111 W. Jackson Boulevard, Suite 2100, Chicago, IL 60604' },
  { c: 'Denver', cc: 'US', a: '1001 17th Street, Suite 640, Denver, CO 80202' },
  { c: 'Minneapolis', cc: 'US', a: '729 N Washington Ave, Suite 600, Minneapolis, MN 55401' },
  { c: 'New York', cc: 'US', a: '350 5th Avenue, Suite 4900, New York, NY 10118' },
  { c: 'Salt Lake City', cc: 'US', a: '2855 East Cottonwood Pkwy, Suite 300, Salt Lake City, UT 84121' },
  { c: 'San Francisco', cc: 'US', a: '160 Spear Street, Suite 1700, San Francisco, CA 94105' },
  { c: 'Santa Clara', cc: 'US', a: '5451 Great America Pkwy, Suite 401, Santa Clara, CA 95054' },
  { c: 'Scottsdale', cc: 'US', a: '6330 East Thomas Road, #200, Scottsdale, AZ 85251' },
  { c: 'Seattle', cc: 'US', a: '601 Union Street, Suite 3320, Seattle, WA 98101' },
  { c: 'Washington', cc: 'US', a: '300 New Jersey Avenue NW, Washington, DC 20001' },
  { c: 'Montreal', cc: 'CA', a: '3 Place Ville Marie, Suite 400, Montréal, QC H3B 2E3' },
  { c: 'Toronto', cc: 'CA', a: '200 Wellington Street West, Suite 701, Toronto, ON M5V 3C7' },
  { c: 'Vancouver', cc: 'CA', a: '601 W. Hastings, Suite 2500, Vancouver, BC V6B 1M8' },
  { c: 'Mexico City', cc: 'MX', a: 'Blvd. Miguel de Cervantes Saavedra 252, 5th Floor, Granada, 11520 CDMX' },
  // Europe
  { c: 'Amsterdam', cc: 'NL', a: 'Gustav Mahlerplein 82, 1082 MA Amsterdam', p: '+31 20 708 6000' },
  { c: 'Berlin', cc: 'DE', a: 'Leipziger Platz 18, 10117 Berlin' },
  { c: 'Copenhagen', cc: 'DK', a: 'Bredgade 6, Copenhagen K 1260' },
  { c: 'Dublin', cc: 'IE', a: 'Kings Building, 152-155 Church Street, Dublin 7, D07 A0TN', p: '+353 1 241 9900' },
  { c: 'Helsinki', cc: 'FI', a: 'Epicenter, Mikonkatu 9, 00100 Helsinki' },
  { c: 'London', cc: 'GB', a: '7th Floor, 1 Finsbury Avenue, London EC2M 2PF', p: '+44 20 7150 6200' },
  { c: 'Madrid', cc: 'ES', a: 'Torre Emperador, Paseo de la Castellana 259D, Planta 21N, Madrid 28046' },
  { c: 'Milan', cc: 'IT', a: 'Via San Marco 21, Milan 20121' },
  { c: 'Munich', cc: 'DE', a: 'Streitfeldstrasse 19, 81673 Munich', p: '+49 89 550 565 000' },
  { c: 'Oslo', cc: 'NO', a: 'Dronning Eufemias Gate 16, 7th Floor, 0191 Oslo' },
  { c: 'Paris', cc: 'FR', a: '7-11 boulevard Haussmann, 75009 Paris', p: '+33 1 73 00 09 00' },
  { c: 'Prague', cc: 'CZ', a: 'Pernerova 727/40a, 186 00 Prague 8' },
  { c: 'Stockholm', cc: 'SE', a: 'Östra Järnvägsgatan 27, 9th floor, 111 20 Stockholm' },
  { c: 'Warsaw', cc: 'PL', a: 'Chmielna 73, 00-801 Warsaw' },
  { c: 'Zurich', cc: 'CH', a: 'Utoquai 55, 8008 Zurich' },
  // Africa & Middle East
  { c: 'Johannesburg', cc: 'ZA', a: 'WeWork, 155 West Street, Sandton, Johannesburg 2031' },
  { c: 'Dubai', cc: 'AE', a: 'DIC Building 09, Unit 220-221, Level 2, Dubai Internet City' },
  { c: 'Riyadh', cc: 'SA', a: 'KAFD 4.07, Al Aqueeq District, Riyadh' },
  { c: 'Tel Aviv', cc: 'IL', a: "13 Ha'arbaa Street, Tel Aviv-Yafo 6473913" },
];
const WORKDAY_CONTACT_URL = 'https://www.workday.com/en-sg/company/about-workday/contact-us.html';
function renderWorkdayOffice(place) {
  if (!el.workdayBody) return;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const key = normCity(place.name);
  const cc = (place.cc || '').toUpperCase();
  const card = (o) => {
    const maps = `https://www.google.com/maps/search/?api=1&query=${enc(`Workday, ${o.a}`)}`;
    return `<div class="wd-office wd-clickable" role="button" tabindex="0" data-a="${attrEsc(o.a)}" data-c="${attrEsc(o.c)}" title="Show the ${attrEsc(o.c)} office on the map">
      <div class="wd-pin">🏢</div>
      <div class="wd-info">
        <div class="wd-name">${esc(o.c)}${o.hq ? ' <span class="wd-hq">HQ</span>' : ''} <span class="wd-map-hint">📍</span></div>
        <div class="wd-addr">${esc(o.a)}</div>
        ${o.p ? `<div class="wd-phone">☎ ${esc(o.p)}</div>` : ''}
        <a class="tv-inline-link" target="_blank" rel="noopener" href="${maps}">Open in Maps →</a>
      </div>
    </div>`;
  };
  const cityHit = WORKDAY_OFFICES.find((o) => normCity(o.c) === key);
  if (cityHit) { el.workdayBody.innerHTML = `<div class="cycling-note">Workday office in ${esc(place.name)}</div>${card(cityHit)}`; return; }
  const inCountry = cc ? WORKDAY_OFFICES.filter((o) => o.cc === cc) : [];
  if (inCountry.length) {
    const shown = inCountry.slice(0, 8);
    el.workdayBody.innerHTML = `<div class="cycling-note">Workday offices in ${esc(place.country || 'this country')}</div>${shown.map((o) => card(o)).join('')}${inCountry.length > shown.length ? `<div class="wd-more"><a class="tv-inline-link" target="_blank" rel="noopener" href="${WORKDAY_CONTACT_URL}">+${inCountry.length - shown.length} more offices →</a></div>` : ''}`;
    return;
  }
  el.workdayBody.innerHTML = `<div class="cycling-empty">
    <div class="cycling-empty-ic">🏢</div>
    <div><strong>No Workday office in ${esc(place.name)}</strong><span>No listed office for this location.</span></div>
    <a class="tv-inline-link" target="_blank" rel="noopener" href="${WORKDAY_CONTACT_URL}">See all Workday offices →</a>
  </div>`;
}
// Click a Workday office card → geocode its address and pin it on the map.
async function showWorkdayOnMap(addr, city) {
  const label = `Workday ${city}`;
  toast(`Locating ${label}…`);
  const geo = async (q) => {
    try { const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${enc(q)}&format=json&limit=1`); const j = await r.json(); return j[0]; }
    catch { return null; }
  };
  // Clean floor/unit/suite clutter that confuses geocoders, then try the landmark
  // building first, then the street, then the city as a last resort.
  const clean = (s) => s
    .replace(/#[\w-]+/g, '')
    .replace(/\b\d{1,3}(st|nd|rd|th)?[-\s]*(floor|fl|f)\b/ig, '')
    .replace(/\b(level|suite|unit|ste|campus|phase|plot|survey|hissa|no\.?)\s*[\w.-]+/ig, '')
    .replace(/\s{2,}/g, ' ').replace(/^[\s,.-]+|[\s,.-]+$/g, '').trim();
  const segs = addr.split(',').map(clean).filter(Boolean);
  const landmark = segs.find((s) => /(tower|building|plaza|hills|centre|center|park|mall|complex|square|gardens?|clubhouse)/i.test(s));
  const queries = [];
  if (landmark) queries.push(`${landmark}, ${city}`);
  if (segs[0] && segs[0] !== landmark) queries.push(`${segs[0]}, ${city}`);
  queries.push(city);
  let hit = null;
  for (const q of queries) { hit = await geo(q); if (hit) break; }
  if (!hit) { toast(`Couldn't find ${label} on the map`); return; }
  placeAttractionMarker(parseFloat(hit.lat), parseFloat(hit.lon), label);
}
if (el.workdayBody) {
  el.workdayBody.addEventListener('click', (e) => {
    if (e.target.closest('a')) return; // let the "Open in Maps" link work
    const card = e.target.closest('.wd-office'); if (card) showWorkdayOnMap(card.dataset.a, card.dataset.c);
  });
  el.workdayBody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.wd-office'); if (card) { e.preventDefault(); showWorkdayOnMap(card.dataset.a, card.dataset.c); }
  });
}

/* ============================================================
   REMEMBER MY HOTEL ROOM — hotel + room saved per city on this
   device (localStorage), for multi-city / multi-country trips.
   ============================================================ */
const HOTELS_KEY = 'hotels.v1';
let hotels = [];
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function loadHotels() { try { hotels = JSON.parse(localStorage.getItem(HOTELS_KEY)) || []; } catch { hotels = []; } }
function saveHotels() { localStorage.setItem(HOTELS_KEY, JSON.stringify(hotels)); renderHotels(); }
function renderHotels() {
  if (!el.hotelList) return;
  if (!hotels.length) {
    el.hotelList.innerHTML = '<div class="hotel-empty">No rooms saved yet. Add your hotel &amp; room above — handy when hopping between cities.</div>';
    return;
  }
  el.hotelList.innerHTML = hotels.map((h) => `
    <div class="hotel-card">
      <div class="hotel-room">${escHtml(h.room)}</div>
      <div class="hotel-info">
        <div class="hotel-name">${escHtml(h.hotel)}</div>
        <div class="hotel-city">${escHtml(h.city || '—')}${h.savedAt ? ` · ${new Date(h.savedAt).toLocaleDateString()}` : ''}</div>
      </div>
      <button class="hotel-del" data-del="${h.id}" title="Delete" aria-label="Delete ${escHtml(h.hotel)}">✕</button>
    </div>`).join('');
}
function addHotelEntry() {
  const city = (el.hotelCity.value || '').trim();
  const hotel = (el.hotelName.value || '').trim();
  const room = (el.hotelRoom.value || '').trim();
  if (!hotel || !room) { toast('Enter the hotel name and room number'); return; }
  hotels.unshift({ id: Date.now(), city, hotel, room, savedAt: Date.now() });
  saveHotels();
  el.hotelName.value = ''; el.hotelRoom.value = ''; el.hotelName.focus(); // keep city for same-city stays
  toast('Room saved');
}
function setHotelCityDefault(city) {
  if (el.hotelCity && !el.hotelCity.value && city) el.hotelCity.value = city;
}
if (el.hotelAdd) {
  el.hotelAdd.addEventListener('click', addHotelEntry);
  [el.hotelName, el.hotelRoom, el.hotelCity].forEach((i) => i && i.addEventListener('keydown', (e) => { if (e.key === 'Enter') addHotelEntry(); }));
  el.hotelList.addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]');
    if (d) { hotels = hotels.filter((h) => String(h.id) !== d.dataset.del); saveHotels(); }
  });
}

/* ============================================================
   EXPENSE TRACKER — log spend, auto-convert to SGD (live rates),
   with optional receipt OCR (Tesseract.js, keyless, client-side).
   ============================================================ */
const EXP_KEY = 'expenses.v1';
let expenses = [];
function loadExpenses() { try { expenses = JSON.parse(localStorage.getItem(EXP_KEY)) || []; } catch { expenses = []; } }
function saveExpenses() { localStorage.setItem(EXP_KEY, JSON.stringify(expenses)); renderExpenses(); }
function expInitCurrencies() {
  if (!el.expCur) return;
  el.expCur.innerHTML = CURRENCY_LIST.map((c) => `<option value="${c}">${c}</option>`).join('');
  el.expCur.value = 'SGD';
}
function setExpCurDefault(cc) {
  if (!el.expCur) return;
  const code = COUNTRY_INFO[(cc || '').toUpperCase()]?.[0];
  if (code && [...el.expCur.options].some((o) => o.value === code)) el.expCur.value = code;
}
const sgdFmt = (n) => `S$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
function expItemHtml(e) {
  return `<div class="exp-item">
      <div class="exp-icon">${e.cur === 'SGD' ? '🇸🇬' : '💱'}</div>
      <div class="exp-info">
        <div class="exp-merchant">${escHtml(e.merchant)}</div>
        <div class="exp-meta">${e.date || ''}</div>
      </div>
      <div class="exp-amounts">
        <div class="exp-orig">${escHtml(e.cur)} ${e.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
        <div class="exp-sgd">${e.sgd != null ? `≈ ${sgdFmt(e.sgd)}` : ''}</div>
      </div>
      <button class="exp-del" data-del="${e.id}" title="Delete" aria-label="Delete ${escHtml(e.merchant)}">✕</button>
    </div>`;
}
function renderExpenses() {
  if (!el.expList) return;
  const totalSgd = expenses.reduce((s, e) => s + (e.sgd || 0), 0);
  el.expTotal.innerHTML = expenses.length
    ? `Total: <b>${sgdFmt(totalSgd)}</b> · ${expenses.length} expense${expenses.length > 1 ? 's' : ''}`
    : '';
  if (el.expExport) el.expExport.style.display = expenses.length ? '' : 'none';
  if (!expenses.length) { el.expList.innerHTML = '<div class="hotel-empty">No expenses yet. Add one or scan a receipt — amounts auto-convert to SGD.</div>'; return; }
  // Group by city (in recency order — expenses are newest-first).
  const groups = {}; const order = [];
  expenses.forEach((e) => { const c = e.city || 'Other'; if (!groups[c]) { groups[c] = []; order.push(c); } groups[c].push(e); });
  el.expList.innerHTML = order.map((c) => {
    const sub = groups[c].reduce((s, e) => s + (e.sgd || 0), 0);
    return `<div class="exp-group">
      <div class="exp-group-head"><span>📍 ${escHtml(c)}</span><span class="exp-group-sub">${sgdFmt(sub)}</span></div>
      ${groups[c].map(expItemHtml).join('')}
    </div>`;
  }).join('');
}
function exportExpensesCSV() {
  if (!expenses.length) { toast('No expenses to export'); return; }
  const cell = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const rows = [['Date', 'City', 'Merchant', 'Currency', 'Amount', 'SGD']];
  expenses.slice().reverse().forEach((e) => rows.push([e.date || '', e.city || '', e.merchant, e.cur, e.amount, e.sgd ?? '']));
  const csv = rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Exported CSV');
}
async function addExpense() {
  const merchant = (el.expMerchant.value || '').trim();
  const amount = parseFloat(el.expAmount.value);
  const cur = el.expCur.value;
  if (!merchant || !amount || amount <= 0) { toast('Enter a merchant and amount'); return; }
  let sgd = null;
  const rates = await fetchRates();
  if (cur === 'SGD') sgd = amount;
  else if (rates && rates[cur]) sgd = amount / rates[cur];
  expenses.unshift({ id: Date.now(), merchant, amount, cur, sgd: sgd != null ? +sgd.toFixed(2) : null, city: state.current?.name || '', date: new Date().toLocaleDateString() });
  saveExpenses();
  el.expMerchant.value = ''; el.expAmount.value = ''; el.expMerchant.focus();
  toast('Expense added');
}
/* ---- Receipt OCR (Tesseract.js, loaded on demand) ---- */
let tessLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (tessLoading) return tessLoading;
  tessLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => res(); s.onerror = () => rej(new Error('load failed'));
    document.head.appendChild(s);
  });
  return tessLoading;
}
function parseReceipt(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const merchant = (lines.find((l) => /[A-Za-z]{3,}/.test(l)) || lines[0] || '').slice(0, 40);
  const symMap = { S$: 'SGD', HK$: 'HKD', NT$: 'TWD', A$: 'AUD', R$: 'BRL', RM: 'MYR', Rp: 'IDR', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₩': 'KRW', '₹': 'INR', '฿': 'THB', '₫': 'VND', '₱': 'PHP', '₺': 'TRY', '₽': 'RUB', $: 'USD' };
  let cur = '';
  const codeM = text.match(/\b(SGD|USD|EUR|GBP|JPY|KRW|INR|THB|VND|PHP|MYR|IDR|CNY|AUD|HKD|TWD|AED|CHF|CAD|BRL|MXN|TRY|RUB|SAR|QAR|NZD|ZAR)\b/);
  if (codeM) cur = codeM[1];
  else for (const [sym, code] of Object.entries(symMap)) if (text.includes(sym)) { cur = code; break; }
  const toNum = (s) => { s = s.replace(/\s/g, ''); if (/,\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); return parseFloat(s.replace(/[^0-9.]/g, '')); };
  const decRe = /\d{1,3}(?:[ ,.]\d{3})*[.,]\d{2}/g;                 // amounts with cents
  const broadRe = /\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?/g;        // also integer amounts (¥, ₩, ₫)
  let amount = null;
  // "total"/"amount due"/"grand total"/"nett" lines, but NOT "subtotal"; take the largest.
  const totalLines = lines.filter((l) => /(grand\s*total|amount\s*due|balance\s*due|total\s*due|\btotal\b|\bnett?\b)/i.test(l) && !/sub\s*-?\s*total/i.test(l));
  const tNums = totalLines.flatMap((l) => (l.match(broadRe) || []).map(toNum)).filter((n) => !isNaN(n) && n > 0);
  if (tNums.length) amount = Math.max(...tNums);
  if (amount == null) { // no total line: prefer decimal amounts, else any integer
    let all = (text.match(decRe) || []).map(toNum).filter((n) => !isNaN(n));
    if (!all.length) all = (text.match(broadRe) || []).map(toNum).filter((n) => !isNaN(n) && n >= 1);
    if (all.length) amount = Math.max(...all);
  }
  return { merchant, amount: (amount != null && !isNaN(amount)) ? amount : null, cur };
}
async function runReceiptOCR(file) {
  if (!file) return;
  el.expStatus.hidden = false; el.expStatus.textContent = 'Loading receipt scanner…';
  try {
    await loadTesseract();
    el.expStatus.textContent = 'Reading receipt… (this can take 10–20s)';
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    const { data } = await window.Tesseract.recognize(dataUrl, 'eng');
    const p = parseReceipt(data.text || '');
    if (p.merchant) el.expMerchant.value = p.merchant;
    if (p.amount != null) el.expAmount.value = p.amount;
    if (p.cur && [...el.expCur.options].some((o) => o.value === p.cur)) el.expCur.value = p.cur;
    el.expStatus.textContent = p.amount != null ? '✓ Extracted — check the fields and tap Add.' : 'Couldn’t read the total — please enter it manually.';
  } catch { el.expStatus.textContent = 'Scan failed — please enter it manually.'; }
}
if (el.expAdd) {
  expInitCurrencies();
  el.expAdd.addEventListener('click', addExpense);
  [el.expMerchant, el.expAmount].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') addExpense(); }));
  el.expList.addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d) { expenses = expenses.filter((x) => String(x.id) !== d.dataset.del); saveExpenses(); } });
  el.expReceipt.addEventListener('change', (e) => { if (e.target.files[0]) runReceiptOCR(e.target.files[0]); e.target.value = ''; });
  if (el.expExport) el.expExport.addEventListener('click', exportExpensesCSV);
}

function buildSectionNav() {
  const nav = document.getElementById('sectionNav');
  if (!nav) return;
  const secs = [...document.querySelectorAll('[data-nav]')];
  const links = new Map();
  secs.forEach((sec, i) => {
    if (!sec.id) sec.id = 'sec-' + i;
    const a = document.createElement('a');
    a.href = '#' + sec.id;
    a.textContent = sec.dataset.nav;
    a.addEventListener('click', () => { links.forEach((l) => l.classList.remove('active')); a.classList.add('active'); });
    nav.appendChild(a);
    links.set(sec, a);
  });
  // Highlight the section nearest the top of the viewport as you scroll.
  // Skip sticky sections (e.g. the desktop map) — their top never scrolls past.
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const cut = 90; // just below the sticky nav
      const spy = secs.filter((s) => getComputedStyle(s).position !== 'sticky');
      let current = spy[0];
      for (const sec of spy) {
        if (sec.getBoundingClientRect().top <= cut) current = sec; else break;
      }
      links.forEach((l) => l.classList.remove('active'));
      const active = links.get(current);
      if (active) {
        active.classList.add('active');
        active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function boot() {
  buildSectionNav();
  loadCities();
  renderSaved();
  loadHotels();
  renderHotels();
  loadExpenses();
  renderExpenses();
  initMap();
  useMyLocation();
  if (state.cities.length) refreshSavedTemps();
  setInterval(() => { if (state.cities.length) renderSaved(); updateHeroTime(); }, 60000); // keep clocks current
  spotifyHandleRedirect().then(renderSpotify);
}
boot();
