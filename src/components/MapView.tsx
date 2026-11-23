import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapMarker = { lat: number; lng: number; label: string; color?: string; radius?: number };

/** OpenStreetMap map (free, no API key). Draws markers, an optional trail, and optional circles. */
export default function MapView({
  markers,
  trail,
  height = 360,
}: {
  markers: MapMarker[];
  trail?: [number, number][];
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { scrollWheelZoom: false }).setView([23.5, 78.5], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const pts: L.LatLngExpression[] = [];
    if (trail && trail.length > 1) {
      L.polyline(trail, { color: '#2563eb', weight: 3, opacity: 0.7 }).addTo(g);
      pts.push(...trail);
    }
    for (const mk of markers) {
      if (mk.radius)
        L.circle([mk.lat, mk.lng], { radius: mk.radius, color: mk.color ?? '#15803d', weight: 1, fillOpacity: 0.08 }).addTo(g);
      L.circleMarker([mk.lat, mk.lng], { radius: 8, color: '#fff', weight: 2, fillColor: mk.color ?? '#15803d', fillOpacity: 1 })
        .bindTooltip(mk.label)
        .addTo(g);
      pts.push([mk.lat, mk.lng]);
    }
    if (pts.length === 1) m.setView(pts[0], 15);
    else if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
  }, [markers, trail]);

  return <div ref={el} style={{ height }} className="z-0 w-full overflow-hidden rounded-xl border border-slate-200" />;
}
