import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtDistance, mapsLink } from '../../lib/format';
import { getPosition, isAndroidApp, keepScreenOn, openAppSettings, tracker } from '../../lib/geo';
import { isDocumentPhoto, type Accessory, type FacilityCheck, type Photo, type SeenTractor, type Tractor, type VisitDetail, type VisitLocation } from '../../lib/types';
import { FACILITY_RATING_LABEL, distanceMetres, facilityProblem, type FacilityRating } from '../../../shared/domain';
import PhotoButton from '../../components/PhotoButton';
import SelfieCamera from '../../components/SelfieCamera';
import LiveCamera from '../../components/LiveCamera';
import type { StampedPhoto } from '../../lib/camera';
import { useAuth } from '../../App';
import SignaturePad from '../../components/SignaturePad';
import { useT } from '../../lib/i18n';
import { Button, Card, ErrorBox, Field, Loading, Modal, VisitBadge, cx, inputCls, useLoad } from '../../components/ui';

type Tab = 'tractors' | 'accessories' | 'facility' | 'finish';

export default function Audit() {
  const tr = useT();
  const { id } = useParams();
  const visitId = Number(id);
  const load = useLoad(() => api.get<VisitDetail>(`/visits/${visitId}`), [visitId]);
  const d = load.data;
  const setD = (fn: (d: VisitDetail) => VisitDetail) => load.setData((x) => (x ? fn(x) : x));
  const [tab, setTab] = useState<Tab>('tractors');

  // Record location from check-in until check-out
  const status = d?.visit.status;
  useEffect(() => {
    if (status === 'in_progress') {
      tracker.start(visitId);
      keepScreenOn(true);
    } else if (status) tracker.stop();
    return () => keepScreenOn(false);
  }, [status, visitId]);

  if (!d) return load.error ? <ErrorBox error={load.error} /> : <Loading />;
  const v = d.visit;
  const place = `${v.centre_name}, ${v.state}`;

  const header = (
    <div className="mb-4">
      <Link to="/" className="text-sm text-brand-700">
        {tr('← My centres')}
      </Link>
      <div className="mt-1 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{v.centre_name}</h1>
          <p className="text-xs text-slate-500">{fmtDate(v.audit_date)}</p>
        </div>
        <VisitBadge status={v.status} />
      </div>
    </div>
  );

  if (v.status === 'assigned' || v.status === 'returned')
    return (
      <>
        {header}
        <CheckIn d={d} onDone={load.reload} />
        <NotDone d={d} />
      </>
    );

  if (v.status === 'submitted' || v.status === 'approved')
    return (
      <>
        {header}
        <Card className="p-6 text-center">
          <div className="text-4xl">✅</div>
          <h2 className="mt-2 font-semibold">{tr(v.outcome === 'not_done' ? 'Reported: audit not carried out' : 'Audit submitted')}</h2>
          {v.outcome === 'not_done' && <p className="mt-1 text-sm text-slate-600">{v.outcome_reason}</p>}
          <p className="mt-1 text-sm text-slate-600">
            {tr('Submitted {a}. Checked out {b}.', { a: fmtDateTime(v.submitted_at), b: fmtDateTime(v.checkout_at) })}
          </p>
          <Link to="/" className="mt-4 inline-block font-medium text-brand-800">
            {tr('Back to my centres')}
          </Link>
        </Card>
      </>
    );

  const recorded = seenOf(d).length;

  return (
    <>
      {header}
      {v.review_note && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-medium">{tr('Correction needed:')}</span> {v.review_note}
        </div>
      )}
      <div className="mb-3 flex justify-between text-xs text-slate-500">
        <span>{tr('{n} tractors recorded', { n: recorded })}</span>
        <span>{tr('Location is being recorded until you submit')}</span>
      </div>
      <BackgroundTip />
      <Storefront d={d} place={place} setD={setD} />
      <div className="sticky top-[52px] z-[400] -mx-4 mb-4 grid grid-cols-4 border-b border-slate-200 bg-slate-50 px-1 text-[13px]">
        {(
          [
            ['tractors', tr('Tractors ({n})', { n: recorded })],
            ['accessories', tr('Accessories ({n})', { n: d.accessories.length })],
            ['facility', tr('Facility')],
            ['finish', tr('Finish')],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('border-b-2 px-1 py-2.5', tab === k ? 'border-brand-700 font-semibold text-brand-900' : 'border-transparent text-slate-500')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'tractors' && <Tractors d={d} place={place} setD={setD} />}
      {tab === 'accessories' && <Accessories d={d} place={place} setD={setD} />}
      {tab === 'facility' && <Facility d={d} place={place} setD={setD} />}
      {tab === 'finish' && <Finish d={d} setD={setD} onSubmitted={load.reload} goTo={setTab} />}
    </>
  );
}

// ------------------------------------------------------------------ check-in

function CheckIn({ d, onDone }: { d: VisitDetail; onDone: () => void }) {
  const tr = useT();
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
          <span className="font-medium">{tr('Sent back by the office:')}</span> {v.review_note}
        </div>
      )}
      <Card className="p-4">
        <div className="text-sm text-slate-600">{v.address}</div>
        {(v.centre_manager || v.opening_hours || v.weekly_off) && (
          <div className="mt-2 space-y-0.5 text-sm">
            {v.centre_manager && (
              <div>
                {tr('Manager:')} <strong>{v.centre_manager}</strong>{' '}
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
                {v.weekly_off && ` · ${tr('Closed {day}', { day: v.weekly_off })}`}
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
          {tr('Open directions in Google Maps')}
        </a>
      </Card>
      <Card className="p-4">
        <h2 className="font-semibold">{tr(v.status === 'returned' ? 'Continue the audit' : 'Reached the centre?')}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {needsSelfie ? tr('Take a selfie at the centre (with the showroom behind you if possible). ') : ''}
          {tr('Checking in records your location and time. Your location is recorded until you submit the audit.')}
        </p>
        <div className="mt-4 space-y-3">
          <ErrorBox error={error} />
          {far ? (
            <div className="space-y-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <p>{tr("You are {d} from the centre's saved location. If you are at the centre, check in anyway – the office will see the distance.", { d: fmtDistance(far.dist) })}</p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => (setFar(null), void checkIn())} disabled={busy}>
                  {tr('Try again')}
                </Button>
                <Button variant="warning" onClick={() => checkIn(true)} busy={busy}>
                  {tr('Check in anyway')}
                </Button>
              </div>
            </div>
          ) : needsSelfie ? (
            <SelfieCamera
              title={`Check-in · ${me.name}`}
              place={`${v.centre_name}, ${v.state}`}
              confirmLabel={tr('Check in')}
              busy={busy}
              onConfirm={(photo) => {
                setSelfie(photo);
                void checkIn(false, photo);
              }}
            />
          ) : (
            <Button size="lg" onClick={() => checkIn()} busy={busy}>
              {tr(v.status === 'returned' ? 'Check in and fix' : 'Check in')}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Android: keep tracking alive

const TIP_KEY = 'tj_bg_tip_done';

/** One-time tip in the Android app: phones (Xiaomi, Realme, Vivo, Oppo…) stop background location to save battery. */
function BackgroundTip() {
  const tr = useT();
  const [show, setShow] = useState(() => {
    try {
      return isAndroidApp() && localStorage.getItem(TIP_KEY) !== '1';
    } catch {
      return isAndroidApp();
    }
  });
  if (!show) return null;
  const done = () => {
    try {
      localStorage.setItem(TIP_KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <Card className="mb-4 border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
      <div className="font-semibold">{tr('One-time setting: keep location working with the screen off')}</div>
      <ol className="mt-1 list-decimal pl-5">
        <li>{tr('Tap "Open app settings"')}</li>
        <li>{tr('Battery → choose Unrestricted / No restrictions')}</li>
        <li>{tr('Permissions → Location → Allow (and Use precise location on)')}</li>
        <li>{tr('Come back to this app')}</li>
      </ol>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => void openAppSettings()}>
          {tr('Open app settings')}
        </Button>
        <Button size="sm" variant="secondary" onClick={done}>
          {tr('Done')}
        </Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ storefront

/** Mandatory photo of the showroom front (with the board visible), once per visit. */
function Storefront({ d, place, setD }: { d: VisitDetail; place: string; setD: SetD }) {
  const tr = useT();
  const photos = d.photos.filter((p) => p.kind === 'storefront');
  const done = photos.length > 0;
  return (
    <Card className={cx('mb-4 p-3', !done && 'border-amber-300 bg-amber-50')}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">{tr('Storefront photo *')}</div>
        {done ? <span className="text-xs text-green-700">{tr('✓ Taken')}</span> : <span className="text-xs text-amber-800">{tr('Required')}</span>}
      </div>
      {!done && <p className="mb-2 text-xs text-amber-900">{tr('Stand outside and take the whole showroom front with the Tractor Junction board visible.')}</p>}
      <PhotoButton
        visitId={d.visit.id}
        kind="storefront"
        label={tr('Storefront photo')}
        stampTitle={`Storefront · ${d.visit.centre_name}`}
        place={place}
        photos={photos}
        required
        onChange={(ps) => setD((x) => replacePhotos(x, (p) => p.kind !== 'storefront', ps))}
      />
    </Card>
  );
}

// ------------------------------------------------------------------ tractors shown (blind count)
//
// The auditor never sees the stock list or how many tractors it has. They record every tractor
// they are shown; the office matches it against the list.

type SetD = (fn: (d: VisitDetail) => VisitDetail) => void;
const replacePhotos = (d: VisitDetail, keep: (p: Photo) => boolean, next: Photo[]) => ({ ...d, photos: [...d.photos.filter(keep), ...next] });
const seenOf = (d: VisitDetail) => d.tractors as unknown as SeenTractor[];
/** Photos a recorded tractor still needs: chassis, whole tractor, meter. */
const missingPhotos = (d: VisitDetail, t: SeenTractor) => {
  const ps = d.photos.filter((p) => p.tractor_id === t.id);
  return {
    chassis: !ps.some((p) => p.kind === 'chassis'),
    tractor: !ps.some((p) => p.kind === 'tractor'),
    meter: !ps.some((p) => p.kind === 'other'),
  };
};
const UNIT_LABEL = { km: 'KM', hours: 'Hours' } as const;
const DAY_OVER_MSG = 'The audit day is over – tractors can only be recorded on the day of check-in. Submit the audit now; tractors not shown will be reported as short.';

function Tractors({ d, place, setD }: { d: VisitDetail; place: string; setD: SetD }) {
  const tr = useT();
  const seen = seenOf(d);
  const open = d.visit.same_day_open !== false;
  const [adding, setAdding] = useState(false);
  // After the count is done, new tractors are most likely at the off-site place the auditor just checked in at
  const [where, setWhere] = useState<number | null>(d.visit.count_done_at && d.locations.length ? d.locations[d.locations.length - 1].id : null);

  async function remove(t: SeenTractor) {
    if (!confirm(tr('Remove tractor {x}? Its photos will be deleted.', { x: t.reg_no || t.chassis_no || '' }))) return;
    await api.del(`/tractors/${t.id}`);
    setD((x) => ({ ...x, tractors: x.tractors.filter((y) => y.id !== t.id), photos: x.photos.filter((p) => p.tractor_id !== t.id) }));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{tr('Record every tractor you are shown, one by one: chassis number, plate, engine number, meter reading and 3 photos.')}</p>
      {!open && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{tr(DAY_OVER_MSG)}</div>}
      {open && (
        <Button size="lg" onClick={() => setAdding(true)}>
          {tr('+ Record a tractor')}
        </Button>
      )}
      {[...seen].reverse().map((t) => {
        const miss = missingPhotos(d, t);
        const loc = t.location_id ? d.locations.find((l) => l.id === t.location_id) : null;
        const ps = d.photos.filter((p) => p.tractor_id === t.id);
        const title = `${t.reg_no ?? ''} · ${tr('Chassis')} ${t.chassis_no ?? ''}`;
        return (
          <Card key={t.id} className={cx('space-y-3 p-3', (miss.chassis || miss.tractor || miss.meter) && 'border-amber-300')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono font-semibold">{t.reg_no || tr('No reg. no')}</div>
                <div className="truncate font-mono text-xs text-slate-500">
                  {tr('Chassis')} {t.chassis_no}
                </div>
                <div className="text-xs text-slate-500">
                  {t.engine_no && `${tr('Engine')} ${t.engine_no} · `}
                  {t.meter_reading == null ? tr('Meter cannot be read') : `${tr('Meter')} ${t.meter_reading} ${tr(UNIT_LABEL[t.meter_unit ?? 'km'])}`} ·{' '}
                  {loc ? `📍 ${loc.name}` : tr('At the centre')}
                </div>

              </div>
              {open && (
                <button onClick={() => remove(t)} className="shrink-0 text-sm text-red-600">
                  {tr('Remove')}
                </button>
              )}
            </div>
            <TractorRemark
              t={t}
              onSaved={(text) => setD((x) => ({ ...x, tractors: x.tractors.map((y) => (y.id === t.id ? ({ ...y, remarks: text } as Tractor) : y)) }))}
            />
            <div className="space-y-3">
              <PhotoButton
                visitId={d.visit.id}
                kind="chassis"
                single
                label={tr('Chassis photo')}
                stampTitle={`${title} · Chassis`}
                place={place}
                tractorId={t.id}
                required
                photos={ps.filter((p) => p.kind === 'chassis')}
                onChange={(n) => setD((x) => replacePhotos(x, (p) => !(p.tractor_id === t.id && p.kind === 'chassis'), n))}
              />
              <PhotoButton
                visitId={d.visit.id}
                kind="tractor"
                single
                label={tr('Tractor photo')}
                stampTitle={`${title} · Tractor`}
                place={place}
                tractorId={t.id}
                required
                photos={ps.filter((p) => p.kind === 'tractor')}
                onChange={(n) => setD((x) => replacePhotos(x, (p) => !(p.tractor_id === t.id && p.kind === 'tractor'), n))}
              />
              <PhotoButton
                visitId={d.visit.id}
                kind="meter"
                single
                label={tr('Meter photo')}
                stampTitle={`${title} · Meter ${t.meter_reading ?? ''} ${UNIT_LABEL[t.meter_unit ?? 'km']}`}
                place={place}
                tractorId={t.id}
                required
                photos={ps.filter((p) => p.kind === 'other')}
                onChange={(n) => setD((x) => replacePhotos(x, (p) => !(p.tractor_id === t.id && p.kind === 'other'), n))}
              />
            </div>
          </Card>
        );
      })}
      {!seen.length && <p className="p-4 text-center text-sm text-slate-500">{tr('No tractors recorded yet.')}</p>}
      <Modal open={adding} onClose={() => setAdding(false)} title={tr('Record a tractor')}>
        <RecordTractor
          d={d}
          location={where}
          onSaved={(t) => {
            setD((x) => ({ ...x, tractors: [...x.tractors, t as unknown as Tractor] }));
            setWhere(t.location_id);
            setAdding(false);
          }}
        />
      </Modal>
    </div>
  );
}

const UNIT_KEY = 'tj_meter_unit';

function RecordTractor({ d, location, onSaved }: { d: VisitDetail; location: number | null; onSaved: (t: SeenTractor) => void }) {
  const tr = useT();
  const [reg, setReg] = useState('');
  const [chassis, setChassis] = useState('');
  const [engine, setEngine] = useState('');
  const [meter, setMeter] = useState('');
  const [remarks, setRemarks] = useState('');
  // Meter could not be read (no battery, faulty…): reason instead of a made-up 0
  const [meterUnreadable, setMeterUnreadable] = useState(false);
  const [meterReason, setMeterReason] = useState('');
  const [unit, setUnit] = useState<'km' | 'hours'>(() => {
    try {
      return localStorage.getItem(UNIT_KEY) === 'hours' ? 'hours' : 'km';
    } catch {
      return 'km';
    }
  });
  const [loc, setLoc] = useState<number | null>(location);
  // Typo safety: a chassis close to a stock one must be typed a second time (nothing about the list is revealed)
  const [firstTyped, setFirstTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      try {
        localStorage.setItem(UNIT_KEY, unit);
      } catch {
        /* ignore */
      }
      const t = await api.post<SeenTractor>(`/visits/${d.visit.id}/seen`, {
        reg_no: reg,
        chassis_no: chassis,
        engine_no: engine,
        meter_reading: meterUnreadable ? null : meter,
        meter_unit: unit,
        meter_unreadable: meterUnreadable ? meterReason || 'Not readable' : null,
        location_id: loc,
        remarks,
        confirm_chassis: firstTyped,
      });
      onSaved(t);
    } catch (e) {
      if (e instanceof ApiError && e.data.retype) {
        setFirstTyped(chassis);
        setChassis('');
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label={tr('Chassis number (as punched on the tractor) *')}>
        <input
          className={`${inputCls} font-mono uppercase`}
          value={chassis}
          onChange={(e) => setChassis(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoComplete="off"
          aria-label="Chassis number"
        />
      </Field>
      {firstTyped !== null && (
        <p className="-mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          {tr('Please check the chassis number on the tractor again (the number punched on the frame, not the engine number) and type it once more.')}
        </p>
      )}
      <Field label={tr('Registration number (number plate)')}>
        <input className={`${inputCls} font-mono uppercase`} value={reg} onChange={(e) => setReg(e.target.value.toUpperCase())} placeholder={tr('Leave empty if there is no plate')} />
      </Field>
      <Field label={tr('Engine number')}>
        <input className={`${inputCls} font-mono uppercase`} value={engine} onChange={(e) => setEngine(e.target.value.toUpperCase())} />
      </Field>
      <Field group label={tr('Meter reading *')}>
        {!meterUnreadable && (
          <div className="flex gap-2">
            <input className={inputCls} type="number" inputMode="decimal" min={0} step="0.1" value={meter} onChange={(e) => setMeter(e.target.value)} aria-label="Meter reading" />
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-300 text-sm">
              {(['km', 'hours'] as const).map((u) => (
                <button key={u} type="button" onClick={() => setUnit(u)} className={cx('px-3', unit === u ? 'bg-brand-800 text-white' : 'bg-white text-slate-700')}>
                  {tr(UNIT_LABEL[u])}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={meterUnreadable} onChange={(e) => setMeterUnreadable(e.target.checked)} />
          {tr('Meter cannot be read')}
        </label>
        {meterUnreadable && (
          <div className="mt-2">
            <ChoiceChips options={METER_REASONS} value={meterReason} onChange={setMeterReason} />
            <p className="mt-1 text-xs text-slate-500">{tr('Still take the meter photo as proof.')}</p>
          </div>
        )}
      </Field>
      {d.locations.length > 0 && (
        <Field label={tr('Where is this tractor?')}>
          <select className={inputCls} value={loc ?? ''} onChange={(e) => setLoc(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{tr('At the centre')}</option>
            {d.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field group label={tr('Remark (optional)')}>
        <ChoiceChips options={TRACTOR_REMARKS} value={remarks} onChange={setRemarks} />
      </Field>
      <ErrorBox error={error} />
      <Button size="lg" onClick={save} busy={busy} disabled={!chassis.trim() || (meter === '' && !meterUnreadable)}>
        {tr('Save, then take photos')}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ off-site locations (yard, service centre…)

const LOCATION_KINDS = ['Other yard / godown', 'Service centre', 'Other'];

function AddLocation({ d, onAdded }: { d: VisitDetail; onAdded: (l: VisitLocation) => void }) {
  const tr = useT();
  const [name, setName] = useState('');
  const [kind, setKind] = useState(LOCATION_KINDS[0]);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(photo: StampedPhoto) {
    if (!name.trim()) return setError(tr('Enter the name of the place (e.g. "Sharma service centre").'));
    setBusy(true);
    setError(null);
    try {
      const fix = photo.fix ?? (await getPosition());
      const form = new FormData();
      form.append('file', photo.blob, 'place.jpg');
      form.append('name', name);
      form.append('kind', kind);
      form.append('address', address);
      form.append('lat', String(fix.lat));
      form.append('lng', String(fix.lng));
      if (fix.accuracy != null) form.append('accuracy', String(fix.accuracy));
      onAdded(await api.post<VisitLocation>(`/visits/${d.visit.id}/locations`, form));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{tr('Go to the place with the centre staff. Check in there with a photo of the place – your location is recorded.')}</p>
      <Field label={tr('Name of the place *')}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Sharma service centre')} />
      </Field>
      <Field label={tr('Type of place')}>
        <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
          {LOCATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {tr(k)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('Address / landmark')}>
        <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <div className="text-sm font-medium text-slate-700">{tr('Photo of the place *')}</div>
      <LiveCamera
        facing="environment"
        title={`Off-site · ${name || d.visit.centre_name}`}
        place={`${d.visit.centre_name}, ${d.visit.state}`}
        captureLabel={tr('Take photo')}
        confirmLabel={tr('Check in here')}
        busy={busy}
        onConfirm={send}
      />
      <ErrorBox error={error} />
    </div>
  );
}

// ------------------------------------------------------------------ accessories

const ACCESSORY_SUGGESTIONS = ['Top Link', 'Drawer Patti', 'Old Battery', 'New Battery', 'Hood', 'Front Tyre', 'Rear Tyre', 'Rim', 'Trolley', 'Cultivator', 'Rotavator'];

function Accessories({ d, place, setD }: { d: VisitDetail; place: string; setD: SetD }) {
  const tr = useT();
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
    if (!confirm(tr('Remove {x}?', { x: a.name }))) return;
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
              {tr('Remove')}
            </button>
          </div>
          <PhotoButton
            visitId={d.visit.id}
            kind="accessory"
            label={tr('Photo')}
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
        <h3 className="font-semibold">{tr('Add accessory')}</h3>
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Field label={tr('Item')}>
            <input className={inputCls} list="acc-suggest" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <datalist id="acc-suggest">
              {ACCESSORY_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label={tr('Qty')}>
            <input className={inputCls} type="number" inputMode="numeric" min={0} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          </Field>
        </div>
        <Field group label={tr('Condition / remarks')}>
          <ChoiceChips options={ACCESSORY_CONDITION} value={f.remarks} onChange={(r) => setF({ ...f, remarks: r })} otherPlaceholder={tr('e.g. 2 bundles of 5, 2 unpacked')} />
        </Field>
        <p className="text-xs text-slate-500">{tr('Add only items that are actually at the centre – do not add items that are not there.')}</p>
        <ErrorBox error={error} />
        <Button onClick={add} busy={busy} disabled={!f.name.trim()}>
          {tr('Add, then take photo')}
        </Button>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ facility condition

const RATING_TONE: Record<FacilityRating, string> = {
  good: 'bg-green-600 text-white border-green-600',
  average: 'bg-amber-500 text-white border-amber-500',
  poor: 'bg-red-600 text-white border-red-600',
  na: 'bg-slate-500 text-white border-slate-500',
};

function Facility({ d, place, setD }: { d: VisitDetail; place: string; setD: SetD }) {
  const tr = useT();
  const [newArea, setNewArea] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = d.facility.filter((f) => !facilityProblem(f, d.photos.filter((p) => p.facility_id === f.id).length)).length;

  async function save(f: FacilityCheck, patch: Partial<FacilityCheck>) {
    setError(null);
    setD((x) => ({ ...x, facility: x.facility.map((y) => (y.id === f.id ? { ...y, ...patch } : y)) }));
    try {
      await api.patch(`/facility/${f.id}`, patch);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function add() {
    try {
      const f = await api.post<FacilityCheck>(`/visits/${d.visit.id}/facility`, { area: newArea });
      setD((x) => ({ ...x, facility: [...x.facility, f] }));
      setNewArea('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove(f: FacilityCheck) {
    if (!confirm(tr('Remove "{x}"?', { x: tr(f.area) }))) return;
    await api.del(`/facility/${f.id}`);
    setD((x) => ({ ...x, facility: x.facility.filter((y) => y.id !== f.id), photos: x.photos.filter((p) => p.facility_id !== f.id) }));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {tr('How is the stock kept? Rate each area and take at least one photo (racks, arrangement, condition of goods). A remark is required for Poor or Not applicable.')}{' '}
        <span className="text-slate-500">{tr('{a}/{b} done', { a: done, b: d.facility.length })}</span>
      </p>
      <ErrorBox error={error} />
      {d.facility.map((f) => {
        const photos = d.photos.filter((p) => p.facility_id === f.id);
        const problem = facilityProblem(f, photos.length);
        return (
          <Card key={f.id} className={cx('space-y-3 p-3', problem && f.rating && 'border-amber-300')}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold">{tr(f.area)}</div>
              {problem ? <span className="text-xs text-amber-700">{tr(problem)}</span> : <span className="text-xs text-green-700">{tr('✓ Done')}</span>}
            </div>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={`Condition of ${f.area}`}>
              {(Object.keys(FACILITY_RATING_LABEL) as FacilityRating[]).map((r) => (
                <button
                  key={r}
                  role="radio"
                  aria-checked={f.rating === r}
                  onClick={() => save(f, { rating: r })}
                  className={cx('rounded-lg border px-1 py-2 text-xs font-medium', f.rating === r ? RATING_TONE[r] : 'border-slate-300 bg-white text-slate-700')}
                >
                  {tr(r === 'na' ? 'N/A' : FACILITY_RATING_LABEL[r])}
                </button>
              ))}
            </div>
            {f.rating !== 'na' && (
              <PhotoButton
                visitId={d.visit.id}
                kind="facility"
                label={tr('Photo')}
                stampTitle={`Facility · ${f.area}`}
                place={place}
                facilityId={f.id}
                required
                photos={photos}
                onChange={(ps) => setD((x) => replacePhotos(x, (p) => p.facility_id !== f.id, ps))}
              />
            )}
            {f.rating === 'na' ? (
              <SavedChoices options={['Not at this centre']} value={f.remarks ?? ''} onSave={(text) => save(f, { remarks: text })} />
            ) : (
              <RemarkInput
                value={f.remarks ?? ''}
                placeholder={tr(f.rating === 'poor' ? 'Remark (required)' : 'Remark (optional) – e.g. racks labelled, batteries on floor')}
                onSave={(text) => save(f, { remarks: text })}
                label={`Remark for ${f.area}`}
              />
            )}
            {!!f.is_custom && (
              <button onClick={() => remove(f)} className="text-sm text-red-600">
                {tr('Remove this area')}
              </button>
            )}
          </Card>
        );
      })}
      <Card className="flex gap-2 p-3">
        <input className={inputCls} value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder={tr('Another area, e.g. Workshop')} aria-label="New area" />
        <Button variant="secondary" onClick={add} disabled={!newArea.trim()}>
          {tr('Add')}
        </Button>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ centre closed / cannot audit

const NOT_DONE_REASONS = ['Centre closed', 'Manager / staff not available', 'Centre did not allow the audit', 'Holiday – centre shut for the day', 'Other'];

/** Report that the audit could not be carried out, with a live storefront photo and GPS as proof. */
function NotDone({ d }: { d: VisitDetail }) {
  const tr = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = d.visit;

  async function send(photo: StampedPhoto) {
    if (!reason) return setError('Choose the reason first.');
    if (reason === 'Other' && !note.trim()) return setError('Explain what happened.');
    setBusy(true);
    setError(null);
    try {
      const fix = photo.fix ?? (await getPosition());
      const form = new FormData();
      form.append('file', photo.blob, 'storefront.jpg');
      form.append('reason', reason);
      form.append('note', note);
      form.append('lat', String(fix.lat));
      form.append('lng', String(fix.lng));
      await api.post(`/visits/${v.id}/not-done`, form);
      tracker.stop();
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <button onClick={() => setOpen(true)} className="w-full rounded-lg border border-red-200 bg-white py-3 text-sm font-medium text-red-700">
        {tr("Centre closed / can't audit?")}
      </button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title={tr('Audit could not be carried out')}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {tr('Use this only if you are at {c} and the audit cannot be done today. The office will review it.', { c: v.centre_name })}
          </p>
          <Field label={tr('Reason *')}>
            <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">{tr('Choose…')}</option>
              {NOT_DONE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr(reason === 'Other' ? 'What happened? *' : 'Details (optional)')}>
            <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('e.g. shutter down, manager phone switched off')} />
          </Field>
          <div className="text-sm font-medium text-slate-700">{tr('Photo of the storefront as proof *')}</div>
          <LiveCamera
            facing="environment"
            title={`Not carried out · ${v.centre_name}`}
            place={`${v.centre_name}, ${v.state}`}
            captureLabel={tr('Take photo')}
            confirmLabel={tr('Send report')}
            busy={busy}
            onConfirm={send}
          />
          <ErrorBox error={error} />
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ finish: count result, off-site, declaration, submit

function Finish({ d, setD, onSubmitted, goTo }: { d: VisitDetail; setD: SetD; onSubmitted: () => void; goTo: (t: Tab) => void }) {
  const tr = useT();
  const v = d.visit;
  const navigate = useNavigate();
  const { me } = useAuth();
  const seen = seenOf(d);
  const [pending, setPending] = useState<number | null>(null);
  const [recheck, setRecheck] = useState<number[]>([]);
  const [fixing, setFixing] = useState<SeenTractor | null>(null);
  const [popup, setPopup] = useState(false);
  const [counting, setCounting] = useState(false);
  const [addingPlace, setAddingPlace] = useState(false);
  const [explanation, setExplanation] = useState(v.missing_explanation ?? '');
  const [manager, setManager] = useState(v.manager_name ?? v.centre_manager ?? '');
  const [managerPhone, setManagerPhone] = useState(v.manager_phone ?? v.centre_manager_phone ?? '');
  const [remarks, setRemarks] = useState(v.general_remarks ?? '');
  const [sigBusy, setSigBusy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; problems?: string[] } | null>(null);
  const counted = !!v.count_done_at;

  // Refresh the "not shown" number whenever the Finish tab is opened after the count
  useEffect(() => {
    if (counted)
      api.post<{ pending: number; recheck?: number[] }>(`/visits/${v.id}/count-done`).then(
        (r) => (setPending(r.pending), setRecheck(r.recheck ?? [])),
        () => {},
      );
  }, [counted, v.id, seen.length]);

  async function countDone() {
    setCounting(true);
    setError(null);
    try {
      const r = await api.post<{ pending: number; recheck?: number[] }>(`/visits/${v.id}/count-done`);
      setPending(r.pending);
      setRecheck(r.recheck ?? []);
      setPopup(true);
      if (!counted) setD((x) => ({ ...x, visit: { ...x.visit, count_done_at: new Date().toISOString() } }));
    } catch (e) {
      setError({ msg: (e as Error).message });
    } finally {
      setCounting(false);
    }
  }

  // Everything still missing before the audit can be submitted – specific, so the auditor can fix it alone
  const problems = useMemo(() => {
    const p: { msg: string; tab: Tab }[] = [];
    const name = (t: SeenTractor) => t.reg_no || t.chassis_no || '';
    for (const t of seen) {
      const miss = missingPhotos(d, t);
      const what = [miss.chassis && tr('chassis photo'), miss.tractor && tr('tractor photo'), miss.meter && tr('meter photo')].filter(Boolean).join(', ');
      if (what) p.push({ msg: tr('Tractor {x}: {what} missing', { x: name(t), what }), tab: 'tractors' });
    }
    for (const a of d.accessories.filter((a) => !d.photos.some((x) => x.accessory_id === a.id)))
      p.push({ msg: tr('Accessory {x}: photo missing', { x: a.name }), tab: 'accessories' });
    if (!d.photos.some((x) => x.kind === 'storefront')) p.push({ msg: tr('Storefront photo not taken (top of the page)'), tab: 'tractors' });
    for (const f of d.facility) {
      const why = facilityProblem(f, d.photos.filter((x) => x.facility_id === f.id).length);
      if (!why) continue;
      const area = tr(f.area);
      const msg =
        why === 'condition not rated'
          ? f.is_custom
            ? tr('Facility – "{x}": choose Good, Average, Poor or N/A – or tap "Remove this area" if it was added by mistake', { x: area })
            : tr('Facility – "{x}": choose Good, Average, Poor or N/A', { x: area })
          : why === 'photo missing'
            ? tr('Facility – "{x}": take a photo', { x: area })
            : tr('Facility – "{x}": write a remark (needed for Poor and N/A)', { x: area });
      p.push({ msg, tab: 'facility' });
    }
    return p;
  }, [d, seen, tr]);
  // Items on this Finish screen itself
  const finishProblems = [
    !!pending && !explanation.trim() && tr("Write the manager's explanation for the tractors not shown"),
    !manager.trim() && tr("Enter the manager's name"),
    !v.has_manager_signature && tr('Manager has not signed – sign in the box and tap "Save signature"'),
    !v.has_auditor_signature && tr('Your signature is missing – sign in the box and tap "Save signature"'),
  ].filter(Boolean) as string[];
  const [checklist, setChecklist] = useState<string[] | null>(null);

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
      await api.post(`/visits/${v.id}/submit`, {
        manager_name: manager,
        manager_phone: managerPhone,
        missing_explanation: explanation,
        general_remarks: remarks,
        lat: fix?.lat,
        lng: fix?.lng,
      });
      tracker.stop();
      onSubmitted();
      navigate('/');
    } catch (e) {
      if (e instanceof ApiError && e.problems.length) setChecklist(e.problems.map((x) => tr(x)));
      else setError({ msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const atCentre = seen.filter((t) => !t.location_id).length;
  const elsewhere = seen.length - atCentre;
  const placeNames = d.locations.map((l) => l.name).join(', ');
  const declaration = tr(
    'I confirm that all tractors and accessories of {centre} were shown to the auditor today, including those kept at other places listed here. Tractors shown: {n}.',
    { centre: v.centre_name, n: seen.length },
  );
  const phoneDigits = managerPhone.replace(/\D/g, '').slice(-10);
  const whatsapp = () => {
    const lines = [
      `Stock audit – ${v.centre_name}, ${fmtDate(v.audit_date)}`,
      `Auditor: ${me.name}`,
      `Tractors shown and recorded: ${seen.length} (at centre ${atCentre}${elsewhere ? `, at other places ${elsewhere}` : ''})`,
      ...(d.locations.length ? [`Other places visited: ${placeNames}`] : []),
      ...(pending ? [`Tractors in the records not shown: ${pending}`, `Explanation given: ${explanation || '-'}`] : []),
      `Accessory items: ${d.accessories.length}`,
      `Manager: ${manager}`,
      '',
      'This is a copy of the summary you signed on the auditor’s phone.',
    ];
    window.open(`https://wa.me/91${phoneDigits}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  };

  return (
    <div className="space-y-4">
      {/* Step 1: finish the count */}
      <Card className="space-y-3 p-4 text-sm">
        <h3 className="font-semibold">{tr('1. Count')}</h3>
        <div className="grid grid-cols-2 gap-1">
          <span>{tr('Tractors recorded')}</span>
          <span className="text-right font-semibold">{seen.length}</span>
          {elsewhere > 0 && (
            <>
              <span>{tr('· at the centre')}</span>
              <span className="text-right">{atCentre}</span>
              <span>{tr('· at other places')}</span>
              <span className="text-right">{elsewhere}</span>
            </>
          )}
          <span>{tr('Accessory items')}</span>
          <span className="text-right font-semibold">{d.accessories.length}</span>
        </div>
        {!counted ? (
          <>
            <p className="text-slate-600">{tr('When you have recorded every tractor you were shown at the centre, tap below.')}</p>
            <Button onClick={countDone} busy={counting} disabled={!seen.length}>
              {tr('Done counting')}
            </Button>
          </>
        ) : pending === null ? null : pending === 0 ? (
          <p className="rounded-lg bg-green-50 p-2 font-medium text-green-800">{tr('✓ All tractors in the records have been shown.')}</p>
        ) : (
          <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-amber-900">
            <p className="font-semibold">{tr('{n} tractor(s) in the records not shown yet', { n: pending })}</p>
            {recheck.length > 0 && (
              <div className="rounded-lg bg-white p-2">
                <p className="font-medium">{tr('First, re-check these tractors you recorded – they do not match the records. A wrong letter or digit in the chassis number is the usual reason:')}</p>
                <ul className="mt-1 space-y-1">
                  {seen
                    .filter((t) => recheck.includes(t.id))
                    .map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">
                          {t.reg_no || tr('No reg. no')} · {t.chassis_no}
                        </span>
                        {d.visit.same_day_open !== false && (
                          <Button size="sm" variant="secondary" onClick={() => setFixing(t)}>
                            {tr('Fix chassis no.')}
                          </Button>
                        )}
                      </li>
                    ))}
                </ul>
                <p className="mt-1 text-xs">{tr('If the numbers are correct, leave them – the office will review.')}</p>
              </div>
            )}
            <p>{tr('Ask the manager where they are. If they are at another yard or a service centre, go there today and record them.')}</p>
            <Button size="sm" variant="secondary" onClick={countDone} busy={counting}>
              {tr('Check again')}
            </Button>
          </div>
        )}
      </Card>

      {/* Step 2: other places */}
      {counted && (
        <Card className="space-y-3 p-4 text-sm">
          <h3 className="font-semibold">{tr('2. Tractors kept at other places')}</h3>
          {d.locations.map((l) => (
            <div key={l.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 p-2">
              <div>
                <div className="font-medium">📍 {l.name}</div>
                <div className="text-xs text-slate-500">
                  {[l.kind && tr(l.kind), l.distance_m != null && tr('{d} from the centre', { d: fmtDistance(l.distance_m) }), fmtDateTime(l.arrived_at)].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="shrink-0 text-xs text-slate-600">{tr('{n} tractors', { n: seen.filter((t) => t.location_id === l.id).length })}</span>
            </div>
          ))}
          {d.visit.same_day_open !== false && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAddingPlace(true)}>
                {tr('+ Check in at another place')}
              </Button>
              {d.locations.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => goTo('tractors')}>
                  {tr('Record tractors there')}
                </Button>
              )}
            </div>
          )}
          {!d.locations.length && <p className="text-xs text-slate-500">{tr('Not needed if every tractor was shown at the centre.')}</p>}
        </Card>
      )}

      {counted && !!pending && (
        <Field group label={tr("Manager's explanation for the tractors not shown *")}>
          <SavedChoices
            options={NOT_SHOWN_REASONS}
            value={explanation}
            otherPlaceholder={tr('e.g. customer name and village, invoice number')}
            onSave={(text) => {
              setExplanation(text);
              void api.put(`/visits/${v.id}/explanation`, { missing_explanation: text }).catch(() => {});
            }}
          />
        </Field>
      )}

      {counted && (
        <Card className="space-y-2 p-4 text-sm">
          <h3 className="font-semibold">{tr('Supporting documents')}</h3>
          <p className="text-slate-600">
            {tr('Photograph any document the manager shows for tractors not shown, sold or kept elsewhere: sale invoice, delivery challan, gate pass, service job card, transfer note.')}
          </p>
          <PhotoButton
            visitId={v.id}
            kind="document"
            label={tr('Document photo')}
            stampTitle={`Document · ${v.centre_name}`}
            place={`${v.centre_name}, ${v.state}`}
            photos={d.photos.filter(isDocumentPhoto)}
            onChange={(n) => setD((x) => replacePhotos(x, (p) => !isDocumentPhoto(p), n))}
          />
        </Card>
      )}

      {problems.length > 0 && (
        <div className="space-y-1 rounded-lg bg-amber-50 p-2 text-sm">
          {problems.map((p) => (
            <button key={p.msg} onClick={() => goTo(p.tab)} className="block text-left text-amber-800 underline">
              ⚠ {p.msg}
            </button>
          ))}
        </div>
      )}

      {counted && (
        <>
          <Field label={tr('General remarks (optional)')}>
            <textarea className={inputCls} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <Card className="space-y-3 p-4">
            <h3 className="font-semibold">{tr("3. Manager's declaration")}</h3>
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {declaration}
              {d.locations.length > 0 && ` ${tr('Other places: {p}.', { p: placeNames })}`}
              {!!pending && ` ${tr('Tractors not shown: {n} – explanation given above.', { n: pending })}`}
            </p>
            <p className="text-xs text-slate-500">{tr('Show this screen to the manager. They read it and sign below.')}</p>
            <Field label={tr("Manager's name *")}>
              <input className={inputCls} value={manager} onChange={(e) => setManager(e.target.value)} />
            </Field>
            <Field label={tr("Manager's mobile")}>
              <input className={inputCls} type="tel" inputMode="tel" value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} />
            </Field>
            <SignaturePad onSave={(b) => saveSig('manager', b)} saved={v.has_manager_signature} busy={sigBusy === 'manager'} />
            <Button size="sm" variant="secondary" onClick={whatsapp} disabled={phoneDigits.length !== 10 || !v.has_manager_signature}>
              {tr('Send the manager a copy on WhatsApp')}
            </Button>
          </Card>
          <Card className="space-y-2 p-4">
            <h3 className="font-semibold">{tr('Auditor signature')}</h3>
            <SignaturePad onSave={(b) => saveSig('auditor', b)} saved={v.has_auditor_signature} busy={sigBusy === 'auditor'} />
          </Card>
          <ErrorBox error={error?.msg} problems={error?.problems} />
          <Button
            size="lg"
            onClick={() => {
              const all = [...problems.map((x) => x.msg), ...finishProblems];
              if (all.length) setChecklist(all);
              else void submit();
            }}
            busy={busy}
          >
            {tr('Submit audit and check out')}
          </Button>
          <p className="text-center text-xs text-slate-500">{tr('After submitting you cannot edit unless the office sends it back.')}</p>
        </>
      )}
      {!counted && <ErrorBox error={error?.msg} />}

      <Modal open={popup} onClose={() => setPopup(false)} title={tr('Count result')}>
        <div className="space-y-3 text-center">
          {pending === 0 ? (
            <>
              <div className="text-4xl">✅</div>
              <p className="font-semibold">{tr('✓ All tractors in the records have been shown.')}</p>
            </>
          ) : (
            <>
              <div className="text-5xl font-bold text-amber-600">{pending}</div>
              <p className="font-semibold">{tr('tractor(s) in the records were not shown to you')}</p>
              <p className="text-sm text-slate-600">
                {tr('Ask the manager where they are. If they are at another yard or a service centre, go there today and record them.')}{' '}
                {tr('Tractors not shown by the end of today will be reported as short.')}
              </p>
            </>
          )}
          <Button onClick={() => setPopup(false)}>{tr('OK')}</Button>
        </div>
      </Modal>
      <Modal open={!!checklist} onClose={() => setChecklist(null)} title={tr('Before you can submit, fix these')}>
        {checklist && (
          <div className="space-y-2">
            {checklist.map((m) => {
              const tab = problems.find((x) => x.msg === m)?.tab;
              return (
                <div key={m} className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                  <span>⚠ {m}</span>
                  {tab && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setChecklist(null);
                        goTo(tab);
                      }}
                    >
                      {tr('Go there')}
                    </Button>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-slate-500">{tr('Fix each item, then tap Submit again.')}</p>
            <Button onClick={() => setChecklist(null)}>{tr('OK')}</Button>
          </div>
        )}
      </Modal>
      <Modal open={!!fixing} onClose={() => setFixing(null)} title={tr('Fix chassis no.')}>
        {fixing && (
          <FixChassis
            t={fixing}
            onSaved={(oldId, nt) => {
              setFixing(null);
              setD((x) => ({ ...x, tractors: [...x.tractors.filter((y) => y.id !== oldId), nt as unknown as Tractor], photos: x.photos.map((p) => (p.tractor_id === oldId ? { ...p, tractor_id: nt.id } : p)) }));
              // refresh the number quietly (no pop-up)
              api.post<{ pending: number; recheck?: number[] }>(`/visits/${v.id}/count-done`).then(
                (r) => (setPending(r.pending), setRecheck(r.recheck ?? [])),
                () => {},
              );
            }}
          />
        )}
      </Modal>
      <Modal open={addingPlace} onClose={() => setAddingPlace(false)} title={tr('Check in at another place')}>
        <AddLocation
          d={d}
          onAdded={(l) => {
            setD((x) => ({ ...x, locations: [...x.locations, l] }));
            setAddingPlace(false);
            goTo('tractors');
          }}
        />
      </Modal>
      <NotDone d={d} />
    </div>
  );
}

/** Correct a recorded tractor's numbers (typo). If it now matches the records, it is matched; photos are kept. */
function FixChassis({ t, onSaved }: { t: SeenTractor; onSaved: (oldId: number, nt: SeenTractor) => void }) {
  const tr = useT();
  const [chassis, setChassis] = useState(t.chassis_no ?? '');
  const [reg, setReg] = useState(t.reg_no ?? '');
  const [engine, setEngine] = useState(t.engine_no ?? '');
  const [firstTyped, setFirstTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.patch<{ old_id: number; tractor: SeenTractor }>(`/seen/${t.id}`, { chassis_no: chassis, reg_no: reg, engine_no: engine, confirm_chassis: firstTyped });
      onSaved(r.old_id, r.tractor);
    } catch (e) {
      if (e instanceof ApiError && e.data.retype) {
        setFirstTyped(chassis);
        setChassis('');
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{tr('Go back to this tractor, read the chassis plate again carefully and correct the numbers. Photos and meter reading are kept.')}</p>
      <Field label={tr('Chassis number (as punched on the tractor) *')}>
        <input className={`${inputCls} font-mono uppercase`} value={chassis} onChange={(e) => setChassis(e.target.value.toUpperCase())} autoComplete="off" aria-label="Chassis number" />
      </Field>
      {firstTyped !== null && <p className="-mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{tr('Please check the chassis number on the tractor again (the number punched on the frame, not the engine number) and type it once more.')}</p>}
      <Field label={tr('Registration number (number plate)')}>
        <input className={`${inputCls} font-mono uppercase`} value={reg} onChange={(e) => setReg(e.target.value.toUpperCase())} />
      </Field>
      <Field label={tr('Engine number')}>
        <input className={`${inputCls} font-mono uppercase`} value={engine} onChange={(e) => setEngine(e.target.value.toUpperCase())} />
      </Field>
      <ErrorBox error={error} />
      <Button size="lg" onClick={save} busy={busy} disabled={!chassis.trim()}>
        {tr('Save correction')}
      </Button>
    </div>
  );
}

/**
 * Text box that saves by itself while typing (shortly after the last key), and on leaving the box –
 * so switching tabs straight after typing never loses the text.
 */
function RemarkInput({ value, placeholder, onSave, label }: { value: string; placeholder: string; onSave: (text: string) => void; label: string }) {
  const [text, setText] = useState(value);
  const saved = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = (t: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (t !== saved.current) {
      saved.current = t;
      onSave(t);
    }
  };
  const latest = useRef(text);
  latest.current = text;
  // also save if the screen is closed while a save is waiting
  useEffect(() => () => flush(latest.current), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      className={inputCls}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(t), 700);
      }}
      onBlur={() => flush(text)}
      aria-label={label}
    />
  );
}

// ------------------------------------------------------------------ standard remarks

const TRACTOR_REMARKS = [
  'No number plate',
  'Battery not fitted',
  'Engine number not visible',
  'Chassis plate damaged / unclear',
  'Tractor damaged',
  "Customer's tractor (in for service)",
  'Demo tractor',
  'Kept outside / in the open',
];
const METER_REASONS = ['No battery', 'Meter faulty'];
const NOT_SHOWN_REASONS = [
  'Sold – stock statement not updated',
  'At another yard',
  'Out with a customer on demo',
  'Transferred to another centre',
  'Under repair',
  'No explanation given',
];
const ACCESSORY_CONDITION = ['New', 'Old', 'New and old'];

const splitChoices = (v: string) => v.split(';').map((x) => x.trim()).filter(Boolean);

/**
 * Tap-to-choose standard remarks (several allowed) plus "Other" for anything else.
 * Choices are stored in English so reports read the same whatever language the auditor uses.
 */
function ChoiceChips({
  options,
  value,
  onChange,
  otherPlaceholder,
  detailsAlways,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  otherPlaceholder?: string;
  /** show the text box all the time (for details), not only after tapping Other */
  detailsAlways?: boolean;
}) {
  const tr = useT();
  const parts = splitChoices(value);
  const chosen = options.filter((o) => parts.includes(o));
  const other = parts.filter((p) => !options.includes(p)).join('; ');
  const [showOther, setShowOther] = useState(!!other);
  const compose = (c: string[], o: string) => [...options.filter((x) => c.includes(x)), o.trim()].filter(Boolean).join('; ');
  const toggle = (o: string) => onChange(compose(chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o], other));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={chosen.includes(o)}
            onClick={() => toggle(o)}
            className={cx('rounded-full border px-3 py-1.5 text-xs', chosen.includes(o) ? 'border-brand-800 bg-brand-800 text-white' : 'border-slate-300 bg-white text-slate-700')}
          >
            {chosen.includes(o) && '✓ '}
            {tr(o)}
          </button>
        ))}
        {!detailsAlways && (
          <button
            type="button"
            aria-pressed={showOther}
            onClick={() => {
              if (showOther) onChange(compose(chosen, ''));
              setShowOther(!showOther);
            }}
            className={cx('rounded-full border px-3 py-1.5 text-xs', showOther ? 'border-brand-800 bg-brand-800 text-white' : 'border-slate-300 bg-white text-slate-700')}
          >
            {showOther && '✓ '}
            {tr('Other')}
          </button>
        )}
      </div>
      {(showOther || detailsAlways) && (
        <input
          className={inputCls}
          value={other}
          onChange={(e) => onChange(compose(chosen, e.target.value))}
          placeholder={otherPlaceholder ?? tr('Type the reason')}
          aria-label="Other reason"
        />
      )}
    </div>
  );
}

/** ChoiceChips that save by themselves (shortly after the last change, and when the screen closes). */
function SavedChoices({ options, value, onSave, otherPlaceholder }: { options: string[]; value: string; onSave: (v: string) => void; otherPlaceholder?: string }) {
  const [v, setV] = useState(value);
  const saved = useRef(value);
  const latest = useRef(v);
  latest.current = v;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = (t: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (t !== saved.current) {
      saved.current = t;
      onSave(t);
    }
  };
  useEffect(() => () => flush(latest.current), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ChoiceChips
      options={options}
      value={v}
      otherPlaceholder={otherPlaceholder}
      onChange={(t) => {
        setV(t);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(t), 700);
      }}
    />
  );
}

/**
 * Remark on a recorded tractor, editable until the audit is submitted (tap-to-choose + Other, saved by itself).
 * A "Meter not readable – …" note comes from the meter section and is kept as it is.
 */
function TractorRemark({ t, onSaved }: { t: SeenTractor; onSaved: (text: string) => void }) {
  const tr = useT();
  const parts = splitChoices(t.remarks ?? '');
  const meterNote = parts.filter((p) => p.startsWith('Meter not readable'));
  const editable = parts.filter((p) => !p.startsWith('Meter not readable')).join('; ');
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <div className="mb-1 text-xs font-medium text-slate-600">
        {tr('Remark (optional)')}
        {meterNote.length > 0 && <span className="ml-1 font-normal text-slate-500">· {tr('Meter cannot be read')}</span>}
      </div>
      <SavedChoices
        options={TRACTOR_REMARKS}
        value={editable}
        onSave={(text) => {
          const full = [...meterNote, ...splitChoices(text)].join('; ');
          onSaved(full);
          void api.put(`/seen/${t.id}/remark`, { remarks: full }).catch(() => {});
        }}
      />
    </div>
  );
}
