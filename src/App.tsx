import {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { api } from "./lib/api";
import { useBackClose } from "./lib/backButton";
import type { Me } from "./lib/types";
import { Loading, cx } from "./components/ui";
import { LangToggle, setOfficeMode, useT } from "./lib/i18n";
import Login from "./pages/Login";
import Splash from "./components/Splash";
import Setup from "./pages/Setup";
import Account from "./pages/Account";
import Bell from "./components/Bell";
import { deviceToken, startPush } from "./lib/push";
// Office pages pull in the Excel/PDF/map libraries, so they load only when opened.
const Dashboard = lazy(() => import("./pages/admin/Dashboard"));
const Upload = lazy(() => import("./pages/admin/Upload"));
const Visits = lazy(() => import("./pages/admin/Visits"));
const VisitView = lazy(() => import("./pages/VisitView"));
const Live = lazy(() => import("./pages/admin/Live"));
const Centres = lazy(() => import("./pages/admin/Centres"));
const Users = lazy(() => import("./pages/admin/Users"));
const Billing = lazy(() => import("./pages/admin/Billing"));
const Reports = lazy(() => import("./pages/Reports"));
const Plan = lazy(() => import("./pages/Plan"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Inventory = lazy(() => import("./pages/Inventory"));
const InventoryCentre = lazy(() => import("./pages/Inventory").then((m) => ({ default: m.InventoryCentre })));
import AuditorHome from "./pages/auditor/Home";
import Audit from "./pages/auditor/Audit";

type AuthCtx = {
  me: Me;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [setupNeeded, setSetupNeeded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>("/me"));
    } catch {
      const s = await api
        .get<{ needed: boolean }>("/setup")
        .catch(() => ({ needed: false }));
      setSetupNeeded(s.needed);
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onOut = () => setMe(null);
    const onSelfie = () => void refresh();
    window.addEventListener("tj:signed-out", onOut);
    window.addEventListener("tj:selfie-required", onSelfie);
    return () => {
      window.removeEventListener("tj:signed-out", onOut);
      window.removeEventListener("tj:selfie-required", onSelfie);
    };
  }, [refresh]);

  // Hindi is offered to auditors only; office, client and planner screens stay English
  useEffect(() => setOfficeMode(!!me && me.role !== "auditor"), [me]);

  // Phone alerts (Android app): register once signed in (not for the client portal)
  useEffect(() => {
    if (me && me.role !== "client") void startPush();
  }, [me]);

  const logout = useCallback(async () => {
    await api
      .post("/logout", { device_token: deviceToken() })
      .catch(() => undefined);
    setMe(null);
  }, []);

  if (me === undefined) return <Splash />;
  return (
    <Main me={me} setupNeeded={setupNeeded} refresh={refresh} logout={logout} />
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
        <Route
          path="*"
          element={
            setupNeeded ? (
              <Setup onDone={refresh} />
            ) : (
              <Login onDone={refresh} />
            )
          }
        />
      </Routes>
    );

  return (
    <Ctx.Provider value={{ me, refresh, logout }}>
      {me.role === "auditor" ? <AuditorShell /> : <OfficeShell />}
    </Ctx.Provider>
  );
}

// ------------------------------------------------------------------ auditor (phone)

function AuditorShell() {
  const { me, logout } = useAuth();
  const t = useT();
  return (
    <div className="mx-auto min-h-screen max-w-xl">
      <header className="sticky top-0 z-[500] flex items-center justify-between bg-brand-900 px-4 py-3 text-white">
        <NavLink to="/" className="flex items-center gap-2 font-semibold">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          Stock Audit
        </NavLink>
        <div className="flex items-center gap-2 text-sm">
          <LangToggle dark />
          <Bell />
          <NavLink to="/account" className="opacity-90">
            {me.name.split(" ")[0]}
          </NavLink>
          <button onClick={logout} className="rounded-md bg-white/10 px-2 py-1">
            {t("Sign out")}
          </button>
        </div>
      </header>
      <main className="p-4 pb-24">
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<AuditorHome />} />
            <Route path="/audit/:id" element={<Audit />} />
            <Route path="/account" element={<Account />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ admin & client (desktop or phone)

const ADMIN_NAV = [
  ["/", "Dashboard"],
  ["/plan", "Weekly plan"],
  ["/upload", "Upload stock"],
  ["/visits", "Audits"],
  ["/inventory", "Inventory"],
  ["/live", "Live map"],
  ["/reports", "Weekly reports"],
  ["/billing", "Monthly visits"],
  ["/centres", "Centres"],
  ["/users", "People"],
] as const;

const CLIENT_NAV = [
  ["/", "Audit reports"],
  ["/inventory", "Inventory"],
] as const;
const PLANNER_NAV = [["/", "Weekly plan"]] as const;

function OfficeShell() {
  const { me, logout } = useAuth();
  const nav =
    me.role === "admin"
      ? ADMIN_NAV
      : me.role === "planner"
        ? PLANNER_NAV
        : CLIENT_NAV;
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  const navigate = useNavigate();
  return (
    <div className="min-h-screen lg:flex">
      {/* Phone: dark backdrop behind the slide-in menu; tap it to close */}
      <div
        className={cx(
          "fixed inset-0 z-[600] bg-black/40 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-[700] flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-brand-900 text-white shadow-xl transition-transform duration-200",
          "lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-56 lg:translate-x-0 lg:shadow-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Menu"
      >
        <div className="m-3 rounded-xl bg-white p-3 text-center text-slate-600">
          {me.role === "client" ? (
            <>
              <img
                src="/brand/tj-logo.svg"
                alt="Tractor Junction"
                className="mx-auto h-16"
              />
              <div className="mt-2 text-[11px]">Stock verification by</div>
              <img
                src="/brand/sjbj-logo.png"
                alt="SJBJ & Associates"
                className="mx-auto mt-1 w-36"
              />
            </>
          ) : (
            <>
              <img
                src="/brand/sjbj-logo.png"
                alt="SJBJ & Associates"
                className="mx-auto w-full"
              />
              <div className="mt-2 text-xs font-semibold tracking-wide">
                Stock Audit
              </div>
            </>
          )}
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {nav.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx(
                  "rounded-lg px-3 py-2 text-sm",
                  isActive
                    ? "bg-white/15 font-medium"
                    : "text-white/80 hover:bg-white/10",
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 p-3 text-sm">
          <div className="flex items-center justify-between">
            <div className="font-medium">{me.name}</div>
            {me.role !== "client" && <Bell className="hidden lg:inline-flex" />}
          </div>
          <div className="text-xs text-white/60">
            {me.role === "admin"
              ? "Administrator"
              : me.role === "planner"
                ? "Planner"
                : "Client access"}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => (setOpen(false), navigate("/account"))}
              className="rounded-md bg-white/10 px-2 py-1 text-xs"
            >
              Password
            </button>
            <button
              onClick={logout}
              className="rounded-md bg-white/10 px-2 py-1 text-xs"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-[500] flex items-center justify-between bg-brand-900 px-3 py-3 text-white lg:hidden">
          <span className="flex items-center gap-2 font-semibold">
            <button
              onClick={() => setOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10"
              aria-label="Open menu"
              aria-expanded={open}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <img src="/icon.svg" alt="" className="h-7 w-7" /> Stock Audit
          </span>
          {me.role !== "client" && <Bell />}
        </header>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">
          <Suspense fallback={<Loading />}>
            <Routes>
              {me.role === "admin" ? (
                <>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/upload" element={<Upload />} />
                  <Route path="/visits" element={<Visits />} />
                  <Route path="/live" element={<Live />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/billing" element={<Billing />} />
                  <Route path="/centres" element={<Centres />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/plan" element={<Plan />} />
                </>
              ) : me.role === "planner" ? (
                <Route path="/" element={<Plan />} />
              ) : (
                <Route path="/" element={<Reports />} />
              )}
              <Route path="/visits/:id" element={<VisitView />} />
              {me.role !== "planner" && (
                <>
                  <Route path="/inventory" element={<Inventory />} />
                  <Route path="/inventory/:id" element={<InventoryCentre />} />
                </>
              )}
              <Route path="/account" element={<Account />} />
              {me.role !== "client" && (
                <Route path="/notifications" element={<Notifications />} />
              )}
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
