import { useState } from 'react';
import { api } from '../../lib/api';
import type { User } from '../../lib/types';
import type { Role } from '../../../shared/domain';
import { Button, Card, ErrorBox, Field, Loading, Modal, PageTitle, inputCls, useLoad } from '../../components/ui';
import { saveBlob } from '../../lib/reports';
import { auditorTemplate, credentialsSheet, loginMessage, makePassword, makeUsername, parseAuditors, type AuditorRow } from '../../lib/auditorTemplate';

const ROLE_LABEL: Record<Role, string> = { admin: 'Administrators', auditor: 'Auditors', planner: 'Planners', client: 'Client logins (Tractor Junction)' };
const ROLE_HINT: Record<Role, string> = {
  admin: 'Full access, including monthly visits and staff tracking.',
  auditor: 'Field staff. Use the phone app to check in and audit their assigned centres.',
  client: 'Read-only. See approved audits, photos and download reports. Cannot see tracking or monthly visits.',
  planner: 'Plans the week: which centre, which date, which auditor. Sees the plan and each visit’s status only – no photos, reports or tracking.',
};

export default function Users() {
  const users = useLoad(() => api.get<User[]>('/users'));
  const [edit, setEdit] = useState<Partial<User> | null>(null);
  const [importing, setImporting] = useState(false);

  if (!users.data) return users.error ? <ErrorBox error={users.error} /> : <Loading />;

  return (
    <div>
      <PageTitle
        title="People"
        sub="Auditors, client logins and administrators."
        actions={
          <>
            <Button variant="secondary" onClick={async () => saveBlob(await auditorTemplate(), 'Auditor_Details_Template.xlsx')}>
              Download auditor template
            </Button>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              Import auditors
            </Button>
            <Button onClick={() => setEdit({ role: 'auditor', active: 1 })}>Add person</Button>
          </>
        }
      />
      {(['auditor', 'planner', 'client', 'admin'] as Role[]).map((role) => {
        const list = users.data!.filter((u) => u.role === role);
        return (
          <section key={role} className="mb-6">
            <h2 className="font-semibold">{ROLE_LABEL[role]}</h2>
            <p className="mb-2 text-xs text-slate-500">{ROLE_HINT[role]}</p>
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {list.map((u) => (
                    <tr key={u.id} className={`border-b border-slate-100 last:border-0 ${u.active ? '' : 'opacity-50'}`}>
                      <td className="px-3 py-2 font-medium">
                        {u.name}
                        {!u.active && <span className="ml-1 text-xs text-red-600">deactivated</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{u.username}</td>
                      <td className="px-3 py-2">{u.phone}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {u.home_area}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{u.id_proof}</td>
                      <td className="space-x-2 px-3 py-2 text-right whitespace-nowrap">
                        <Button size="sm" variant="secondary" onClick={() => setEdit(u)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!list.length && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500">None yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </section>
        );
      })}
      {edit && <UserEditor user={edit} onClose={() => setEdit(null)} onSaved={users.reload} />}
      {importing && <ImportAuditors users={users.data} onClose={() => setImporting(false)} onDone={users.reload} />}
    </div>
  );
}

function UserEditor({ user, onClose, onSaved }: { user: Partial<User>; onClose: () => void; onSaved: () => void }) {
  const isNew = !user.id;
  const [f, setF] = useState({
    name: user.name ?? '',
    username: user.username ?? '',
    phone: user.phone ?? '',
    home_area: user.home_area ?? '',
    id_proof: user.id_proof ?? '',
    role: user.role ?? 'auditor',
    active: user.active ?? 1,
    password: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (isNew) await api.post('/users', f);
      else {
        const { username: _u, password, ...rest } = f;
        void _u;
        await api.patch(`/users/${user.id}`, password ? { ...rest, password } : rest);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add person' : `Edit ${user.name}`}>
      <div className="space-y-3">
        <Field label="Role">
          <select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            <option value="auditor">Auditor (field staff)</option>
            <option value="client">Client (Tractor Junction, read-only)</option>
            <option value="planner">Planner (plans the weekly schedule)</option>
            <option value="admin">Administrator</option>
          </select>
        </Field>
        <Field label="Full name">
          <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username" hint={isNew ? 'Used to sign in' : 'Cannot be changed'}>
            <input className={inputCls} value={f.username} disabled={!isNew} autoCapitalize="none" onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/\s+/g, '') })} />
          </Field>
          <Field label="Phone">
            <input className={inputCls} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
        </div>
        {f.role === 'auditor' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Home town / base area">
                <input className={inputCls} value={f.home_area} onChange={(e) => setF({ ...f, home_area: e.target.value })} />
              </Field>
              <Field label="ID proof (type + last 4)">
                <input className={inputCls} value={f.id_proof} onChange={(e) => setF({ ...f, id_proof: e.target.value })} placeholder="Aadhaar ••••1234" />
              </Field>
            </div>

          </>
        )}
        <Field label={isNew ? 'Password' : 'Reset password'} hint={isNew ? 'At least 8 characters. Share it with the person.' : 'Leave empty to keep the current password.'}>
          <input className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
        </Field>
        {!isNew && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} />
            Active (untick to block sign-in, e.g. when someone leaves)
          </label>
        )}
        <ErrorBox error={error} />
        <Button onClick={save} busy={busy} disabled={!f.name.trim() || !f.username || (isNew && f.password.length < 8)}>
          Save
        </Button>
      </div>
    </Modal>
  );
}

