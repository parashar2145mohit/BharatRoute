"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Polyline, TileLayer } from "leaflet";

type Place = { display_name: string; lat: string; lon: string; type?: string };
type Mode = "driving" | "walking" | "cycling";
type NavStep = { instruction: string; distance: number; duration: number; location: [number, number]; heading: number };
type Highlight = { id: number; title: string; image?: string; lat: number; lon: number; description?: string };

const categories = [
  ["⛽", "Petrol"], ["🍽️", "Food"], ["🅿", "Parking"], ["🏨", "Hotels"],
  ["🏥", "Hospitals"], ["🏧", "ATM"], ["☕", "Cafés"], ["🛍", "Shopping"],
];

const quickPlaces = [
  { name: "India Gate", city: "New Delhi", lat: 28.6129, lon: 77.2295, time: "18 min" },
  { name: "Lodhi Garden", city: "New Delhi", lat: 28.5931, lon: 77.2197, time: "22 min" },
  { name: "Cyber Hub", city: "Gurugram", lat: 28.4951, lon: 77.0893, time: "34 min" },
];

export default function BharatRouteApp() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const baseLayerRef = useRef<TileLayer | null>(null);
  const labelsLayerRef = useRef<TileLayer | null>(null);
  const trafficLayerRef = useRef<TileLayer | null>(null);
  const measureRef = useRef<Polyline | null>(null);
  const trackInputRef = useRef<HTMLInputElement | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const routeRef = useRef<Polyline | null>(null);
  const [L, setL] = useState<typeof import("leaflet") | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromCoord, setFromCoord] = useState<[number, number] | null>(null);
  const [toCoord, setToCoord] = useState<[number, number] | null>(null);
  const [routeSuggestions, setRouteSuggestions] = useState<Place[]>([]);
  const [activeRouteField, setActiveRouteField] = useState<"from" | "to" | null>(null);
  const [mode, setMode] = useState<Mode>("driving");
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string } | null>(null);
  const [layer, setLayer] = useState("Map");
  const [panel, setPanel] = useState<"explore" | "saved" | "profile">("explore");
  const [notice, setNotice] = useState("");
  const [layersOpen, setLayersOpen] = useState(false);
  const [measureActive, setMeasureActive] = useState(false);
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [is3d, setIs3d] = useState(false);
  const [navSteps, setNavSteps] = useState<NavStep[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [navigationActive, setNavigationActive] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [discoveryPlace, setDiscoveryPlace] = useState("");

  useEffect(() => {
    let active = true;
    import("leaflet").then((leaflet) => {
      if (!active || !mapEl.current || mapRef.current) return;
      const map = leaflet.map(mapEl.current, { zoomControl: false, attributionControl: true, maxZoom: 22 }).setView([22.9, 79.2], 5);
      baseLayerRef.current = leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxNativeZoom: 19,
        maxZoom: 22,
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      leaflet.control.zoom({ position: "bottomright" }).addTo(map);
      leaflet.control.scale({ position: "bottomright", imperial: false, maxWidth: 130 }).addTo(map);
      mapRef.current = map;
      setL(leaflet);
      const updateWeather = async () => {
        const centre = map.getCenter();
        try {
          const data = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${centre.lat}&longitude=${centre.lng}&current=temperature_2m,weather_code`).then(r => r.json());
          if (data.current) setWeather({ temp: Math.round(data.current.temperature_2m), code: data.current.weather_code });
        } catch { /* Weather is supplementary; the map remains usable offline. */ }
      };
      updateWeather();
      map.on("moveend", updateWeather);
      setTimeout(() => map.invalidateSize(), 100);
    });
    return () => { active = false; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!L || !mapRef.current || !measureActive) return;
    const points: [number, number][] = [];
    const map = mapRef.current;
    const handleClick = (event: import("leaflet").LeafletMouseEvent) => {
      points.push([event.latlng.lat, event.latlng.lng]);
      if (points.length === 1) {
        setNotice("Select the end point on the map");
      } else {
        measureRef.current?.remove();
        measureRef.current = L.polyline(points, { color: "#e84152", weight: 4, dashArray: "8 7" }).addTo(map);
        const distance = map.distance(points[0], points[1]);
        setNotice(distance > 1000 ? `Distance: ${(distance / 1000).toFixed(2)} km` : `Distance: ${Math.round(distance)} m`);
        setMeasureActive(false);
      }
    };
    map.getContainer().style.cursor = "crosshair";
    map.on("click", handleClick);
    return () => { map.off("click", handleClick); map.getContainer().style.cursor = ""; };
  }, [L, measureActive]);

  useEffect(() => {
    if (!activeRouteField) return;
    const value = activeRouteField === "from" ? from : to;
    if (value.trim().length < 2) { setRouteSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&addressdetails=1&limit=5&q=${encodeURIComponent(value)}`, { signal: controller.signal });
        setRouteSuggestions(await response.json());
      } catch (error) { if ((error as Error).name !== "AbortError") setRouteSuggestions([]); }
    }, 320);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [from, to, activeRouteField]);

  useEffect(() => {
    if (!navigationActive || !voiceEnabled || !navSteps[activeStep] || !("speechSynthesis" in window)) return;
    const step = navSteps[activeStep];
    const distance = step.distance < 1000 ? `${Math.round(step.distance)} metres` : `${(step.distance / 1000).toFixed(1)} kilometres`;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`In ${distance}, ${step.instruction}`);
    utterance.lang = "en-IN";
    utterance.rate = 0.92;
    utterance.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const indianVoice = voices.find(voice => voice.lang === "en-IN") || voices.find(voice => voice.lang.startsWith("en"));
    if (indianVoice) utterance.voice = indianVoice;
    window.speechSynthesis.speak(utterance);
    return () => window.speechSynthesis.cancel();
  }, [navigationActive, activeStep, voiceEnabled, navSteps]);

  useEffect(() => {
    if (!navigationActive || !navigator.geolocation || !navSteps[activeStep + 1]) return;
    const watchId = navigator.geolocation.watchPosition(({ coords }) => {
      if (!mapRef.current) return;
      const next = navSteps[activeStep + 1];
      const metres = mapRef.current.distance([coords.latitude, coords.longitude], [next.location[1], next.location[0]]);
      if (metres < 45) setActiveStep(current => Math.min(current + 1, navSteps.length - 1));
    }, () => undefined, { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [navigationActive, activeStep, navSteps]);

  function changeLayer(next: string) {
    if (!L || !mapRef.current) return;
    const map = mapRef.current;
    baseLayerRef.current?.remove();
    labelsLayerRef.current?.remove();
    trafficLayerRef.current?.remove();
    labelsLayerRef.current = null;
    trafficLayerRef.current = null;

    if (next === "Satellite") {
      baseLayerRef.current = L.tileLayer(
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxNativeZoom: 19, maxZoom: 22, attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics" },
      ).addTo(map);
      labelsLayerRef.current = L.tileLayer(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxNativeZoom: 19, maxZoom: 22, pane: "overlayPane" },
      ).addTo(map);
      setNotice("High-resolution satellite imagery enabled");
    } else if (next === "Terrain") {
      baseLayerRef.current = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxNativeZoom: 17, maxZoom: 22, attribution: "Map data © OpenStreetMap, SRTM | Map style © OpenTopoMap",
      }).addTo(map);
      setNotice("Terrain and elevation view enabled");
    } else if (next === "Biking") {
      baseLayerRef.current = L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", {
        maxNativeZoom: 20, maxZoom: 22, attribution: "CyclOSM © OpenStreetMap contributors",
      }).addTo(map);
      setNotice("Cycling routes enabled");
    } else if (next === "Transit") {
      baseLayerRef.current = L.tileLayer("https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png", {
        maxNativeZoom: 18, maxZoom: 22, attribution: "Transit © ÖPNVKarte, OpenStreetMap contributors",
      }).addTo(map);
      setNotice("Public transport network enabled");
    } else {
      baseLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxNativeZoom: 19, maxZoom: 22, attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      if (next === "Traffic") {
        const key = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
        if (key) {
          trafficLayerRef.current = L.tileLayer(
            `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${key}&tileSize=256`,
            { maxNativeZoom: 20, maxZoom: 22, opacity: 0.9, pane: "overlayPane", attribution: "Traffic © TomTom" },
          ).addTo(map);
          setNotice("Live traffic flow enabled");
        } else {
          setNotice("Traffic API key required — add it to .env.local");
        }
      }
    }
    setLayer(next);
    setLayersOpen(false);
  }

  function useMapFeature(feature: string) {
    if (feature === "Street View") {
      const center = mapRef.current?.getCenter();
      if (center) window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${center.lat},${center.lng}`, "_blank", "noopener,noreferrer");
      setNotice("Opening street-level imagery at the map centre");
    } else if (feature === "Travel time") {
      setLayersOpen(false); setRouteOpen(true); setPanel("explore");
      setNotice("Choose a destination to calculate travel time");
    } else if (feature === "Measure") {
      measureRef.current?.remove(); setLayersOpen(false); setMeasureActive(true);
      setNotice("Select the start point on the map");
    } else if (feature === "Wildfires") {
      setNotice("Live wildfire data requires a NASA FIRMS map key");
    } else if (feature === "Air Quality") {
      setNotice("Live air-quality overlay requires an air-data provider key");
    }
  }

  async function shareMap() {
    const centre = mapRef.current?.getCenter();
    const url = centre ? `${location.origin}${location.pathname}?lat=${centre.lat.toFixed(5)}&lng=${centre.lng.toFixed(5)}&z=${mapRef.current?.getZoom()}` : location.href;
    try {
      if (navigator.share) await navigator.share({ title: "BharatRoute map", text: "View this place on BharatRoute", url });
      else { await navigator.clipboard.writeText(url); setNotice("Map link copied"); }
    } catch { /* User cancelled the native share sheet. */ }
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch { setNotice("Fullscreen is not available in this browser"); }
  }

  function pickCoordinate() {
    if (!mapRef.current) return;
    setMoreOpen(false);
    setNotice("Click anywhere on the map to pick coordinates");
    mapRef.current.getContainer().style.cursor = "crosshair";
    mapRef.current.once("click", async (event: import("leaflet").LeafletMouseEvent) => {
      mapRef.current!.getContainer().style.cursor = "";
      const value = `${event.latlng.lat.toFixed(6)}, ${event.latlng.lng.toFixed(6)}`;
      try { await navigator.clipboard.writeText(value); } catch { /* Clipboard may be unavailable. */ }
      showPlace({ lat: event.latlng.lat, lon: event.latlng.lng, name: value });
      setNotice(`Coordinates copied: ${value}`);
    });
  }

  async function importTrack(file?: File) {
    if (!file || !L || !mapRef.current) return;
    try {
      const xml = new DOMParser().parseFromString(await file.text(), "text/xml");
      const trackPoints = [...xml.querySelectorAll("trkpt, rtept")].map(node => [Number(node.getAttribute("lat")), Number(node.getAttribute("lon"))] as [number, number]);
      const kmlPoints = [...xml.querySelectorAll("coordinates")].flatMap(node => (node.textContent || "").trim().split(/\s+/).map(value => {
        const [lon, lat] = value.split(",").map(Number); return [lat, lon] as [number, number];
      }));
      const points = trackPoints.length ? trackPoints : kmlPoints;
      if (points.length < 2 || points.some(point => point.some(Number.isNaN))) throw new Error("Invalid track");
      routeRef.current?.remove();
      routeRef.current = L.polyline(points, { color: "#e84152", weight: 5 }).addTo(mapRef.current);
      mapRef.current.fitBounds(routeRef.current.getBounds(), { padding: [40, 40] });
      setMoreOpen(false); setNotice(`${file.name} imported successfully`);
    } catch { setNotice("Could not read this track. Use a valid GPX or KML file."); }
  }

  function pinCodeSearch() {
    const code = window.prompt("Enter a 6-digit Indian PIN code");
    if (!code) return;
    setMoreOpen(false); setQuery(code); searchPlaces(code);
  }

  const showPlace = useCallback((place: { lat: number; lon: number; name: string }) => {
    if (!L || !mapRef.current) return;
    markerRef.current?.remove();
    markerRef.current = L.marker([place.lat, place.lon]).addTo(mapRef.current).bindPopup(`<b>${place.name}</b><br/>India`).openPopup();
    mapRef.current.flyTo([place.lat, place.lon], 14, { duration: 1.2 });
    setResults([]); setQuery(place.name);
    loadNearbyHighlights(place.lat, place.lon, place.name);
  }, [L]);

  async function loadNearbyHighlights(lat: number, lon: number, placeName: string) {
    setDiscoveryPlace(placeName); setHighlightsLoading(true); setHighlights([]);
    try {
      const params = new URLSearchParams({ action: "query", generator: "geosearch", ggscoord: `${lat}|${lon}`, ggsradius: "10000", ggslimit: "12", ggsnamespace: "0", prop: "coordinates|pageimages|extracts", piprop: "thumbnail", pithumbsize: "520", exintro: "1", explaintext: "1", exsentences: "1", format: "json", origin: "*" });
      const data = await fetch(`https://en.wikipedia.org/w/api.php?${params}`).then(response => response.json());
      const pages = Object.values(data.query?.pages || {}) as Array<{ pageid: number; title: string; thumbnail?: { source: string }; coordinates?: Array<{ lat: number; lon: number }>; extract?: string }>;
      const items = pages.filter(page => page.coordinates?.[0]).map(page => ({ id: page.pageid, title: page.title, image: page.thumbnail?.source, lat: page.coordinates![0].lat, lon: page.coordinates![0].lon, description: page.extract }));
      setHighlights(items.sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image))).slice(0, 10));
    } catch { setNotice("Nearby recommendations are temporarily unavailable"); }
    finally { setHighlightsLoading(false); }
  }

  function focusHighlight(item: Highlight) {
    if (!L || !mapRef.current) return;
    markerRef.current?.remove();
    markerRef.current = L.marker([item.lat, item.lon]).addTo(mapRef.current).bindPopup(`<b>${item.title}</b><br/>Popular near ${discoveryPlace}`).openPopup();
    mapRef.current.flyTo([item.lat, item.lon], 16, { duration: 1.1 });
  }

  async function searchPlaces(term = query) {
    if (term.trim().length < 2) return;
    setSearching(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&limit=6&q=${encodeURIComponent(term)}`);
      setResults(await response.json());
    } catch { setNotice("Search is temporarily unavailable. Try again shortly."); }
    finally { setSearching(false); }
  }

  function locateMe() {
    if (!navigator.geolocation) return setNotice("Location is not supported on this device.");
    setNotice("Finding your location…");
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setNotice("You are here");
      showPlace({ lat: coords.latitude, lon: coords.longitude, name: "Your location" });
    }, () => setNotice("Allow location access to find you on the map."));
  }

  async function findRoute() {
    if (!to.trim()) return setNotice("Enter a destination first.");
    setSearching(true);
    try {
      const geo = toCoord ? null : await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&limit=1&q=${encodeURIComponent(to)}`).then(r => r.json());
      if (!toCoord && !geo?.[0]) throw new Error("Place not found");
      const destination = toCoord || [Number(geo[0].lon), Number(geo[0].lat)];
      const start = mapRef.current?.getCenter();
      const origin = fromCoord || (start ? [start.lng, start.lat] : [77.209, 28.6139]);
      const profile = mode === "driving" ? "driving" : mode === "walking" ? "foot" : "bike";
      const data = await fetch(`https://router.project-osrm.org/route/v1/${profile}/${origin.join(",")};${destination.join(",")}?overview=full&geometries=geojson&steps=true`).then(r => r.json());
      if (!data.routes?.[0]) throw new Error("Route unavailable");
      const route = data.routes[0];
      const points = route.geometry.coordinates.map((p: number[]) => [p[1], p[0]]);
      const rawSteps = route.legs?.[0]?.steps || [];
      setNavSteps(rawSteps.map((step: { name?: string; distance: number; duration: number; maneuver: { type: string; modifier?: string; location: [number, number]; bearing_after?: number } }) => ({
        instruction: formatInstruction(step.maneuver.type, step.maneuver.modifier, step.name),
        distance: step.distance,
        duration: step.duration,
        location: step.maneuver.location,
        heading: step.maneuver.bearing_after ?? 0,
      })));
      setActiveStep(0);
      routeRef.current?.remove();
      routeRef.current = L!.polyline(points, { color: "#1677ff", weight: 7, opacity: .9 }).addTo(mapRef.current!);
      mapRef.current!.fitBounds(routeRef.current.getBounds(), { padding: [60, 60] });
      setRouteInfo({ distance: `${(route.distance / 1000).toFixed(1)} km`, duration: `${Math.round(route.duration / 60)} min` });
    } catch { setNotice("Couldn’t calculate that route. Try a nearby landmark."); }
    finally { setSearching(false); }
  }

  function categorySearch(name: string) {
    setQuery(name); searchPlaces(name);
  }

  function chooseRouteSuggestion(place: Place) {
    const coordinates: [number, number] = [Number(place.lon), Number(place.lat)];
    const label = place.display_name.split(",").slice(0, 2).join(",");
    if (activeRouteField === "from") { setFrom(label); setFromCoord(coordinates); }
    else { setTo(label); setToCoord(coordinates); }
    setRouteSuggestions([]); setActiveRouteField(null);
    mapRef.current?.flyTo([coordinates[1], coordinates[0]], 14);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => mapRef.current?.flyTo([22.9, 79.2], 5)} aria-label="BharatRoute home">
          <span className="brand-mark">B</span><span>Bharat<span>Route</span></span>
        </button>
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && searchPlaces()} placeholder="Search places, roads, cities…" aria-label="Search map" />
          {query && <button className="clear" onClick={() => { setQuery(""); setResults([]); }}>×</button>}
          <button className="search-button" onClick={() => searchPlaces()}>{searching ? "…" : "Search"}</button>
          {results.length > 0 && <div className="results">
            {results.map((p, i) => <button key={`${p.lat}-${i}`} onClick={() => showPlace({ lat: +p.lat, lon: +p.lon, name: p.display_name.split(",")[0] })}>
              <span>⌖</span><span><strong>{p.display_name.split(",")[0]}</strong><small>{p.display_name.split(",").slice(1, 4).join(",")}</small></span>
            </button>)}
          </div>}
        </div>
        <nav className="desktop-nav">
          <button onClick={() => setPanel("saved")}>♡ <span>Saved</span></button>
          <button onClick={() => setNotice("Download the BharatRoute app — coming soon!")}>▣ <span>Get app</span></button>
          <button className="avatar" onClick={() => setPanel("profile")}>MP</button>
        </nav>
      </header>

      <section className="workspace">
        <aside className={`side-panel ${routeOpen ? "route-active" : ""}`}>
          {!routeOpen ? <>
            <div className="greeting"><small>NAMASTE · नमस्ते 👋</small><h1>Where to today?</h1><p>भारत का अपना रास्ता — explore India with confidence.</p></div>
            <button className="route-cta" onClick={() => setRouteOpen(true)}><span className="route-icon">↗</span><span><strong>Plan a route · मार्ग बनाएँ</strong><small>Fastest way to your destination</small></span><b>›</b></button>
            {panel === "explore" && <>
              <div className="section-title"><h2>Explore nearby</h2><button onClick={() => setNotice("More categories coming soon")}>View all</button></div>
              <div className="categories">{categories.map(([icon, name]) => <button key={name} onClick={() => categorySearch(name)}><span>{icon}</span>{name}</button>)}</div>
              <div className="section-title popular"><h2>Popular near you</h2><button onClick={() => mapRef.current?.flyTo([28.6139, 77.209], 12)}>See map</button></div>
              <div className="place-list">{quickPlaces.map((p, i) => <button key={p.name} onClick={() => showPlace(p)}><span className={`place-art art-${i}`}><b>{i === 0 ? "♜" : i === 1 ? "♧" : "▦"}</b></span><span><strong>{p.name}</strong><small>{p.city} · {p.time}</small><em>★ {i === 2 ? "4.6" : "4.8"}</em></span></button>)}</div>
            </>}
            {panel === "saved" && <div className="empty-state"><span>♡</span><h2>Your saved places</h2><p>Save places you love and find them faster next time.</p><button onClick={() => setPanel("explore")}>Explore places</button></div>}
            {panel === "profile" && <div className="profile-card"><div>MP</div><h2>Mohit</h2><p>BharatRoute explorer</p><button onClick={() => setNotice("Preferences saved locally")}>Map preferences</button><button onClick={() => setNotice("Help centre is coming soon")}>Help & feedback</button></div>}
          </> : <>
            <div className="route-header"><button onClick={() => { setRouteOpen(false); setRouteInfo(null); routeRef.current?.remove(); }}>‹</button><div><small>ROUTE PLANNER</small><h1>Choose your journey</h1></div></div>
            <div className="mode-switch">
              {(["driving", "walking", "cycling"] as Mode[]).map(m => <button className={mode === m ? "active" : ""} onClick={() => setMode(m)} key={m}><span>{m === "driving" ? "🚙" : m === "walking" ? "🚶" : "🚲"}</span>{m[0].toUpperCase() + m.slice(1)}</button>)}
            </div>
            <div className="route-fields-wrap"><div className="route-fields"><div><i className="start-dot" /><input value={from} onFocus={() => setActiveRouteField("from")} onChange={e => { setFrom(e.target.value); setFromCoord(null); setActiveRouteField("from"); }} autoComplete="off" placeholder="Your location or starting point" aria-label="Starting point" /></div><div><i className="end-dot" /><input value={to} onFocus={() => setActiveRouteField("to")} onChange={e => { setTo(e.target.value); setToCoord(null); setActiveRouteField("to"); }} autoComplete="off" placeholder="Where are you going?" aria-label="Destination" /></div></div>
            {routeSuggestions.length > 0 && <div className="route-suggestions">{routeSuggestions.map((place, index) => <button key={`${place.lat}-${place.lon}-${index}`} onMouseDown={e => e.preventDefault()} onClick={() => chooseRouteSuggestion(place)}><span>⌖</span><div><b>{place.display_name.split(",")[0]}</b><small>{place.display_name.split(",").slice(1, 4).join(",")}</small></div></button>)}</div>}</div>
            <button className="find-route" onClick={findRoute}>{searching ? "Finding best route…" : "Find best route"}</button>
            {routeInfo && <div className="route-result"><div><small>FASTEST ROUTE</small><h2>{routeInfo.duration}</h2><p>{routeInfo.distance} · via recommended roads</p></div><span>↗</span><button onClick={() => { setNavigationActive(true); setNotice("Navigation preview started"); }}>Start navigation</button></div>}
            <div className="route-tip"><span>✦</span><p><strong>Smart route suggestions</strong><br/>BharatRoute considers live road conditions when data is available.</p></div>
          </>}
          <footer><span>भारत के लिए बनाया 🇮🇳</span><span>English · हिन्दी</span></footer>
        </aside>

        <div className="map-area">
          <div ref={mapEl} className={`map ${is3d ? "map-3d" : ""}`} />
          <button className="weather-widget" onClick={() => setNotice("Weather updates automatically for the map centre")}><span>{weather && weather.code < 3 ? "☀" : weather && weather.code < 60 ? "☁" : "🌧"}</span><b>Map centre</b><em>{weather ? `${weather.temp}°C` : "—°C"}</em></button>
          <div className="quick-actions">
            <button onClick={() => setFeedbackOpen(true)}>✎ <span>Feedback</span></button>
            <button onClick={shareMap}>⌁ <span>Share</span></button>
            <button onClick={() => setMoreOpen(v => !v)}>•••</button>
            {moreOpen && <div className="all-tools-menu"><div className="all-tools-head"><div><small>BHARATROUTE</small><h2>All tools</h2></div><button onClick={() => setMoreOpen(false)}>×</button></div><div className="all-tools-grid">
              <button onClick={() => trackInputRef.current?.click()}><span>⌁<em>NEW</em></span><b>Track import</b><small>GPX or KML</small></button>
              <button onClick={() => { setMoreOpen(false); setNotice("Road restriction data integration is ready for an official transport-data feed"); }}><span>⦸<em>NEW</em></span><b>Restrictions</b><small>Restricted roads</small></button>
              <button onClick={pickCoordinate}><span>⌖<em>NEW</em></span><b>Pick coordinates</b><small>Tap the map</small></button>
              <button onClick={pinCodeSearch}><span>✉<em>NEW</em></span><b>PIN code search</b><small>India Post areas</small></button>
              <button onClick={() => { setMoreOpen(false); setNotice("BharatRoute mobile app is coming soon"); }}><span>▯</span><b>Get the app</b><small>Coming soon</small></button>
              <button onClick={() => window.print()}><span>▤</span><b>Print map</b><small>Print current view</small></button>
            </div></div>}
            <input ref={trackInputRef} className="track-input" type="file" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml" onChange={e => importTrack(e.target.files?.[0])} />
          </div>
          <div className="map-chips">
            <button className={layersOpen ? "active" : ""} onClick={() => setLayersOpen(v => !v)}><span>▦</span>Layers</button>
            {["Traffic", "Transit", "Satellite"].map(x => <button className={layer === x ? "active" : ""} onClick={() => changeLayer(x)} key={x}><span>{x === "Traffic" ? "◉" : x === "Transit" ? "▣" : "◫"}</span>{x}</button>)}
          </div>
          <div className="discovery-chips">{[["🍽","Restaurants"],["🛏","Hotels"],["📷","Things to do"],["🏛","Museums"],["💊","Pharmacies"],["🏧","ATMs"]].map(([icon,name]) => <button key={name} onClick={() => name === "Things to do" ? loadNearbyHighlights(mapRef.current?.getCenter().lat || 22.9, mapRef.current?.getCenter().lng || 79.2, query || "this area") : categorySearch(name)}><span>{icon}</span>{name}</button>)}</div>
          {layersOpen && <div className="layers-drawer">
            <div className="drawer-head"><div><small>MAP DETAILS</small><h2>Layers & tools</h2></div><button onClick={() => setLayersOpen(false)}>×</button></div>
            <div className="layer-grid">
              {[["▣","Transit"],["≋","Traffic"],["◉","Biking"],["⌁","Terrain"],["♙","Street View"],["◆","Wildfires"],["≈","Air Quality"]].map(([icon,name],i) =>
                <button key={name} className={layer === name ? "selected" : ""} onClick={() => ["Transit","Traffic","Biking","Terrain"].includes(name) ? changeLayer(name) : useMapFeature(name)}><span className={`layer-thumb thumb-${i}`}>{icon}</span><b>{name}</b></button>)}
            </div>
            <div className="drawer-section"><h3>Map tools</h3><div className="layer-grid tool-grid">
              {[["⌖","Travel time"],["╱","Measure"]].map(([icon,name],i) => <button key={name} onClick={() => useMapFeature(name)}><span className={`layer-thumb tool-${i}`}>{icon}</span><b>{name}</b></button>)}
            </div></div>
            <div className="drawer-section"><h3>Map type</h3><div className="layer-grid type-grid">
              {[["◇","Map"],["▧","Satellite"]].map(([icon,name],i) => <button className={layer === name ? "selected" : ""} key={name} onClick={() => changeLayer(name)}><span className={`layer-thumb type-${i}`}>{icon}</span><b>{name === "Map" ? "Default" : name}</b></button>)}
            </div></div>
            <p className="data-note">Live data layers depend on provider availability and configured API access.</p>
          </div>}
          <div className="map-tools"><button onClick={locateMe} aria-label="Find my location">⌖</button><button onClick={() => setNotice("Report a map issue")}>!</button></div>
          <div className="view-tools"><button className={is3d ? "active" : ""} onClick={() => { setIs3d(v => !v); setNotice(is3d ? "2D view enabled" : "3D perspective enabled"); }}>3D</button><button onClick={() => { mapRef.current?.setView(mapRef.current.getCenter(), mapRef.current.getZoom()); setNotice("Map aligned to north"); }} title="Reset north">▲</button><button onClick={toggleFullscreen} title="Fullscreen">⛶</button></div>
          {layer === "Traffic" && <div className="traffic-legend"><b><i className="live-dot" /> LIVE</b><span /><small>Fast</small><i /><small>Slow</small></div>}
          {layer === "Satellite" && <div className="imagery-note"><b>Satellite</b><span>High-resolution aerial imagery</span></div>}
          {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<b>×</b></button>}
          <div className="india-badge">🇮🇳 <span>Exploring India</span></div>
          {!navigationActive && (highlightsLoading || highlights.length > 0) && <section className="place-discovery"><div className="discovery-title"><div><small>EXPLORE NEARBY</small><h2>Famous places near {discoveryPlace}</h2></div><button onClick={() => setHighlights([])}>×</button></div>{highlightsLoading ? <div className="discovery-loading"><i/><i/><i/></div> : <div className="highlight-rail">{highlights.map((item, index) => <article key={item.id} onClick={() => focusHighlight(item)}>{item.image ? <img src={item.image} alt={item.title} loading="lazy" /> : <div className={`highlight-fallback fallback-${index % 3}`}>भारत</div>}<div className="highlight-copy"><small>★ POPULAR</small><h3>{item.title}</h3><p>{item.description || `Discover this landmark near ${discoveryPlace}.`}</p><a href={`https://en.wikipedia.org/?curid=${item.id}`} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>Learn more ↗</a></div></article>)}</div>}<span className="wikimedia-credit">Photos and place information from Wikipedia/Wikimedia</span></section>}
          {feedbackOpen && <div className="modal-backdrop" onClick={() => setFeedbackOpen(false)}><form className="feedback-card" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); setFeedbackOpen(false); setNotice("Thank you — feedback saved for review"); }}><button type="button" className="modal-close" onClick={() => setFeedbackOpen(false)}>×</button><small>HELP IMPROVE BHARATROUTE</small><h2>Send map feedback</h2><p>Tell us about a missing road, wrong place or navigation issue.</p><select aria-label="Feedback type"><option>Missing or incorrect place</option><option>Road information</option><option>Navigation problem</option><option>Other feedback</option></select><textarea required placeholder="Describe the issue…" aria-label="Feedback details" /><button type="submit" className="submit-feedback">Send feedback</button></form></div>}
          {navigationActive && navSteps[activeStep] && <NavigationPreview step={navSteps[activeStep]} index={activeStep} total={navSteps.length} voiceEnabled={voiceEnabled} onToggleVoice={() => setVoiceEnabled(value => !value)} onRepeat={() => { setVoiceEnabled(true); window.speechSynthesis?.cancel(); const utterance = new SpeechSynthesisUtterance(navSteps[activeStep].instruction); utterance.lang = "en-IN"; utterance.rate = .92; window.speechSynthesis?.speak(utterance); }} onClose={() => { window.speechSynthesis?.cancel(); setNavigationActive(false); }} onChange={next => { setActiveStep(next); const step = navSteps[next]; mapRef.current?.flyTo([step.location[1], step.location[0]], 18); }} />}
        </div>
      </section>

      <nav className="mobile-nav">
        <button className={panel === "explore" ? "active" : ""} onClick={() => { setPanel("explore"); setRouteOpen(false); }}>⌖<span>Explore</span></button>
        <button onClick={() => setRouteOpen(true)}>↗<span>Directions</span></button>
        <button className={panel === "saved" ? "active" : ""} onClick={() => { setPanel("saved"); setRouteOpen(false); }}>♡<span>Saved</span></button>
        <button onClick={locateMe}>◎<span>Locate</span></button>
      </nav>
    </main>
  );
}

