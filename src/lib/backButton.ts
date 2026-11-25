// Android back button: close whatever is open on top (menu, pop-up, camera) first,
// otherwise go to the previous screen; on the home screen, send the app to the background
// instead of closing it, so location recording during an audit keeps running.
import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

const stack: { close: () => void }[] = [];

/** While `open` is true, the back button calls `close` (most recently opened first). */
export function useBackClose(open: boolean, close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!open) return;
    const entry = { close: () => ref.current() };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}

let started = false;
export function startBackButton() {
  if (started || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('App')) return;
  started = true;
  void App.addListener('backButton', () => {
    const top = stack[stack.length - 1];
    if (top) return top.close();
    if (location.pathname !== '/' && history.length > 1) return history.back();
    if (location.pathname !== '/') return location.assign('/');
    void App.minimizeApp();
  });
}