type Created = { name: string; phone: string; home_area: string; username: string; password: string };

/** Create many auditor logins from the filled auditor template, then hand out the login details once. */
function ImportAuditors({ users, onClose, onDone }: { users: User[]; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<AuditorRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const appUrl = window.location.origin;
  const ready = rows?.filter((r) => !r.problem) ?? [];

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setRows(await parseAuditors(file, users));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function create() {
    const taken = new Set(users.map((u) => u.username));
    const out: Created[] = [];
    const bad: string[] = [];
    // One request per person keeps each sign-up within the server's per-request limits.
    for (const [i, r] of ready.entries()) {
      setBusy(`Creating ${i + 1} of ${ready.length}…`);
      const username = makeUsername(r.name, r.phone, taken);
      const password = makePassword();
      try {
        await api.post('/users', { username, name: r.name, phone: r.phone, role: 'auditor', home_area: r.home_area, id_proof: r.id_proof, password });
        out.push({ name: r.name, phone: r.phone, home_area: r.home_area, username, password });
      } catch (e) {
        bad.push(`${r.name}: ${(e as Error).message}`);
      }
    }
    setBusy(null);
    setCreated(out);
    setFailed(bad);
    onDone();
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setError('Could not copy. Use the Excel download instead.');
    }
  }

  return (
    <Modal open onClose={created ? onClose : busy ? () => undefined : onClose} title="Import auditors" wide>
      <div className="space-y-4">
        {!created && (
          <>
            <p className="text-sm text-slate-600">
              Upload the filled <strong>Auditor details</strong> Excel. Each person gets a login (first name + last 4 digits of their mobile) and a
              starting password. You will see the list before anything is created.
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
        {rows && !created && (
          <>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="p-2">Name</th>
                    <th className="p-2">Mobile</th>
                    <th className="p-2">Base area</th>
                    <th className="p-2">ID</th>
                    <th className="p-2">Phone</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-t border-slate-100 ${r.problem ? 'bg-amber-50' : ''}`}>
                      <td className="p-2 font-medium">{r.name}</td>
                      <td className="p-2">{r.phone || '—'}</td>
                      <td className="p-2">{r.home_area}</td>
                      <td className="p-2">{r.id_proof}</td>
                      <td className={`p-2 ${/iphone|ios/i.test(r.phone_type) ? 'text-amber-700' : ''}`}>{r.phone_type}</td>
                      <td className={`p-2 ${r.problem ? 'text-amber-800' : 'text-green-700'}`}>{r.problem ?? 'Will be created'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.some((r) => /iphone|ios/i.test(r.phone_type)) && (
              <p className="text-xs text-amber-700">iPhone users can work in Safari, but location is only recorded while the app is open on screen.</p>
            )}
            <Button onClick={create} busy={!!busy} disabled={!ready.length}>
              {busy ?? `Create ${ready.length} auditor login(s)`}
            </Button>
          </>
        )}
        {created && (
          <>
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Save these now.</strong> Starting passwords are shown only on this screen. Download the Excel or copy each message to send on
              WhatsApp.
            </div>
            {failed.length > 0 && <ErrorBox error="Some logins were not created:" problems={failed} />}
            <div className="max-h-[45vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="p-2">Name</th>
                    <th className="p-2">Username</th>
                    <th className="p-2">Starting password</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {created.map((c) => (
                    <tr key={c.username} className="border-t border-slate-100">
                      <td className="p-2">{c.name}</td>
                      <td className="p-2 font-mono">{c.username}</td>
                      <td className="p-2 font-mono">{c.password}</td>
                      <td className="p-2 text-right">
                        <Button size="sm" variant="secondary" onClick={() => copy(loginMessage(c.name, c.username, c.password, appUrl), c.username)}>
                          {copied === c.username ? 'Copied ✓' : 'Copy message'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button onClick={async () => saveBlob(await credentialsSheet(created, appUrl), 'Auditor_Logins.xlsx')}>Download login details (Excel)</Button>
              <Button variant="secondary" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
