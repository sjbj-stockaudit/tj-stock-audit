import { useState } from 'react';
import { api } from '../../lib/api';
import type { User } from '../../lib/types';
import type { Role } from '../../../shared/domain';
import { Button, Card, ErrorBox, Field, Loading, Modal, PageTitle, inputCls, useLoad } from '../../components/ui';

const ROLE_LABEL: Record<Role, string> = { admin: 'Administrators', auditor: 'Auditors', client: 'Client logins (Tractor Junction)' };
const ROLE_HINT: Record<Role, string> = {
  admin: 'Full access, including billing and staff tracking.',
  auditor: 'Field staff. Use the phone app to check in and audit their assigned centres.',
  client: 'Read-only. See approved audits, photos and download reports. Cannot see tracking or billing.',
};

export default function Users() {
  const users = useLoad(() => api.get<User[]>('/users'));
  const [edit, setEdit] = useState<Partial<User> | null>(null);

  if (!users.data) return users.error ? <ErrorBox error={users.error} /> : <Loading />;

  return (
    <div>
      <PageTitle title="People" sub="Auditors, client logins and administrators." actions={<Button onClick={() => setEdit({ role: 'auditor', active: 1 })}>Add person</Button>} />
      {(['auditor', 'client', 'admin'] as Role[]).map((role) => {
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
                      <td className="px-3 py-2 text-xs text-slate-500">{u.agency}</td>
                      <td className="px-3 py-2 text-right">
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
    </div>
  );
}

function UserEditor({ user, onClose, onSaved }: { user: Partial<User>; onClose: () => void; onSaved: () => void }) {
  const isNew = !user.id;
  const [f, setF] = useState({
    name: user.name ?? '',
    username: user.username ?? '',
    phone: user.phone ?? '',
    agency: user.agency ?? '',
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
          <Field label="Staffing agency" hint="Used to group the monthly billing report">
            <input className={inputCls} value={f.agency} onChange={(e) => setF({ ...f, agency: e.target.value })} />
          </Field>
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
