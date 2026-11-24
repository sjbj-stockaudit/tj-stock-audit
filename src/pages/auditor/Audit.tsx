import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtDistance, mapsLink } from '../../lib/format';
import { getPosition, tracker } from '../../lib/geo';
import type { Accessory, Photo, Tractor, VisitDetail } from '../../lib/types';
import { compareChassis, distanceMetres, idKey, type TractorStatus } from '../../../shared/domain';
import PhotoButton from '../../components/PhotoButton';
import SelfieCamera from '../../components/SelfieCamera';
import type { StampedPhoto } from '../../lib/camera';
import { useAuth } from '../../App';
import SignaturePad from '../../components/SignaturePad';
import { Button, Card, ErrorBox, Field, Loading, Modal, TractorBadge, VisitBadge, cx, inputCls, useLoad } from '../../components/ui';

type Tab = 'tractors' | 'extra' | 'accessories' | 'finish';

export default function Audit() {
  const { id } = useParams();
  const visitId = Number(id);
  const load = useLoad(() => api.get<VisitDetail>(`/visits/${visitId}`), [visitId]);
  const d = load.data;
  const setD = (fn: (d: VisitDetail) => VisitDetail) => load.setData((x) => (x ? fn(x) : x));
  const [tab, setTab] = useState<Tab>('tractors');

  // Record location from check-in until check-out
  const status = d?.visit.status;
  useEffect(() => {
    if (status === 'in_progress') tracker.start(visitId);
    else if (status) tracker.stop();
  }, [status, visitId]);

  if (!d) return load.error ? <ErrorBox error={load.error} /> : <Loading />;
  const v = d.visit;
  const place = `${v.centre_name}, ${v.state}`;

  const header = (
    <div className="mb-4">
      <Link to="/" className="text-sm text-brand-700">
        ← My centres
      </Link>
      <div className="mt-1 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{v.centre_name}</h1>
          <p className="text-xs text-slate-500">
            {fmtDate(v.audit_date)} · {d.tractors.filter((t) => t.source === 'inventory').length} tractors in stock list
          </p>
        </div>
        <VisitBadge status={v.status} />
      </div>
    </div>
  );

  if (v.status === 'assigned' || v.status === 'returned') return <>{header}<CheckIn d={d} onDone={load.reload} /></>;

  if (v.status === 'submitted' || v.status === 'approved')
    return (
      <>
        {header}
        <Card className="p-6 text-center">
          <div className="text-4xl">✅</div>
          <h2 className="mt-2 font-semibold">Audit submitted</h2>
          <p className="mt-1 text-sm text-slate-600">
            Submitted {fmtDateTime(v.submitted_at)}. Checked out {fmtDateTime(v.checkout_at)}.
          </p>
          <Link to="/" className="mt-4 inline-block font-medium text-brand-800">
            Back to my centres
          </Link>
        </Card>
      </>
    );

  const inv = d.tractors.filter((t) => t.source === 'inventory');
  const extras = d.tractors.filter((t) => t.source === 'extra');
  const checked = inv.filter((t) => t.status !== 'pending').length;

  return (
    <>
      {header}
      {v.review_note && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-medium">Correction needed:</span> {v.review_note}
        </div>
      )}
      <div className="mb-3">
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>
            {checked} of {inv.length} checked
          </span>
          <span>Location is being recorded until you submit</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${inv.length ? (checked / inv.length) * 100 : 100}%` }} />
        </div>
      </div>
      <Storefront d={d} place={place} setD={setD} />
      <div className="sticky top-[52px] z-[400] -mx-4 mb-4 grid grid-cols-4 border-b border-slate-200 bg-slate-50 px-2 text-sm">
        {(
          [
            ['tractors', `Stock (${inv.length})`],
            ['extra', `Extra (${extras.length})`],
            ['accessories', `Accessories (${d.accessories.length})`],
            ['finish', 'Finish'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('border-b-2 px-1 py-2.5', tab === k ? 'border-brand-700 font-semibold text-brand-900' : 'border-transparent text-slate-500')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'tractors' && <TractorList d={d} list={inv} place={place} setD={setD} />}
      {tab === 'extra' && <Extras d={d} place={place} setD={setD} />}
      {tab === 'accessories' && <Accessories d={d} place={place} setD={setD} />}
      {tab === 'finish' && <Finish d={d} setD={setD} onSubmitted={load.reload} goTo={setTab} />}
    </>
  );
}

// ------------------------------------------------------------------ check-in

function CheckIn({ d, onDone }: { d: VisitDetail; onDone: () => void }) {
  const v = d.visit;
  const { me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [far, setFar] = useState<{ lat: number; lng: number; accuracy: number; dist: number } | null>(null);
  const [selfie, setSelfie] = useState<StampedPhoto | null>(null);
  // A returned audit already has its check-in selfie; a new one is needed only the first time.
  const needsSelfie = !v.has_checkin_selfie;

  async function checkIn(force = false, photo = selfie) {
    if (needsSelfie && !photo) return setError('Take a selfie at the centre to check in.');
    setBusy(true);
    setError(null);
    try {
      const fix = far && force ? far : photo?.fix ?? (await getPosition());
      if (!force && v.lat != null && v.lng != null) {
        const dist = distanceMetres(fix.lat, fix.lng, v.lat, v.lng);
        if (dist > v.radius_m) {
          setFar({ ...fix, dist });
          return;
        }
      }
      const form = new FormData();
      if (photo) form.append('file', photo.blob, 'checkin-selfie.jpg');
      form.append('lat', String(fix.lat));
      form.append('lng', String(fix.lng));
      form.append('accuracy', String(fix.accuracy));
      await api.post(`/visits/${v.id}/checkin`, form);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {v.status === 'returned' && v.review_note && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-medium">Sent back by the office:</span> {v.review_note}
        </div>
      )}
      <Card className="p-4">
        <div className="text-sm text-slate-600">{v.address}</div>
        {(v.centre_manager || v.opening_hours || v.weekly_off) && (
          <div className="mt-2 space-y-0.5 text-sm">
            {v.centre_manager && (
              <div>
                Manager: <strong>{v.centre_manager}</strong>{' '}
                {v.centre_manager_phone && (
                  <a href={`tel:${v.centre_manager_phone}`} className="text-brand-700 underline">
                    {v.centre_manager_phone}
                  </a>
                )}
              </div>
            )}
            {(v.opening_hours || v.weekly_off) && (
              <div className="text-slate-600">
                {v.opening_hours}
                {v.weekly_off && ` · Closed ${v.weekly_off}`}
              </div>
            )}
          </div>
        )}
        <a
          href={mapsLink(v.lat, v.lng, v.address, v.centre_name)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-slate-300 py-3 font-medium text-slate-800"
        >
          Open directions in Google Maps
        </a>
      </Card>
      <Card className="p-4">
        <h2 className="font-semibold">{v.status === 'returned' ? 'Continue the audit' : 'Reached the centre?'}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {needsSelfie ? 'Take a selfie at the centre (with the showroom behind you if possible). ' : ''}
          Checking in records your location and time. Your location is recorded until you submit the audit.
        </p>
        <div className="mt-4 space-y-3">
          <ErrorBox error={error} />
          {far ? (
            <div className="space-y-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <p>
                You are <strong>{fmtDistance(far.dist)}</strong> from the centre's saved location. If you are at the centre, check in anyway – the
                office will see the distance.
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => (setFar(null), void checkIn())} disabled={busy}>
                  Try again
                </Button>
                <Button variant="warning" onClick={() => checkIn(true)} busy={busy}>
                  Check in anyway
                </Button>
              </div>
            </div>
          ) : needsSelfie ? (
            <SelfieCamera
              title={`Check-in · ${me.name}`}
              place={`${v.centre_name}, ${v.state}`}
              confirmLabel="Check in"
              busy={busy}
              onConfirm={(photo) => {
                setSelfie(photo);
                void checkIn(false, photo);
              }}
            />
          ) : (
            <Button size="lg" onClick={() => checkIn()} busy={busy}>
              {v.status === 'returned' ? 'Check in and fix' : 'Check in'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ storefront

/** Mandatory photo of the showroom front (with the board visible), once per visit. */
function Storefront({ d, place, setD }: { d: VisitDetail; place: string; setD: SetD }) {
  const photos = d.photos.filter((p) => p.kind === 'storefront');
  const done = photos.length > 0;
  return (
    <Card className={cx('mb-4 p-3', !done && 'border-amber-300 bg-amber-50')}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Storefront photo *</div>
        {done ? <span className="text-xs text-green-700">✓ Taken</span> : <span className="text-xs text-amber-800">Required</span>}
      </div>
      {!done && <p className="mb-2 text-xs text-amber-900">Stand outside and take the whole showroom front with the Tractor Junction board visible.</p>}
      <PhotoButton
        visitId={d.visit.id}
        kind="storefront"
        label="Storefront photo"
        stampTitle={`Storefront · ${d.visit.centre_name}`}
        place={place}
        photos={photos}
        required
        onChange={(ps) => setD((x) => replacePhotos(x, (p) => p.kind !== 'storefront', ps))}
      />
    </Card>
  );
}

// ------------------------------------------------------------------ tractor checklist

type SetD = (fn: (d: VisitDetail) => VisitDetail) => void;
const photosOf = (d: VisitDetail, t: Tractor) => d.photos.filter((p) => p.tractor_id === t.id);
const replacePhotos = (d: VisitDetail, keep: (p: Photo) => boolean, next: Photo[]) => ({ ...d, photos: [...d.photos.filter(keep), ...next] });

function TractorList({ d, list, place, setD }: { d: VisitDetail; list: Tractor[]; place: string; setD: SetD }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [open, setOpen] = useState<number | null>(null);
  const shown = useMemo(() => {
    const k = idKey(q);
    return list.filter(
      (t) =>
        (!k || idKey(t.reg_no).includes(k) || idKey(t.chassis_no).includes(k) || idKey(t.engine_no).includes(k)) &&
        (filter === 'all' || (filter === 'pending' ? t.status === 'pending' : t.status !== 'pending')),
    );
  }, [list, q, filter]);
  const current = d.tractors.find((t) => t.id === open) ?? null;

  const next = () => {
    const i = list.findIndex((t) => t.id === open);
    const n = [...list.slice(i + 1), ...list.slice(0, i)].find((t) => t.status === 'pending');
    setOpen(n?.id ?? null);
  };

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <input className={inputCls} placeholder="Search reg / chassis / engine no." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} w-auto`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter">
          <option value="all">All</option>
          <option value="pending">To check</option>
          <option value="done">Checked</option>
        </select>
      </div>
      <div className="space-y-2">
        {shown.map((t) => {
          const n = photosOf(d, t).filter((p) => p.kind === 'chassis').length;
          return (
            <button key={t.id} onClick={() => setOpen(t.id)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left">
              <div className="min-w-0">
                <div className="font-mono font-semibold">{t.reg_no || '—'}</div>
                <div className="truncate font-mono text-xs text-slate-500">Chassis {t.chassis_no}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <TractorBadge status={t.status} />
                {t.status !== 'pending' && t.status !== 'not_found' && (!n || !photosOf(d, t).some((p) => p.kind === 'tractor')) && (
                  <span className="text-xs text-amber-600">photo missing</span>
                )}
              </div>
            </button>
          );
        })}
        {!shown.length && <p className="p-4 text-center text-sm text-slate-500">No tractors match.</p>}
      </div>
      {current && (
        <TractorSheet
          key={current.id}
          d={d}
          t={current}
          place={place}
          onClose={() => setOpen(null)}
          onSaved={(t) => {
            setD((x) => ({ ...x, tractors: x.tractors.map((y) => (y.id === t.id ? t : y)) }));
            next();
          }}
          setD={setD}
        />
      )}
    </div>
  );
}

