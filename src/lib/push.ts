import { Capacitor } from '@capacitor/core';
import { api } from './api';

const TOKEN_KEY = 'tj_push_token';
let started = false;

/** This phone's alert token (sent at sign-out so a signed-out phone stops getting alerts). */
export function deviceToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Android app only: ask for notification permission and register this phone for alerts.
 * Skipped in the browser, in older app versions without the plugin, and until the office has
 * switched alerts on (Firebase key saved in Cloudflare).
 */
export async function startPush() {
  if (started || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PushNotifications')) return;
  started = true;
  try {
    const { enabled } = await api.get<{ enabled: boolean }>('/push-config');
    if (!enabled) return;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.createChannel({ id: 'alerts', name: 'Audit alerts', description: 'Allocations, reminders and late alerts', importance: 5, visibility: 1, sound: 'default', vibration: true }).catch(() => {});
    await PushNotifications.addListener('registration', async ({ value }) => {
      try {
        localStorage.setItem(TOKEN_KEY, value);
      } catch {
        /* ignore */
      }
      await api.post('/me/devices', { token: value, platform: Capacitor.getPlatform() }).catch(() => {});
    });
    // Alert arrives while the app is open: refresh the bell
    await PushNotifications.addListener('pushNotificationReceived', () => window.dispatchEvent(new Event('tj:notify')));
    // Tapped an alert: open the screen it is about
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const link = (notification.data as { link?: string } | undefined)?.link;
      if (link && link.startsWith('/')) location.assign(link);
    });
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
    if (perm.receive === 'granted') await PushNotifications.register();
  } catch (e) {
    started = false;
    console.warn('push setup failed', e);
  }
}
