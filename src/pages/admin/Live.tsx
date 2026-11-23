import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDistance, fmtTime } from '../../lib/format';
import { distanceMetres } from '../../../shared/domain';
import MapView, { type MapMarker } from '../../components/MapView';
import { Card, Empty, ErrorBox, Loading, PageTitle, useLoad } from '../../components/ui';

type LiveRow = {
  visit_id: number;
  checkin_at: string;
  centre_name: string;
  centre_lat: number | null;
  centre_lng: number | null;
  auditor_name: string;
  auditor_phone: string | null;
  lat: number | null;
  lng: number | null;
  last_seen: string | null;
  done_count: number;
  total_count: number;
};

export default function Live() {
  const live = useLoad(() => api.get<LiveRow[]>('/live'));
  useEffect(() => {
    const t = setInterval(live.reload, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markers = useMemo<MapMarker[]>(
    () =>
      (live.data ?? []).flatMap((r) => [
        ...(r.centre_lat != null && r.centre_lng != null ? [{ lat: r.centre_lat, lng: r.centre_lng, label: r.centre_name, color: '#15803d' }] : []),
        ...(r.lat != null && r.lng != null ? [{ lat: r.lat, lng: r.lng, label: `${r.auditor_name} · ${fmtTime(r.last_seen)}`, color: '#2563eb' }] : []),
      ]),
    [live.data],
  );

  return (
    <div>
      <PageTitle title="Live map" sub="Auditors currently checked in. Refreshes every minute. Green = centre, blue = auditor's last location." />
      <ErrorBox error={live.error} />
      {!live.data ? (
        <Loading />
      ) : (
        <>
          <MapView markers={markers} height={420} />
          <div className="mt-4">
            {!live.data.length ? (
              <Empty>No auditor is checked in right now.</Empty>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">Auditor</th>
                      <th className="px-3 py-2">Centre</th>
                      <th className="px-3 py-2">Checked in</th>
                      <th className="px-3 py-2">Last location</th>
                      <th className="px-3 py-2">From centre</th>
                      <th className="px-3 py-2">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.data.map((r) => {
                      const dist =
                        r.lat != null && r.lng != null && r.centre_lat != null && r.centre_lng != null
                          ? distanceMetres(r.lat, r.lng, r.centre_lat, r.centre_lng)
                          : null;
                      const stale = r.last_seen ? Date.now() - Date.parse(r.last_seen) > 30 * 60_000 : true;
                      return (
                        <tr key={r.visit_id} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-2">
                            {r.auditor_name}
                            {r.auditor_phone && (
                              <a href={`tel:${r.auditor_phone}`} className="ml-2 text-xs text-brand-700">
                                call
                              </a>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Link to={`/visits/${r.visit_id}`} className="text-brand-800 hover:underline">
                              {r.centre_name}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{fmtTime(r.checkin_at)}</td>
                          <td className={`px-3 py-2 ${stale ? 'text-amber-600' : ''}`}>
                            {fmtTime(r.last_seen)}
                            {stale && ' (no update in 30 min)'}
                          </td>
                          <td className={`px-3 py-2 ${dist != null && dist > 500 ? 'font-semibold text-red-600' : ''}`}>{fmtDistance(dist)}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {r.done_count}/{r.total_count}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
