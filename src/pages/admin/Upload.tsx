import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { centreKey } from '../../../shared/domain';
import { api } from '../../lib/api';
import { parseStockStatement, type ParsedSheet } from '../../lib/excelImport';
import { todayIST } from '../../lib/format';
import type { Centre, User } from '../../lib/types';
import { Button, Card, ErrorBox, Field, PageTitle, inputCls, useLoad } from '../../components/ui';

type Plan = ParsedSheet & {
  include: boolean;
  centre_id: number | ''; // '' = not matched yet
  matched: 'name' | 'alias' | null;
  remember_alias: boolean;
  auditor_id: number | '';
};

const NEW = -1;

export default function Upload() {
  const navigate = useNavigate();
  const centres = useLoad(() => api.get<{ centres: Centre[]; aliases: { alias: string; centre_id: number }[] }>('/centres'));
  const users = useLoad(() => api.get<User[]>('/users'));
  const auditors = (users.data ?? []).filter((u) => u.role === 'auditor' && u.active);

  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(todayIST());
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [newState, setNewState] = useState('MP');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(f: File | null) {
    setFile(f);
    setPlans(null);
    setError(null);
    if (!f || !centres.data) return;
    try {
      const sheets = await parseStockStatement(f);
      if (!sheets.length) return setError('No sheets with a "chassisNumber" column were found in this file.');
      const byName = new Map(centres.data.centres.filter((c) => c.active).map((c) => [centreKey(c.name), c.id]));
      const byAlias = new Map(centres.data.aliases.map((a) => [a.alias, a.centre_id]));
      setPlans(
        sheets.map((s) => {
          const k = centreKey(s.sheet_name);
          const id = byName.get(k) ?? byAlias.get(k);
          return {
            ...s,
            include: s.rows.length > 0,
            centre_id: id ?? '',
            matched: byName.has(k) ? 'name' : byAlias.has(k) ? 'alias' : null,
            remember_alias: true,
            auditor_id: '',
          };
        }),
      );
    } catch (e) {
      setError(`Could not read this file: ${(e as Error).message}`);
    }
  }

  const update = (i: number, patch: Partial<Plan>) => setPlans((p) => p!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const included = useMemo(() => (plans ?? []).filter((p) => p.include), [plans]);
  const unresolved = included.filter((p) => p.centre_id === '');
  const unassigned = included.filter((p) => p.auditor_id === '');
  const totalTractors = included.reduce((a, p) => a + p.rows.length, 0);

  async function submit() {
    if (!plans) return;
    setBusy(true);
    setError(null);
    try {
      // Create any brand-new centres first
      const sheets = [];
      for (const p of included) {
        let centreId = p.centre_id as number;
        if (centreId === NEW) {
          const r = await api.post<{ id: number }>('/centres', { state: newState, name: p.sheet_name });
          centreId = r.id;
        }
        sheets.push({
          sheet_name: p.sheet_name,
          centre_id: centreId,
          auditor_id: p.auditor_id || null,
          remember_alias: p.matched === null && p.centre_id !== NEW && p.remember_alias,
          rows: p.rows,
        });
      }
      await api.post('/uploads', { filename: file?.name, audit_date: date, sheets });
      navigate(`/visits?from=${date}&to=${date}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageTitle title="Upload stock statement" sub="Upload the Excel file from Tractor Junction. Each sheet becomes one centre audit." />
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Stock statement (.xlsx)">
          <input
            type="file"
            accept=".xlsx"
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-medium file:text-brand-800"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            disabled={!centres.data}
          />
        </Field>
        <Field label="Audit date">
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </Card>
      <div className="mt-3">
        <ErrorBox error={error ?? centres.error ?? users.error} />
      </div>

      {plans && (
        <>
          <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {included.length} centres · {totalTractors} tractors
            </h2>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Assign all to</span>
              <select
                className={`${inputCls} w-auto py-1`}
                value=""
                onChange={(e) => setPlans((p) => p!.map((x) => (x.include ? { ...x, auditor_id: Number(e.target.value) } : x)))}
              >
                <option value="">Choose auditor…</option>
                {auditors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-3">
            {plans.map((p, i) => (
              <Card key={p.sheet_name + i} className={`p-4 ${p.include ? '' : 'opacity-50'}`}>
                <div className="flex flex-wrap items-start gap-4">
                  <label className="flex min-w-40 items-center gap-2 font-medium">
                    <input type="checkbox" checked={p.include} onChange={(e) => update(i, { include: e.target.checked })} />
                    {p.sheet_name}
                    <span className="text-sm font-normal text-slate-500">({p.rows.length} tractors)</span>
                  </label>
                  <div className="min-w-56 flex-1">
                    {p.matched ? (
                      <div className="text-sm text-green-700">
                        ✓ Matched to {centres.data!.centres.find((c) => c.id === p.centre_id)?.name}
                        {p.matched === 'alias' && ' (saved name)'}
                      </div>
                    ) : (
                      <div className="space-y-2 rounded-lg bg-amber-50 p-2 text-sm">
                        <div className="font-medium text-amber-800">"{p.sheet_name}" is not in your centre list.</div>
                        <select
                          className={`${inputCls} py-1`}
                          value={p.centre_id}
                          onChange={(e) => update(i, { centre_id: e.target.value === '' ? '' : Number(e.target.value) })}
                        >
                          <option value="">Choose what this is…</option>
                          <option value={NEW}>Add "{p.sheet_name}" as a new centre</option>
                          {centres.data!.centres.filter((c) => c.active).map((c) => (
                            <option key={c.id} value={c.id}>
                              Same as existing centre: {c.name} ({c.state})
                            </option>
                          ))}
                        </select>
                        {p.centre_id === NEW && (
                          <label className="flex items-center gap-2">
                            State
                            <input className={`${inputCls} w-20 py-1`} value={newState} onChange={(e) => setNewState(e.target.value.toUpperCase())} />
                          </label>
                        )}
                        {typeof p.centre_id === 'number' && p.centre_id !== NEW && (
                          <label className="flex items-center gap-2">
                            <input type="checkbox" checked={p.remember_alias} onChange={(e) => update(i, { remember_alias: e.target.checked })} />
                            Remember this for future uploads
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                  <select
                    className={`${inputCls} w-auto`}
                    value={p.auditor_id}
                    onChange={(e) => update(i, { auditor_id: e.target.value ? Number(e.target.value) : '' })}
                    aria-label={`Auditor for ${p.sheet_name}`}
                  >
                    <option value="">Assign auditor…</option>
                    {auditors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                {p.warnings.length > 0 && (
                  <details className="mt-2 text-sm text-amber-700">
                    <summary className="cursor-pointer">{p.warnings.length} data issue(s) in this sheet</summary>
                    <ul className="mt-1 list-disc pl-5">
                      {p.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            ))}
          </div>
          <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/95 py-3">
            {unresolved.length > 0 && <span className="text-sm text-amber-700">Choose a centre for {unresolved.map((p) => p.sheet_name).join(', ')}</span>}
            {!unresolved.length && unassigned.length > 0 && (
              <span className="text-sm text-slate-500">{unassigned.length} centre(s) without an auditor – you can assign later.</span>
            )}
            <Button onClick={submit} busy={busy} disabled={!included.length || unresolved.length > 0}>
              Create {included.length} audits
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
