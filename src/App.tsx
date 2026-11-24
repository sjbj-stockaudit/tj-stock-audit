import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import type { Me } from './lib/types';
import { Loading, cx } from './components/ui';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Account from './pages/Account';
// Office pages pull in the Excel/PDF/map libraries, so they load only when opened.
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Upload = lazy(() => import('./pages/admin/Upload'));
const Visits = lazy(() => import('./pages/admin/Visits'));
const VisitView = lazy(() => import('./pages/VisitView'));
const Live = lazy(() => import('./pages/admin/Live'));
const Centres = lazy(() => import('./pages/admin/Centres'));
const Users = lazy(() => import('./pages/admin/Users'));
const Billing = lazy(() => import('./pages/admin/Billing'));
const Reports = lazy(() => import('./pages/Reports'));
import AuditorHome from './pages/auditor/Home';
import Audit from './pages/auditor/Audit';
import SelfieGate from './pages/auditor/SelfieGate';

type AuthCtx = { me: Me; refresh: () => Promise<void>; logout: () => Promise<void> };
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [practice, setPractice] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/me'));
    } catch {
      const s = await api.get<{ needed: boolean }>('/setup').catch(() => ({ needed: false }));
      setSetupNeeded(s.needed);
      setMe(null);
    }
  }, []);

  useEffect(() => {
    api.get<{ practice?: boolean }>('/setup').then((s) => setPractice(!!s.practice), () => undefined);
    void refresh();
    const onOut = () => setMe(null);
    const onSelfie = () => void refresh();
    window.addEventListener('tj:signed-out', onOut);
    window.addEventListener('tj:selfie-required', onSelfie);
    return () => {
      window.removeEventListener('tj:signed-out', onOut);
      window.removeEventListener('tj:selfie-required', onSelfie);
    };
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/logout').catch(() => undefined);
    setMe(null);
  }, []);

  if (me === undefined) return <Loading />;
  return (
    <>
      {practice && <PracticeBanner />}
      <Main me={me} setupNeeded={setupNeeded} refresh={refresh} logout={logout} />
    </>
  );
}

/** Shown on the practice copy so it can never be mistaken for the live app. */
function PracticeBanner() {
  return (
    <div className="relative z-[900] bg-orange-500 px-3 py-1.5 text-center text-xs font-semibold tracking-wide text-white">
      PRACTICE COPY – test data only, nothing here reaches the live app or the client
    </div>
  );
}

function Main({
  me,
  setupNeeded,
  refresh,
  logout,
}: {
  me: Me | null;
  setupNeeded: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}) {
  if (me === null)
    return (
      <Routes>
        <Route path="*" element={setupNeeded ? <Setup onDone={refresh} /> : <Login onDone={refresh} />} />
      </Routes>
    );

  if (me.role === 'auditor' && me.selfie_required) return <SelfieGate name={me.name} onDone={refresh} onSignOut={logout} />;

  return (
    <Ctx.Provider value={{ me, refresh, logout }}>
      {me.role === 'auditor' ? <AuditorShell /> : <OfficeShell />}
    </Ctx.Provider>
  );
}

// ------------------------------------------------------------------ auditor (phone)

function AuditorShell() {
  const { me, logout } = useAuth();
  return (
    <div className="mx-auto min-h-screen max-w-xl">
      <header className="sticky top-0 z-[500] flex items-center justify-between bg-brand-900 px-4 py-3 text-white">
        <NavLink to="/" className="flex items-center gap-2 font-semibold">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          Stock Audit
        </NavLink>
        <div className="flex items-center gap-3 text-sm">
          <NavLink to="/account" className="opacity-90">
            {me.name.split(' ')[0]}
          </NavLink>
          <button onClick={logout} className="rounded-md bg-white/10 px-2 py-1">
            Sign out
          </button>
        </div>
      </header>
      <main className="p-4 pb-24">
        <Routes>
          <Route path="/" element={<AuditorHome />} />
          <Route path="/audit/:id" element={<Audit />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ admin & client (desktop or phone)

const ADMIN_NAV = [
  ['/', 'Dashboard'],
  ['/upload', 'Upload stock'],
  ['/visits', 'Audits'],
  ['/live', 'Live map'],
  ['/reports', 'Weekly reports'],
  ['/billing', 'Monthly visits'],
  ['/centres', 'Centres'],
  ['/users', 'People'],
] as const;

const CLIENT_NAV = [['/', 'Audit reports']] as const;

function OfficeShell() {
  const { me, logout } = useAuth();
  const nav = me.role === 'admin' ? ADMIN_NAV : CLIENT_NAV;
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="min-h-screen lg:flex">
      <aside className={cx('bg-brand-900 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-56 lg:flex-col', open ? 'block' : 'hidden lg:flex')}>
        <div className="hidden items-center gap-2 px-4 py-4 font-semibold lg:flex">
          <img src="/icon.svg" alt="" className="h-7 w-7" /> Stock Audit
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {nav.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cx('rounded-lg px-3 py-2 text-sm', isActive ? 'bg-white/15 font-medium' : 'text-white/80 hover:bg-white/10')}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 p-3 text-sm">
          <div className="font-medium">{me.name}</div>
          <div className="text-xs text-white/60">{me.role === 'admin' ? 'Administrator' : 'Client access'}</div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => (setOpen(false), navigate('/account'))} className="rounded-md bg-white/10 px-2 py-1 text-xs">
              Password
            </button>
            <button onClick={logout} className="rounded-md bg-white/10 px-2 py-1 text-xs">
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-[500] flex items-center justify-between bg-brand-900 px-4 py-3 text-white lg:hidden">
          <span className="flex items-center gap-2 font-semibold">
            <img src="/icon.svg" alt="" className="h-7 w-7" /> Stock Audit
          </span>
          <button onClick={() => setOpen((o) => !o)} className="rounded-md bg-white/10 px-3 py-1 text-sm" aria-expanded={open}>
            Menu
          </button>
        </header>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">
          <Suspense fallback={<Loading />}>
          <Routes>
            {me.role === 'admin' ? (
              <>
                <Route path="/" element={<Dashboard />} />
                <Route path="/upload" element={<Upload />} />
                <Route path="/visits" element={<Visits />} />
                <Route path="/live" element={<Live />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/centres" element={<Centres />} />
                <Route path="/users" element={<Users />} />
              </>
            ) : (
              <Route path="/" element={<Reports />} />
            )}
            <Route path="/visits/:id" element={<VisitView />} />
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
