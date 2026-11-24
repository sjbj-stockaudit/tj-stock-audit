import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, photoUrl, signatureUrl } from '../lib/api';
import { fmtDate, fmtDateTime, fmtDistance, fmtHours, hoursBetween } from '../lib/format';
import { downloadCentreExcel, downloadCentreReport, summarise } from '../lib/reports';
import type { Photo, Tractor, User, VisitDetail } from '../lib/types';
import { FACILITY_RATING_LABEL, compareChassis } from '../../shared/domain';
import { useAuth } from '../App';
import MapView, { type MapMarker } from '../components/MapView';
import { Button, Card, ErrorBox, Field, Loading, Modal, PageTitle, Stat, TractorBadge, VisitBadge, inputCls, useLoad } from '../components/ui';

export default function VisitView() {
  const { id } = useParams();
  const { me } = useAuth();
  const isAdmin = me.role === 'admin';
  const navigate = useNavigate();
  const detail = useLoad(() => api.get<VisitDetail>(`/visits/${id}`), [id]);
  const users = useLoad(() => (isAdmin ? api.get<User[]>('/users') : Promise.resolve([] as User[])));
  const [zoom, setZoom] = useState<Photo | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const d = detail.data;
  const markers = useMemo<MapMarker[]>(() => {
    if (!d) return [];
    const m: MapMarker[] = [];
    const v = d.visit;
    if (v.lat != null && v.lng != null) m.push({ lat: v.lat, lng: v.lng, label: `${v.centre_name} centre`, color: '#15803d', radius: v.radius_m });
    if (v.checkin_lat != null && v.checkin_lng != null)
      m.push({ lat: v.checkin_lat, lng: v.checkin_lng, label: `Check-in ${fmtDateTime(v.checkin_at)}`, color: '#2563eb' });
    if (v.checkout_lat != null && v.checkout_lng != null)
      m.push({ lat: v.checkout_lat, lng: v.checkout_lng, label: `Check-out ${fmtDateTime(v.checkout_at)}`, color: '#7c3aed' });
    return m;
  }, [d]);
  const trail = useMemo<[number, number][]>(() => (d?.pings ?? []).map((p) => [p.lat, p.lng]), [d]);

  if (detail.error) return <ErrorBox error={detail.error} />;
  if (!d) return <Loading />;
  const v = d.visit;
  const sum = summarise(d);
  const photosOf = (t: Tractor) => d.photos.filter((p) => p.tractor_id === t.id);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      detail.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download(kind: 'zip' | 'xlsx') {
    setError(null);
    setProgress('Preparing…');
    try {
      if (kind === 'zip') await downloadCentreReport(v.id, setProgress);
      else await downloadCentreExcel(v.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div>
      <div className="mb-2 text-sm">
        <Link to={isAdmin ? '/visits' : '/'} className="text-brand-700 hover:underline">
          ← All audits
        </Link>
      </div>
      <PageTitle
        title={`${v.centre_name}, ${v.state}`}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            {fmtDate(v.audit_date)} · {v.auditor_name ?? 'No auditor'} <VisitBadge status={v.status} />
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => download('xlsx')} disabled={!!progress}>
              Excel
            </Button>
            <Button onClick={() => download('zip')} busy={!!progress}>
              {progress ?? 'Download full report'}
            </Button>
          </>
        }
      />
      <ErrorBox error={error} />

      {isAdmin && v.status === 'submitted' && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-amber-300 bg-amber-50 p-4">
          <div className="text-sm">
            <div className="font-medium">Submitted {fmtDateTime(v.submitted_at)}. Review the photos below, then approve.</div>
            <div className="text-slate-600">Approved audits become visible to the client and count for billing.</div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setReturnOpen(true)} disabled={busy}>
              Send back to auditor
            </Button>
            <Button onClick={() => act(() => api.post(`/visits/${v.id}/review`, { action: 'approve' }))} busy={busy}>
              Approve
            </Button>
          </div>
        </Card>
      )}
      {v.status === 'returned' && v.review_note && (
        <Card className="mb-4 border-red-200 bg-red-50 p-4 text-sm">
          <span className="font-medium">Sent back to auditor:</span> {v.review_note}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="In inventory" value={sum.inventory} />
        <Stat label="Verified" value={sum.verified} tone="green" />
        <Stat label="Short (not found)" value={sum.short.length} tone={sum.short.length ? 'red' : undefined} />
        <Stat label="Extra" value={sum.extra.length} tone={sum.extra.length ? 'blue' : undefined} />
        <Stat label="Chassis mismatch" value={sum.mismatch.length} tone={sum.mismatch.length ? 'amber' : undefined} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-4 text-sm lg:col-span-1">
          <h2 className="mb-2 font-semibold">Visit</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-slate-500">Auditor</dt>
            <dd>
              {v.auditor_name ?? '—'} {isAdmin && v.auditor_phone && <a className="text-brand-700" href={`tel:${v.auditor_phone}`}>{v.auditor_phone}</a>}
            </dd>
            <dt className="text-slate-500">Manager</dt>
            <dd>{v.manager_name ?? '—'}</dd>
            <dt className="text-slate-500">Check-in</dt>
            <dd>{fmtDateTime(v.checkin_at)}</dd>
            <dt className="text-slate-500">Check-out</dt>
            <dd>{fmtDateTime(v.checkout_at)}</dd>
            <dt className="text-slate-500">Time on site</dt>
            <dd>{fmtHours(hoursBetween(v.checkin_at, v.checkout_at))}</dd>
            {isAdmin && (
              <>
                <dt className="text-slate-500">Check-in distance</dt>
                <dd className={v.checkin_distance_m != null && v.checkin_distance_m > v.radius_m ? 'font-semibold text-red-600' : ''}>
                  {v.checkin_distance_m != null ? `${fmtDistance(v.checkin_distance_m)} from centre` : 'Centre location was set by this check-in'}
                </dd>
              </>
            )}
            {v.general_remarks && (
              <>
                <dt className="text-slate-500">Remarks</dt>
                <dd>{v.general_remarks}</dd>
              </>
            )}
            {v.reviewer_name && v.status === 'approved' && (
              <>
                <dt className="text-slate-500">Approved</dt>
                <dd>
                  {fmtDateTime(v.reviewed_at)} by {v.reviewer_name}
                </dd>
              </>
            )}
          </dl>
          {(v.has_checkin_selfie || d.photos.some((p) => p.kind === 'storefront')) && (
            <div className="mt-3 flex flex-wrap gap-3">
              {d.photos
                .filter((p) => p.kind === 'storefront')
                .map((p) => (
                  <div key={p.id}>
                    <div className="mb-1 text-slate-500">Storefront</div>
                    <button onClick={() => setZoom(p)}>
                      <img src={photoUrl(p.id)} alt="Storefront" className="h-40 rounded-lg object-cover ring-1 ring-slate-200" />
                    </button>
                  </div>
                ))}
              {v.has_checkin_selfie && (
                <div>
                  <div className="mb-1 text-slate-500">Auditor selfie at check-in (visible to your office only)</div>
                  <a href={`/api/visits/${v.id}/checkin-selfie`} target="_blank" rel="noreferrer">
                    <img src={`/api/visits/${v.id}/checkin-selfie`} alt="Auditor selfie at check-in" className="h-40 rounded-lg object-cover ring-1 ring-slate-200" />
                  </a>
                </div>
              )}
            </div>
          )}
          {isAdmin && <AdminControls d={d} users={users.data ?? []} busy={busy} act={act} onDeleted={() => navigate('/visits')} />}
        </Card>
        {isAdmin && (
          <div className="lg:col-span-2">
            {markers.length || trail.length ? (
              <MapView markers={markers} trail={trail} height={320} />
            ) : (
              <Card className="flex h-full min-h-40 items-center justify-center p-4 text-sm text-slate-500">No location recorded yet.</Card>
            )}
            {isAdmin && d.pings.length > 0 && <p className="mt-1 text-xs text-slate-500">Blue line: {d.pings.length} location points between check-in and check-out.</p>}
          </div>
        )}
      </div>

      <h2 className="mt-8 mb-3 font-semibold">Tractors ({d.tractors.length})</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2">Reg. no (inventory)</th>
              <th className="px-3 py-2">Chassis (inventory)</th>
              <th className="px-3 py-2">RC seen</th>
              <th className="px-3 py-2">Chassis seen</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Remarks</th>
              <th className="px-3 py-2">Photos</th>
            </tr>
          </thead>
          <tbody>
            {d.tractors.map((t) => {
              const cmp = t.source === 'inventory' ? compareChassis(t.chassis_no, t.verified_chassis) : 'match';
              return (
                <tr key={t.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{t.source === 'extra' ? <em className="text-slate-400">not listed</em> : t.reg_no}</td>
                  <td className="px-3 py-2 font-mono text-xs">{t.source === 'extra' ? '' : t.chassis_no}</td>
                  <td className="px-3 py-2 font-mono text-xs">{t.verified_reg}</td>
                  <td className={`px-3 py-2 font-mono text-xs ${cmp !== 'match' && cmp !== 'empty' ? 'text-amber-700' : ''}`}>{t.verified_chassis}</td>
                  <td className="px-3 py-2">
                    <TractorBadge status={t.status} />
                  </td>
                  <td className="max-w-48 px-3 py-2 text-xs">{t.remarks}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {photosOf(t).map((p) => (
                        <button key={p.id} onClick={() => setZoom(p)} className="shrink-0" aria-label={`${p.kind} photo`}>
                          <img src={photoUrl(p.id)} alt="" loading="lazy" className="h-12 w-12 rounded object-cover ring-1 ring-slate-200" />
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <h2 className="mt-8 mb-3 font-semibold">Accessories ({d.accessories.length})</h2>
      {d.accessories.length === 0 ? (
        <p className="text-sm text-slate-500">None recorded.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {d.accessories.map((a) => (
            <Card key={a.id} className="p-3 text-sm">
              <div className="font-medium">
                {a.name} <span className="font-normal text-slate-500">× {a.qty}</span>
              </div>
              {a.remarks && <div className="text-slate-600">{a.remarks}</div>}
              <div className="mt-2 flex flex-wrap gap-1">
                {d.photos
                  .filter((p) => p.accessory_id === a.id)
                  .map((p) => (
                    <button key={p.id} onClick={() => setZoom(p)}>
                      <img src={photoUrl(p.id)} alt={a.name} loading="lazy" className="h-16 w-16 rounded object-cover ring-1 ring-slate-200" />
                    </button>
                  ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {d.facility.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 font-semibold">Facility condition</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.facility.map((f) => (
              <Card key={f.id} className="p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{f.area}</div>
                  {f.rating && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                        { good: 'bg-green-100 text-green-800', average: 'bg-amber-100 text-amber-800', poor: 'bg-red-100 text-red-800', na: 'bg-slate-100 text-slate-600' }[f.rating]
                      }`}
                    >
                      {FACILITY_RATING_LABEL[f.rating]}
                    </span>
                  )}
                </div>
                {f.remarks && <div className="mt-1 text-slate-600">{f.remarks}</div>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {d.photos
                    .filter((p) => p.facility_id === f.id)
                    .map((p) => (
                      <button key={p.id} onClick={() => setZoom(p)}>
                        <img src={photoUrl(p.id)} alt={f.area} loading="lazy" className="h-16 w-16 rounded object-cover ring-1 ring-slate-200" />
                      </button>
                    ))}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {(v.has_auditor_signature || v.has_manager_signature) && (
        <>
          <h2 className="mt-8 mb-3 font-semibold">Signatures</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['auditor', 'manager'] as const).map((who) => (
              <Card key={who} className="p-3 text-sm">
                <div className="text-slate-500">{who === 'auditor' ? `Auditor – ${v.auditor_name}` : `Manager – ${v.manager_name ?? ''}`}</div>
                {(who === 'auditor' ? v.has_auditor_signature : v.has_manager_signature) && (
                  <img src={signatureUrl(v.id, who)} alt={`${who} signature`} className="mt-2 h-24 object-contain" />
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      <Modal open={!!zoom} onClose={() => setZoom(null)} title="Photo" wide>
        {zoom && (
          <div>
            <img src={photoUrl(zoom.id)} alt="" className="mx-auto max-h-[75vh] rounded" />
            <p className="mt-2 text-center text-xs text-slate-500">
              Taken {fmtDateTime(zoom.taken_at)}
              {zoom.lat != null && ` · ${zoom.lat.toFixed(5)}, ${zoom.lng?.toFixed(5)}`}
            </p>
          </div>
        )}
      </Modal>
      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title="Send back to auditor">
        <div className="space-y-3">
          <Field label="What needs fixing?" hint="The auditor sees this and can correct the audit, then submit again.">
            <textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button
            variant="warning"
            busy={busy}
            disabled={!note.trim()}
            onClick={() =>
              act(async () => {
                await api.post(`/visits/${v.id}/review`, { action: 'return', note });
                setReturnOpen(false);
                setNote('');
              })
            }
          >
            Send back
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function AdminControls({
  d,
  users,
  busy,
  act,
  onDeleted,
}: {
  d: VisitDetail;
  users: User[];
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onDeleted: () => void;
}) {
  const v = d.visit;
  const canReassign = v.status === 'assigned' || v.status === 'returned' || v.status === 'in_progress';
  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      {canReassign && (
        <Field label="Auditor">
          <select
            className={inputCls}
            value={v.auditor_id ?? ''}
            disabled={busy}
            onChange={(e) => act(() => api.patch(`/visits/${v.id}`, { auditor_id: e.target.value ? Number(e.target.value) : null }))}
          >
            <option value="">Not assigned</option>
            {users
              .filter((u) => u.role === 'auditor' && (u.active || u.id === v.auditor_id))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      {v.status === 'approved' && (
        <Button variant="secondary" size="sm" busy={busy} onClick={() => act(() => api.post(`/visits/${v.id}/review`, { action: 'unapprove' }))}>
          Undo approval
        </Button>
      )}
      {v.status !== 'approved' && (
        <Button
          variant="ghost"
          size="sm"
          className="text-red-600"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete the ${v.centre_name} audit for ${fmtDate(v.audit_date)} and all its photos? This cannot be undone.`))
              void act(async () => {
                await api.del(`/visits/${v.id}`);
                onDeleted();
              });
          }}
        >
          Delete this audit
        </Button>
      )}
    </div>
  );
}
