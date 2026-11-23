import { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, mapsLink } from '../../lib/format';
import type { Centre } from '../../lib/types';
import { Button, Card, ErrorBox, Field, Loading, Modal, PageTitle, inputCls, useLoad } from '../../components/ui';
import { centreTemplate, parseCentreDetails, type ParsedCentreRow } from '../../lib/centreTemplate';
import { saveBlob } from '../../lib/reports';

type Data = { centres: Centre[]; aliases: { alias: string; centre_id: number }[] };

export default function Centres() {
  const data = useLoad(() => api.get<Data>('/centres'));
  const [edit, setEdit] = useState<Partial<Centre> | null>(null);
  const [state, setState] = useState('');
  const [importing, setImporting] = useState(false);

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
            <Button
              variant="secondary"
              onClick={async () =>
                saveBlob(await centreTemplate(data.data!.centres.filter((c) => c.active && (!state || c.state === state))), 'Centre_Details_Template.xlsx')
              }
            >
              Download details template
            </Button>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              Import centre details
            </Button>
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
              <th className="px-3 py-2">Manager</th>
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
                  {c.manager_name}
                  {c.manager_phone && <div className="text-slate-500">{c.manager_phone}</div>}
                </td>
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
      {importing && <CentreImport data={data.data} onClose={() => setImporting(false)} onDone={data.reload} />}
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
    manager_name: centre.manager_name ?? '',
    manager_phone: centre.manager_phone ?? '',
    opening_hours: centre.opening_hours ?? '',
    weekly_off: centre.weekly_off ?? '',
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Outlet manager">
            <input className={inputCls} value={f.manager_name} onChange={(e) => setF({ ...f, manager_name: e.target.value })} />
          </Field>
          <Field label="Manager mobile">
            <input className={inputCls} type="tel" value={f.manager_phone} onChange={(e) => setF({ ...f, manager_phone: e.target.value })} />
          </Field>
          <Field label="Opening hours">
            <input className={inputCls} value={f.opening_hours} onChange={(e) => setF({ ...f, opening_hours: e.target.value })} placeholder="9:30 am – 7:00 pm" />
          </Field>
          <Field label="Weekly off">
            <input className={inputCls} value={f.weekly_off} onChange={(e) => setF({ ...f, weekly_off: e.target.value })} placeholder="Tuesday" />
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

/** Upload the filled-in centre details template, preview what will change, then save. */
function CentreImport({ data, onClose, onDone }: { data: Data; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<(ParsedCentreRow & { include: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ name: string; ok: boolean; action: string; location: string }[] | null>(null);
  const nameOf = (id: number | null) => data.centres.find((c) => c.id === id)?.name;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResults(null);
    try {
      const parsed = await parseCentreDetails(file, data.centres, data.aliases);
      // Unknown names are not added automatically: they may be another name for an existing centre.
      setRows(parsed.map((r) => ({ ...r, include: r.centre_id !== null })));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const chosen = rows!.filter((r) => r.include);
      const res = await api.post<{ results: typeof results }>('/centres/import', { rows: chosen });
      setResults(res.results);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chosen = rows?.filter((r) => r.include).length ?? 0;
  return (
    <Modal open onClose={onClose} title="Import centre details" wide>
      <div className="space-y-4">
        {!results && (
          <>
            <p className="text-sm text-slate-600">
              Upload the filled-in <strong>Centre details</strong> Excel. You will see every row before anything is saved. Empty cells never erase what is
              already saved.
            </p>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-medium file:text-brand-800"
            />
          </>
        )}
        <ErrorBox error={error} />
        {rows && !results && (
          <>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="p-2" />
                    <th className="p-2">Centre</th>
                    <th className="p-2">Location</th>
                    <th className="p-2">Manager</th>
                    <th className="p-2">Hours / off</th>
                    <th className="p-2">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-t border-slate-100 align-top ${r.centre_id === null ? 'bg-amber-50' : ''}`}>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
                          aria-label={`Include ${r.name}`}
                        />
                      </td>
                      <td className="p-2">
                        <div className="font-medium">{r.name}</div>
                        <div className={r.centre_id ? 'text-green-700' : 'text-amber-700'}>
                          {r.centre_id ? (nameOf(r.centre_id) === r.name ? 'Update' : `Update ${nameOf(r.centre_id)}`) : 'New centre (tick to add)'}
                        </div>
                      </td>
                      <td className="p-2">
                        {r.coords ? (
                          <span className="text-green-700">
                            ✓ {r.coords.lat.toFixed(5)}, {r.coords.lng.toFixed(5)}
                          </span>
                        ) : r.linkToResolve ? (
                          <span className="text-slate-600">Short link – read on save</span>
                        ) : r.maps ? (
                          <span className="text-red-600">Can't read: {r.maps.slice(0, 40)}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        {r.manager_name}
                        <div className="text-slate-500">{r.manager_phone}</div>
                      </td>
                      <td className="p-2">
                        {r.opening_hours}
                        <div className="text-slate-500">{r.weekly_off}</div>
                      </td>
                      <td className="max-w-48 p-2 text-slate-600">{r.remarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              Yellow rows are names not in your centre list. If the client says one is the same as an existing centre, leave it unticked and add the
              name under that centre's "Other names" instead.
            </p>
            <Button onClick={save} busy={busy} disabled={!chosen}>
              Save {chosen} centre(s)
            </Button>
          </>
        )}
        {results && (
          <>
            <ul className="space-y-1 text-sm">
              {results.map((r) => (
                <li key={r.name} className={r.ok ? '' : 'text-red-600'}>
                  {r.ok ? '✓' : '✗'} <strong>{r.name}</strong> – {r.action}
                  {r.location !== 'saved' && <span className="text-amber-700"> (location {r.location})</span>}
                </li>
              ))}
            </ul>
            <Button onClick={onClose}>Done</Button>
          </>
        )}
      </div>
    </Modal>
  );
}
