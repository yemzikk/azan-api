import {
  PRAYERS, addDays, getDateKey, getDay, prayerTimestamp, humanizeLocation,
  getStored as readStored, setStored as writeStored, formatTime,
} from './prayer-data.js';

const ENABLED_KEY = 'azan-reminders';
const PRAYERS_KEY = 'azan-reminder-prayers';
const DELIVERED_KEY = 'azan-notification-deliveries-v1';
const PRAYER_KEYS = PRAYERS.filter(({ kind }) => kind === 'prayer').map(({ key }) => key);
const LATE_ALLOWANCE = 60_000;
const RETRY_DELAY = 10_000;

function bounded(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

/** Foreground reminders: permission, browser delivery, deduplication and diagnostics. */
export class PrayerNotifications {
  constructor({
    notification = globalThis.Notification,
    navigator = globalThis.navigator,
    secureContext = globalThis.isSecureContext !== false,
    standalone = Boolean(globalThis.navigator?.standalone
      || globalThis.matchMedia?.('(display-mode: standalone)').matches),
    getStored = readStored, setStored = writeStored,
    now = () => Date.now(),
    onStatus = () => {}, onAlert = () => {},
    registrationTimeoutMs = 3000, deliveryTimeoutMs = 5000,
  } = {}) {
    this.notification = notification;
    this.navigator = navigator;
    this.secureContext = secureContext;
    this.standalone = standalone;
    this.read = getStored;
    this.write = setStored;
    this.now = now;
    this.onStatus = onStatus;
    this.onAlert = onAlert;
    this.registrationTimeoutMs = registrationTimeoutMs;
    this.deliveryTimeoutMs = deliveryTimeoutMs;
    const legacy = this.read('prayer-notification-settings', null);
    const savedEnabled = this.read(ENABLED_KEY, null);
    this.enabled = savedEnabled === null ? legacy?.enabled === true : savedEnabled === true;
    if (savedEnabled === null && typeof legacy?.enabled === 'boolean') this.write(ENABLED_KEY, this.enabled);
    const legacyPrayers = legacy?.prayers ? {
      subh: legacy.prayers.fajr, duhr: legacy.prayers.dhuhr, asar: legacy.prayers.asr,
      maghrib: legacy.prayers.maghrib, isha: legacy.prayers.isha,
    } : {};
    const preferences = this.read(PRAYERS_KEY, null) ?? legacyPrayers;
    this.prayers = Object.fromEntries(PRAYER_KEYS.map((key) => [key, preferences?.[key] !== false]));
    this.deliveries = new Map();
    this.attempts = new Map();
    this.fallbacks = new Set();
    this.lastError = null;
    this.errorCode = null;
    this.checking = null;
    this.appURL = new URL('../', import.meta.url);
    this.owner = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  }

  get ios() {
    const navigator = this.navigator;
    return /iPhone|iPad|iPod/i.test(navigator?.userAgent || '')
      || (navigator?.platform === 'MacIntel' && navigator?.maxTouchPoints > 1);
  }

  get mobile() { return this.ios || /Android/i.test(this.navigator?.userAgent || ''); }

  status() {
    const permission = this.notification?.permission || 'unsupported';
    let supported = true;
    let reasonCode;
    let reason;
    if (!this.secureContext) {
      supported = false; reasonCode = 'https-required';
      reason = 'Open AzanTimes over HTTPS to enable notifications.';
    } else if (this.ios && !this.standalone) {
      supported = false; reasonCode = 'install-required';
      reason = 'On iPhone or iPad, use Share → Add to Home Screen, open AzanTimes from that icon, then enable reminders.';
    } else if (!this.notification || (this.mobile && !this.navigator?.serviceWorker)) {
      supported = false; reasonCode = 'unsupported';
      reason = 'This browser cannot show system notifications. Try a browser with notification support.';
    } else if (permission === 'denied') {
      reasonCode = 'blocked';
      reason = 'Notifications are blocked. Allow notifications for this site in browser settings, then enable reminders again.';
    } else if (this.lastError) {
      reasonCode = this.errorCode || 'delivery-failed';
      reason = this.lastError;
    } else if (this.enabled && permission === 'granted') {
      reasonCode = 'enabled';
      reason = 'Prayer reminders are on while this page is open. Send a test to check browser and device notification settings.';
    } else {
      reasonCode = 'disabled'; reason = 'Prayer reminders are off.';
    }
    return {
      supported, permission, enabled: supported && this.enabled && permission === 'granted',
      reason, reasonCode, error: this.lastError, prayers: { ...this.prayers },
    };
  }

  emitStatus() {
    const status = this.status();
    try { this.onStatus(status); } catch (_) { /* UI callbacks cannot prevent reminders. */ }
    return status;
  }

  async enable() {
    this.lastError = null; this.errorCode = null;
    const current = this.status();
    if (!current.supported || current.permission === 'denied') {
      this.enabled = false; this.write(ENABLED_KEY, false);
      return this.emitStatus();
    }
    try {
      // This call happens before any await, preserving the enabling tap's gesture.
      const permission = current.permission === 'granted'
        ? 'granted' : await this.notification.requestPermission();
      this.enabled = permission === 'granted';
      if (!this.enabled && permission !== 'denied') {
        this.lastError = 'Notification permission was not granted. Enable reminders again and choose Allow.';
        this.errorCode = 'permission-not-granted';
      }
    } catch (_) {
      this.enabled = false;
      this.lastError = 'The browser could not request notification permission. Check this site’s notification settings.';
      this.errorCode = 'permission-request-failed';
    }
    this.write(ENABLED_KEY, this.enabled);
    return this.emitStatus();
  }

  disable() {
    this.enabled = false; this.lastError = null; this.errorCode = null;
    this.write(ENABLED_KEY, false);
    return this.emitStatus();
  }

  configure({ prayers = {} } = {}) {
    for (const key of PRAYER_KEYS) if (typeof prayers[key] === 'boolean') this.prayers[key] = prayers[key];
    this.write(PRAYERS_KEY, this.prayers);
    return this.emitStatus();
  }

  async registration() {
    const workers = this.navigator?.serviceWorker;
    if (!workers) return null;
    const deadline = Date.now() + this.registrationTimeoutMs;
    const wait = (promise) => bounded(promise, Math.max(1, deadline - Date.now()), 'The notification service is not ready. Reload AzanTimes and try again.');
    let registration;
    if (workers.getRegistration) {
      try { registration = await wait(workers.getRegistration(this.appURL.href)); } catch (_) { /* A worker may still be activating. */ }
    }
    if (registration?.showNotification && (!('active' in registration) || registration.active)) return registration;
    if (workers.ready) {
      try {
        registration = await wait(workers.ready);
        if (registration?.showNotification) return registration;
      } catch (_) { /* Desktop browsers can use their constructor below. */ }
    }
    return null;
  }

  async deliver(title, options) {
    const registration = await this.registration();
    if (registration) {
      await bounded(registration.showNotification(title, options), this.deliveryTimeoutMs,
        'The browser did not confirm the notification. Check site and device notification settings, then send a test.');
      return 'service-worker';
    }
    if (this.mobile) throw new Error('The mobile notification service is not ready. Reload AzanTimes, wait a moment, then send a test.');
    // Constructors are a desktop fallback; Android and iOS require showNotification.
    const notification = new this.notification(title, options);
    if (notification.addEventListener) {
      // Constructor errors can arrive asynchronously, after permission succeeds.
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          notification.removeEventListener?.('show', shown);
          notification.removeEventListener?.('error', failed);
        };
        const shown = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('The browser could not display the notification. Check device notification settings.')); };
        const timer = setTimeout(shown, Math.min(1500, this.deliveryTimeoutMs));
        notification.addEventListener('show', shown, { once: true });
        notification.addEventListener('error', failed, { once: true });
      });
    }
    return 'desktop';
  }

  async sendTest() {
    if (this.notification?.permission !== 'granted') await this.enable();
    const status = this.status();
    if (!status.supported || status.permission !== 'granted') return { delivered: false, error: status.reason, status };
    try {
      const method = await this.deliver('AzanTimes · Test reminder', {
        body: 'Prayer reminders are ready while AzanTimes stays open.',
        tag: 'azantimes-test',
        icon: new URL('favicon/android-chrome-192x192.png', this.appURL).href,
        data: { url: this.appURL.href },
      });
      this.lastError = null; this.errorCode = null;
      return { delivered: true, method, status: this.emitStatus(),
        message: 'Test sent to your browser. If it does not appear, allow browser notifications in device settings and check Do Not Disturb.' };
    } catch (error) {
      this.lastError = `Test notification failed. ${error.message || 'Check this site’s notification settings and try again.'}`;
      this.errorCode = 'delivery-failed';
      return { delivered: false, error: this.lastError, status: this.emitStatus() };
    }
  }

  records() {
    const records = this.read(DELIVERED_KEY, {});
    return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
  }

  delivered(id) { return this.deliveries.has(id) || Boolean(this.records()[id]); }

  markDelivered(id, timestamp) {
    this.deliveries.set(id, timestamp);
    const records = { ...this.records(), [id]: timestamp };
    const recent = Object.entries(records).filter(([, time]) => Number.isFinite(time) && timestamp - time < 7 * 86400_000)
      .sort((a, b) => b[1] - a[1]).slice(0, 500);
    this.write(DELIVERED_KEY, Object.fromEntries(recent));
  }

  async exclusively(id, callback) {
    if (this.navigator?.locks?.request) {
      try {
        return await this.navigator.locks.request(`azan-prayer:${id}`, { ifAvailable: true }, (lock) => lock ? callback() : null);
      } catch (_) { /* Sandboxed lock access can fail; use a short localStorage lease. */ }
    }
    const key = `azan-notification-lease:${id}`;
    const current = this.read(key, null);
    const now = this.now();
    if (current?.expires > now && current.owner !== this.owner) return null;
    const stored = this.write(key, { owner: this.owner, expires: now + 15_000 });
    if (stored) {
      // Yield once so simultaneous tabs can observe the winning owner.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (this.read(key, null)?.owner !== this.owner) return null;
    }
    try { return await callback(); }
    finally { if (this.read(key, null)?.owner === this.owner) this.write(key, null); }
  }

  async check({ schedule, location, now = this.now(), use24Hour = false } = {}) {
    if (this.checking) return this.checking;
    this.checking = this.checkNow({ schedule, location, now, use24Hour }).finally(() => { this.checking = null; });
    return this.checking;
  }

  async checkNow({ schedule, location, now, use24Hour }) {
    const status = this.status();
    if (!status.enabled || !schedule) return [];
    const timestamp = new Date(now).getTime();
    const today = getDateKey(timestamp);
    if (!today || !Number.isFinite(timestamp)) return [];
    const locationId = location?.id || schedule.locationId;
    if (!locationId) return [];
    const locationName = location?.label || humanizeLocation(locationId);
    const results = [];
    // Include yesterday only to cover a prayer in the minute before midnight.
    for (const date of [addDays(today, -1), today]) {
      const day = getDay(schedule, date);
      if (!day) continue;
      for (const prayer of PRAYERS) {
        if (prayer.kind !== 'prayer' || !this.prayers[prayer.key]) continue;
        const at = prayerTimestamp(date, day[prayer.key]);
        if (at === null || at > timestamp || timestamp - at > LATE_ALLOWANCE) continue;
        const id = `${locationId}|${date}|${prayer.key}`;
        if (this.delivered(id) || timestamp - (this.attempts.get(id) ?? -Infinity) < RETRY_DELAY) continue;
        const result = await this.exclusively(id, async () => {
          if (this.delivered(id)) return null;
          this.attempts.set(id, timestamp);
          const time = formatTime(day[prayer.key], use24Hour);
          const title = `Time for ${prayer.label}`;
          const body = `${time} · ${locationName}`;
          let delivery;
          try {
            const method = await this.deliver(title, {
              body, tag: `azan-${id}`, renotify: false,
              icon: new URL('favicon/android-chrome-192x192.png', this.appURL).href,
              data: { url: `${this.appURL.href}?q=${encodeURIComponent(locationId)}`, prayer: prayer.key, date },
            });
            // Failed delivery must remain eligible for a retry during this minute.
            this.markDelivered(id, timestamp);
            this.lastError = null; this.errorCode = null;
            delivery = { delivered: true, method };
          } catch (error) {
            this.lastError = `Prayer notification failed. ${error.message || 'Check site and device notification settings.'}`;
            this.errorCode = 'delivery-failed';
            delivery = { delivered: false, error: this.lastError };
          }
          const alert = {
            ...delivery, id, prayer: prayer.key, prayerLabel: prayer.label, time,
            date, locationId, locationLabel: locationName, title, body, message: body,
          };
          // An in-page alert remains visible even when system delivery fails.
          if (delivery.delivered || !this.fallbacks.has(id)) {
            this.fallbacks.add(id);
            try { this.onAlert(alert); } catch (_) { /* UI callbacks are optional. */ }
          }
          this.emitStatus();
          return alert;
        });
        if (result) results.push(result);
      }
    }
    return results;
  }
}
