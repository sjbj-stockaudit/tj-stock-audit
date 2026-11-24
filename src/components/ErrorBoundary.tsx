import { Component, type ReactNode } from 'react';
import { translate as tr } from '../lib/i18n';

/** Safety net: if a screen crashes, show a message with a way out instead of a blank white page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Report to the server log so the office can see what happened
    try {
      void fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: String(error?.message ?? error).slice(0, 500), stack: String(error?.stack ?? '').slice(0, 1500), url: location.href }),
      });
    } catch {
      /* ignore */
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow">
          <div className="text-3xl">⚠️</div>
          <h1 className="mt-2 font-semibold">{tr('Something went wrong on this screen')}</h1>
          <p className="mt-1 text-sm text-slate-600">{tr('Your saved work is safe. Try reloading. If it keeps happening, send a screenshot of this message to the office.')}</p>
          <p className="mt-3 rounded bg-slate-100 p-2 font-mono text-xs break-words text-slate-600">{this.state.error.message}</p>
          <div className="mt-4 grid gap-2">
            <button onClick={() => location.reload()} className="rounded-lg bg-brand-800 px-4 py-2.5 font-medium text-white">
              {tr('Reload')}
            </button>
            <button onClick={() => location.assign('/')} className="rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-800">
              {tr('Back to my centres')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
