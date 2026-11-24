import { Spinner } from './ui';

/** Start-up screen: the firm's logo while the app checks who is signed in. */
export default function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-white">
      <img src="/brand/sjbj-logo.png" alt="SJBJ & Associates, Chartered Accountants" className="w-64 max-w-[70vw]" />
      <div className="flex items-center gap-2 text-sm tracking-wide text-slate-500">
        <Spinner className="h-3.5 w-3.5" /> Stock Audit
      </div>
    </div>
  );
}