function TractorSheet({
  d,
  t,
  place,
  onClose,
  onSaved,
  setD,
}: {
  d: VisitDetail;
  t: Tractor;
  place: string;
  onClose: () => void;
  onSaved: (t: Tractor) => void;
  setD: SetD;
}) {
  const [reg, setReg] = useState(t.verified_reg ?? t.reg_no ?? '');
  const [chassis, setChassis] = useState(t.verified_chassis ?? '');
  const [remarks, setRemarks] = useState(t.remarks ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photos = photosOf(d, t);
  const chassisPhotos = photos.filter((p) => p.kind === 'chassis');
  const cmp = compareChassis(t.chassis_no, chassis);
  const name = t.reg_no || t.chassis_no || 'Tractor';

  async function save(status: TractorStatus) {
    setError(null);
    if (status !== 'not_found' && !chassisPhotos.length) return setError('Take a photo of the chassis number first.');
    if (status !== 'not_found' && !photos.some((p) => p.kind === 'tractor')) return setError('Take a photo of the whole tractor.');
    if (status !== 'not_found' && !idKey(chassis)) return setError('Type the chassis number you see on the tractor.');
    if (status === 'mismatch' && !remarks.trim()) return setError('Add a remark explaining the mismatch.');
    setBusy(true);
    try {
      const saved = await api.patch<Tractor>(`/tractors/${t.id}`, {
        status,
        verified_reg: status === 'not_found' ? null : reg,
        // A near-match the auditor confirmed as the same plate is a typo: record the correct number
        verified_chassis: status === 'not_found' ? null : status === 'verified' && cmp === 'near' ? t.chassis_no : chassis,
        remarks,
      });
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={name}>
      <div className="space-y-4">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm">
          <span className="text-slate-500">Reg. no</span>
          <span className="font-mono font-semibold">{t.reg_no}</span>
          <span className="text-slate-500">Chassis</span>
          <span className="font-mono font-semibold break-all">{t.chassis_no}</span>
          <span className="text-slate-500">Engine</span>
          <span className="font-mono break-all">{t.engine_no}</span>
        </div>

        <Field group label="1. Photo of the chassis number *">
          <PhotoButton
            visitId={d.visit.id}
            kind="chassis"
            label="Chassis photo"
            stampTitle={`${name} · Chassis ${t.chassis_no ?? ''}`}
            place={place}
            tractorId={t.id}
            photos={chassisPhotos}
            required
            onChange={(ps) => setD((x) => replacePhotos(x, (p) => !(p.tractor_id === t.id && p.kind === 'chassis'), ps))}
          />
        </Field>
        <Field group label="2. Photo of the whole tractor *">
          <PhotoButton
            visitId={d.visit.id}
            kind="tractor"
            label="Tractor photo"
            stampTitle={`${name} · Tractor`}
            place={place}
            tractorId={t.id}
            photos={photos.filter((p) => p.kind === 'tractor')}
            required
            onChange={(ps) => setD((x) => replacePhotos(x, (p) => !(p.tractor_id === t.id && p.kind === 'tractor'), ps))}
          />
        </Field>

        <Field label="3. Chassis number on the tractor *" hint="Type exactly what is punched on the chassis.">
          <input className={`${inputCls} font-mono uppercase`} value={chassis} onChange={(e) => setChassis(e.target.value.toUpperCase())} autoCapitalize="characters" />
        </Field>
        {cmp === 'match' && <p className="-mt-2 text-sm font-medium text-green-700">✓ Matches the stock list</p>}
        {cmp === 'near' && <p className="-mt-2 text-sm font-medium text-amber-700">Almost matches – check each character (0/O, 1/I, 5/S, 8/B).</p>}
        {cmp === 'different' && <p className="-mt-2 text-sm font-medium text-red-600">Does not match the stock list ({t.chassis_no}).</p>}

        <Field label="RC / registration number seen">
          <input className={`${inputCls} font-mono uppercase`} value={reg} onChange={(e) => setReg(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Remarks">
          <input className={inputCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional (required for mismatch)" />
        </Field>
        <ErrorBox error={error} />
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={() => save('verified')} busy={busy} disabled={cmp !== 'match' && cmp !== 'near'} className="py-3">
            ✓ Verified
          </Button>
          <Button variant="warning" onClick={() => save('mismatch')} disabled={busy || cmp === 'empty'} className="py-3">
            Mismatch
          </Button>
          <Button variant="danger" onClick={() => save('not_found')} disabled={busy} className="py-3">
            Not found
          </Button>
        </div>
        {t.status !== 'pending' && (
          <p className="text-center text-xs text-slate-500">
            Currently marked <TractorBadge status={t.status} />
          </p>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ extras

function Extras({ d, place, setD }: { d: VisitDetail; place: string; setD: SetD }) {
  const extras = d.tractors.filter((t) => t.source === 'extra');
  const [f, setF] = useState({ reg_no: '', chassis_no: '', remarks: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const t = await api.post<Tractor>(`/visits/${d.visit.id}/tractors`, f);
      setD((x) => ({ ...x, tractors: [...x.tractors, t] }));
      setF({ reg_no: '', chassis_no: '', remarks: '' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(t: Tractor) {
    if (!confirm(`Remove extra tractor ${t.reg_no ?? t.chassis_no}?`)) return;
    await api.del(`/tractors/${t.id}`);
    setD((x) => ({ ...x, tractors: x.tractors.filter((y) => y.id !== t.id), photos: x.photos.filter((p) => p.tractor_id !== t.id) }));
  }

  // Warn if the "extra" is actually in the stock list
  const listed = (chassis: string) => d.tractors.find((t) => t.source === 'inventory' && idKey(t.chassis_no) === idKey(chassis) && idKey(chassis));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Tractors physically at the centre that are <strong>not</strong> in the stock list.</p>
      {extras.map((t) => (
        <Card key={t.id} className="space-y-3 p-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono font-semibold">{t.reg_no || 'No reg. no'}</div>
              <div className="font-mono text-xs text-slate-500">Chassis {t.chassis_no || '—'}</div>
              {t.remarks && <div className="text-xs text-slate-600">{t.remarks}</div>}
            </div>
            <button onClick={() => remove(t)} className="text-sm text-red-600">
              Remove
            </button>
          </div>
          <PhotoButton
            visitId={d.visit.id}
            kind="chassis"
            label="Chassis photo"
            stampTitle={`EXTRA ${t.reg_no ?? ''} · Chassis ${t.chassis_no ?? ''}`}
            place={place}
            tractorId={t.id}
            required
            photos={photosOf(d, t).filter((p) => p.kind === 'chassis')}
            onChange={(ps) => setD((x) => replacePhotos(x, (p) => !(p.tractor_id === t.id && p.kind === 'chassis'), ps))}
          />
          <PhotoButton
            visitId={d.visit.id}
            kind="tractor"
            label="Tractor photo"
            stampTitle={`EXTRA ${t.reg_no ?? ''} · Tractor`}
            place={place}
            tractorId={t.id}
            required
            photos={photosOf(d, t).filter((p) => p.kind === 'tractor')}
            onChange={(ps) => setD((x) => replacePhotos(x, (p) => !(p.tractor_id === t.id && p.kind === 'tractor'), ps))}
          />
        </Card>
      ))}
      <Card className="space-y-3 p-3">
        <h3 className="font-semibold">Add extra tractor</h3>
        <Field label="Registration no.">
          <input className={`${inputCls} font-mono uppercase`} value={f.reg_no} onChange={(e) => setF({ ...f, reg_no: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Chassis no.">
          <input className={`${inputCls} font-mono uppercase`} value={f.chassis_no} onChange={(e) => setF({ ...f, chassis_no: e.target.value.toUpperCase() })} />
        </Field>
        {listed(f.chassis_no) && <p className="text-sm text-amber-700">This chassis is in the stock list ({listed(f.chassis_no)!.reg_no}). Check it in the Stock tab instead.</p>}
        <Field label="Remarks">
          <input className={inputCls} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
        </Field>
        <ErrorBox error={error} />
        <Button onClick={add} busy={busy} disabled={!f.reg_no.trim() && !f.chassis_no.trim()}>
          Add, then take photos
        </Button>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ accessories

const ACCESSORY_SUGGESTIONS = ['Top Link', 'Drawer Patti', 'Old Battery', 'New Battery', 'Hood', 'Front Tyre', 'Rear Tyre', 'Rim', 'Trolley', 'Cultivator', 'Rotavator'];

function Accessories({ d, place, setD }: { d: VisitDetail; place: string; setD: SetD }) {
  const [f, setF] = useState({ name: '', qty: '1', remarks: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const a = await api.post<Accessory>(`/visits/${d.visit.id}/accessories`, f);
      setD((x) => ({ ...x, accessories: [...x.accessories, a] }));
      setF({ name: '', qty: '1', remarks: '' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(a: Accessory) {
    if (!confirm(`Remove ${a.name}?`)) return;
    await api.del(`/accessories/${a.id}`);
    setD((x) => ({ ...x, accessories: x.accessories.filter((y) => y.id !== a.id), photos: x.photos.filter((p) => p.accessory_id !== a.id) }));
  }

  return (
    <div className="space-y-4">
      {d.accessories.map((a) => (
        <Card key={a.id} className="space-y-2 p-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-semibold">
                {a.name} <span className="font-normal text-slate-500">× {a.qty}</span>
              </div>
              {a.remarks && <div className="text-xs text-slate-600">{a.remarks}</div>}
            </div>
            <button onClick={() => remove(a)} className="text-sm text-red-600">
              Remove
            </button>
          </div>
          <PhotoButton
            visitId={d.visit.id}
            kind="accessory"
            label="Photo"
            stampTitle={`${a.name} × ${a.qty}`}
            place={place}
            accessoryId={a.id}
            required
            photos={d.photos.filter((p) => p.accessory_id === a.id)}
            onChange={(ps) => setD((x) => replacePhotos(x, (p) => p.accessory_id !== a.id, ps))}
          />
        </Card>
      ))}
      <Card className="space-y-3 p-3">
        <h3 className="font-semibold">Add accessory</h3>
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Field label="Item">
            <input className={inputCls} list="acc-suggest" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <datalist id="acc-suggest">
              {ACCESSORY_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Qty">
            <input className={inputCls} type="number" inputMode="numeric" min={0} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          </Field>
        </div>
        <Field label="Remarks">
          <input className={inputCls} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} placeholder="e.g. 2 bundles of 5, 2 unpacked" />
        </Field>
        <ErrorBox error={error} />
        <Button onClick={add} busy={busy} disabled={!f.name.trim()}>
          Add, then take photo
        </Button>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ finish: signatures & submit

function Finish({ d, setD, onSubmitted, goTo }: { d: VisitDetail; setD: SetD; onSubmitted: () => void; goTo: (t: Tab) => void }) {
  const v = d.visit;
  const navigate = useNavigate();
  const [manager, setManager] = useState(v.manager_name ?? v.centre_manager ?? '');
  const [remarks, setRemarks] = useState(v.general_remarks ?? '');
  const [sigBusy, setSigBusy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; problems?: string[] } | null>(null);

  const problems = useMemo(() => {
    const p: { msg: string; tab: Tab }[] = [];
    const pending = d.tractors.filter((t) => t.status === 'pending').length;
    if (pending) p.push({ msg: `${pending} tractor(s) not checked yet`, tab: 'tractors' });
    const noPhoto = d.tractors.filter((t) => t.status !== 'pending' && t.status !== 'not_found' && !d.photos.some((x) => x.tractor_id === t.id && x.kind === 'chassis'));
    if (noPhoto.length) p.push({ msg: `${noPhoto.length} tractor(s) without chassis photo`, tab: noPhoto.some((t) => t.source === 'extra') ? 'extra' : 'tractors' });
    const noTractor = d.tractors.filter((t) => t.status !== 'pending' && t.status !== 'not_found' && !d.photos.some((x) => x.tractor_id === t.id && x.kind === 'tractor'));
    if (noTractor.length) p.push({ msg: `${noTractor.length} tractor(s) without tractor photo`, tab: noTractor.some((t) => t.source === 'extra') ? 'extra' : 'tractors' });
    const accNo = d.accessories.filter((a) => !d.photos.some((x) => x.accessory_id === a.id));
    if (accNo.length) p.push({ msg: `${accNo.length} accessory item(s) without photo`, tab: 'accessories' });
    if (!d.photos.some((x) => x.kind === 'storefront')) p.push({ msg: 'Storefront photo not taken (top of the page)', tab: 'tractors' });
    return p;
  }, [d]);

  async function saveSig(who: 'auditor' | 'manager', png: Blob) {
    setSigBusy(who);
    try {
      const form = new FormData();
      form.append('file', png, `${who}.png`);
      await api.put(`/visits/${v.id}/signature/${who}`, form);
      setD((x) => ({ ...x, visit: { ...x.visit, [who === 'auditor' ? 'has_auditor_signature' : 'has_manager_signature']: true } }));
    } catch (e) {
      setError({ msg: (e as Error).message });
    } finally {
      setSigBusy(null);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const fix = await getPosition().catch(() => null);
      await api.post(`/visits/${v.id}/submit`, { manager_name: manager, general_remarks: remarks, lat: fix?.lat, lng: fix?.lng });
      tracker.stop();
      onSubmitted();
      navigate('/');
    } catch (e) {
      setError({ msg: (e as Error).message, problems: e instanceof ApiError ? e.problems : [] });
    } finally {
      setBusy(false);
    }
  }

  const inv = d.tractors.filter((t) => t.source === 'inventory');
  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm">
        <h3 className="mb-2 font-semibold">Summary</h3>
        <div className="grid grid-cols-2 gap-1">
          <span>Verified</span>
          <span className="text-right font-semibold">{inv.filter((t) => t.status === 'verified').length}</span>
          <span>Chassis mismatch</span>
          <span className="text-right font-semibold">{inv.filter((t) => t.status === 'mismatch').length}</span>
          <span>Not found (short)</span>
          <span className="text-right font-semibold">{inv.filter((t) => t.status === 'not_found').length}</span>
          <span>Extra</span>
          <span className="text-right font-semibold">{d.tractors.filter((t) => t.source === 'extra').length}</span>
          <span>Accessory items</span>
          <span className="text-right font-semibold">{d.accessories.length}</span>
        </div>
        {problems.length > 0 && (
          <div className="mt-3 space-y-1 rounded-lg bg-amber-50 p-2">
            {problems.map((p) => (
              <button key={p.msg} onClick={() => goTo(p.tab)} className="block text-left text-amber-800 underline">
                ⚠ {p.msg}
              </button>
            ))}
          </div>
        )}
      </Card>
      <Field label="General remarks (optional)">
        <textarea className={inputCls} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <Card className="space-y-2 p-4">
        <h3 className="font-semibold">Auditor signature</h3>
        <SignaturePad onSave={(b) => saveSig('auditor', b)} saved={v.has_auditor_signature} busy={sigBusy === 'auditor'} />
      </Card>
      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">Outlet manager</h3>
        <Field label="Manager's name *">
          <input className={inputCls} value={manager} onChange={(e) => setManager(e.target.value)} />
        </Field>
        <SignaturePad onSave={(b) => saveSig('manager', b)} saved={v.has_manager_signature} busy={sigBusy === 'manager'} />
      </Card>
      <ErrorBox error={error?.msg} problems={error?.problems} />
      <Button size="lg" onClick={submit} busy={busy} disabled={problems.length > 0 || !manager.trim() || !v.has_auditor_signature || !v.has_manager_signature}>
        Submit audit and check out
      </Button>
      <p className="text-center text-xs text-slate-500">After submitting you cannot edit unless the office sends it back.</p>
    </div>
  );
}
