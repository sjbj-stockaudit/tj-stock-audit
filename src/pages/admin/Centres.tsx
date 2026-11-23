import { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, mapsLink } from '../../lib/format';
import type { Centre } from '../../lib/types';
import { Button, Card, ErrorBox, Field, Loading, Modal, PageTitle, inputCls, useLoad } from '../../components/ui';

type Data = { centres: Centre[]; aliases: { alias: string; centre_id: number }[] };

export default function Centres() {
  const data = useLoad(() => api.get<Data>('/centres'));
  const [edit, setEdit] = useState<Partial<Centre> | null>(null);
  const [state, setState] = useState('');

  if (!data.data) return data.error ? <ErrorBox error={data.error} /> : <Loading />;
  const states = [...new Set(data.data.centres.map((c) => c.state))];
  const list = data.data.centres.filter((c) => !state || c.state === state);

  return (
    <div>
      <PageTitle
        title="Centres"
        sub={`${data.data.centres.filter((c) => c.active).length} active centres. Location is used to verify check-ins.`}
        actions={
          <>
            <select className={`${inputCls} w-auto`} value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
              <option value="">All states</option>
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <Button onClick={() => setEdit({ state: state || 'MP', radius_m: 300, active: 1 })}>Add centre</Button>
          </>
        }
      />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2">Centre</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Other names</th>
              <th className="px-3 py-2">Last approved audit</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className={`border-b border-slate-100 last:border-0 ${c.active ? '' : 'opacity-50'}`}>
                <td className="px-3 py-2 font-medium">
                  {c.name} <span className="text-xs font-normal text-slate-400">{c.state}</span>
                  {!c.active && <span className="ml-1 text-xs text-red-600">inactive</span>}
                </td>
                <td className="max-w-72 px-3 py-2 text-xs text-slate-600">{c.address}</td>
                <td className="px-3 py-2 text-xs">
                  {c.lat != null ? (
                    <a href={mapsLink(c.lat, c.lng)} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                      {c.lat.toFixed(4)}, {c.lng?.toFixed(4)}
                    </a>
                  ) : (
                    <span className="text-amber-600">Set on first check-in</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {data.data!.aliases
                    .filter((a) => a.centre_id === c.id)
                    .map((a) => a.alias)
                    .join(', ')}
                </td>
                <td className="px-3 py-2 text-xs">{fmtDate(c.last_audit)}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="secondary" onClick={() => setEdit(c)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {edit && <CentreEditor centre={edit} aliases={data.data.aliases} onClose={() => setEdit(null)} onSaved={data.reload} />}
    </div>
  );
}

function CentreEditor({
  centre,
  aliases,
  onClose,
  onSaved,
}: {
  centre: Partial<Centre>;
  aliases: Data['aliases'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    state: centre.state ?? 'MP',
    name: centre.name ?? '',
    address: centre.address ?? '',
    lat: centre.lat?.toString() ?? '',
    lng: centre.lng?.toString() ?? '',
    radius_m: centre.radius_m?.toString() ?? '300',
    active: centre.active ?? 1,
  });
  const [alias, setAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = aliases.filter((a) => a.centre_id === centre.id);

  async function run(fn: () => Promise<unknown>, close = false) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
      if (close) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const save = () => {
    // Accept "23.80, 79.45" pasted from Google Maps into the latitude box
    let { lat, lng } = f;
    const m = lat.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
    if (m) [lat, lng] = [m[1], m[2]];
    const body = { ...f, lat: lat || null, lng: lng || null, radius_m: Number(f.radius_m) || 300 };
    return run(() => (centre.id ? api.patch(`/centres/${centre.id}`, body) : api.post('/centres', body)), true);
  };

  return (
    <Modal open onClose={onClose} title={centre.id ? `Edit ${centre.name}` : 'Add centre'}>
      <div className="space-y-3">
        <div className="grid grid-cols-[5rem_1fr] gap-3">
          <Field label="State">
            <input className={inputCls} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Centre name">
            <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
        </div>
        <Field label="Address">
          <textarea className={inputCls} rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Latitude">
            <input className={inputCls} value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} placeholder="23.8008" />
          </Field>
          <Field label="Longitude">
            <input className={inputCls} value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} placeholder="79.4548" />
          </Field>
          <Field label="Allowed radius (m)">
            <input className={inputCls} type="number" value={f.radius_m} onChange={(e) => setF({ ...f, radius_m: e.target.value })} />
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          Tip: in Google Maps, long-press the showroom and copy the coordinates, then paste them into Latitude. If left empty, the first auditor
          check-in sets it.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} />
          Active
        </label>
        {centre.id && (
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-sm font-medium">Other names in stock statements</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {mine.map((a) => (
                <span key={a.alias} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs ring-1 ring-slate-200">
                  {a.alias}
                  <button onClick={() => run(() => api.del(`/aliases/${encodeURIComponent(a.alias)}`))} aria-label={`Remove ${a.alias}`} className="text-slate-400 hover:text-red-600">
                    ×
                  </button>
                </span>
              ))}
              {!mine.length && <span className="text-xs text-slate-500">None</span>}
            </div>
            <div className="mt-2 flex gap-2">
              <input className={`${inputCls} py-1`} value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. Badnagar" />
              <Button size="sm" variant="secondary" disabled={!alias.trim() || busy} onClick={() => run(async () => (await api.post(`/centres/${centre.id}/aliases`, { alias }), setAlias('')))}>
                Add
              </Button>
            </div>
          </div>
        )}
        <ErrorBox error={error} />
        <Button onClick={save} busy={busy} disabled={!f.name.trim()}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