function formatInstruction(type: string, modifier?: string, road?: string) {
  const direction = modifier ? modifier.replace("slight ", "slightly ") : "straight";
  const name = road ? ` onto ${road}` : "";
  if (type === "depart") return `Start ${direction}${name}`;
  if (type === "arrive") return "You have arrived at your destination";
  if (type.includes("roundabout")) return `Enter the roundabout${name}`;
  if (type === "merge") return `Merge ${direction}${name}`;
  if (type === "continue" || type === "new name") return `Continue ${direction}${name}`;
  return `Turn ${direction}${name}`;
}

function NavigationPreview({ step, index, total, voiceEnabled, onToggleVoice, onRepeat, onClose, onChange }: { step: NavStep; index: number; total: number; voiceEnabled: boolean; onToggleVoice: () => void; onRepeat: () => void; onClose: () => void; onChange: (index: number) => void }) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const imageUrl = key ? `https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${step.location[1]},${step.location[0]}&heading=${step.heading}&fov=90&pitch=0&return_error_code=true&key=${key}` : "";
  return <div className="navigation-preview">
    <div className="nav-image">
      {imageUrl ? <img src={imageUrl} alt="Street-level preview for the next turn" /> : <div className="streetview-setup"><span>◉</span><b>Road preview ready</b><small>Add your Google Street View API key to display imagery here.</small></div>}
      <div className="nav-photo-label"><b>STREET PREVIEW</b><span>Imagery may not be current</span></div>
      <button className="nav-close" onClick={onClose}>×</button>
    </div>
    <div className="nav-instruction"><span className="turn-arrow">↱</span><div><small>IN {step.distance < 1000 ? `${Math.round(step.distance)} m` : `${(step.distance / 1000).toFixed(1)} km`}</small><h2>{step.instruction}</h2><p>Step {index + 1} of {total} · about {Math.max(1, Math.round(step.duration / 60))} min</p></div></div>
    <div className="voice-controls"><button className={voiceEnabled ? "voice-on" : ""} onClick={onToggleVoice}>{voiceEnabled ? "🔊 Voice on" : "🔇 Voice off"}</button><button onClick={onRepeat}>↻ Repeat instruction</button></div>
    <div className="nav-controls"><button disabled={index === 0} onClick={() => onChange(index - 1)}>‹ Previous</button><button disabled={index === total - 1} onClick={() => onChange(index + 1)}>Next turn ›</button></div>
  </div>;
}
