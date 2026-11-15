// Prayer times (PLAN.md §4.6): Kemenag's schedule from api.myquran.com for an Indonesian city
// (one request per month, cached), otherwise / as fallback the offline calculation.
const { Emitter } = require('./emitter');
const { prayerTimes } = require('./praytimes');
const { initStore, cachePath, readJson, writeJson, onResume, at } = require('./store');
const { playSound } = require('./sound');

const API = 'https://api.myquran.com/v2/sholat';
const { _, N_ } = require('./i18n');

const NAMES = { imsak: N_('Imsak'), fajr: N_('Fajr'), sunrise: N_('Sunrise'), dhuha: N_('Dhuha'), dhuhr: N_('Dhuhr'), asr: N_('Asr'), maghrib: N_('Maghrib'), isha: N_('Isha') };
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const API_KEYS = { imsak: 'imsak', fajr: 'subuh', sunrise: 'terbit', dhuha: 'dhuha', dhuhr: 'dzuhur', asr: 'ashar', maghrib: 'maghrib', isha: 'isya' };
const SOON_MS = 15 * 60 * 1000, NOW_MS = 5 * 60 * 1000;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

let Gio;

var PrayerService = class PrayerService extends Emitter {
    // cfg: { city, lat, lon, method, asr, adzanFile }
    constructor(platform, cfg) {
        super();
        ({ Gio } = platform.gi);
        initStore(platform.gi);
        this._platform = platform;
        this.cfg = cfg;
        this.today = null; // { date: 'yyyy-mm-dd', source, location, times: { key: minutes } }
        this._cancelTimer = () => {};
    }

    start() {
        this._cancel = new Gio.Cancellable();
        this._unResume = onResume(() => this.refresh());
        this.refresh();
    }

    stop() {
        this._cancel.cancel();
        this._cancelTimer();
        this._unResume();
    }

    // (Re)load today's schedule: on start, config change, midnight and resume.
    refresh() {
        const d = new Date();
        const date = ymd(d);
        const done = day => {
            if (ymd(new Date()) !== date)
                return this.refresh(); // midnight passed while loading
            this.today = day;
            this._plan();
            this._emit();
        };
        if (!this.cfg.city)
            return done(this._offline(d));
        this._kemenag(d, day => done(day || this._offline(d)));
    }

    // Epoch ms of a time key today (or another day offset).
    _at(key, dayOffset = 0) {
        const [y, m, d] = this.today.date.split('-').map(Number);
        return new Date(y, m - 1, d + dayOffset, 0, this.today.times[key]).getTime();
    }

    // { key, name, at } of the next of the five prayers (tomorrow's fajr after isha).
    get next() {
        if (!this.today)
            return null;
        const now = Date.now();
        const key = PRAYERS.find(k => this._at(k) > now);
        // shortcut: tomorrow's fajr is taken as today's + 24 h (≤1 min off); fine for a countdown.
        return key ? this._entry(key) : { ...this._entry('fajr'), at: this._at('fajr', 1) };
    }

    // The prayer whose time has begun most recently today, or null before fajr.
    get current() {
        if (!this.today)
            return null;
        const now = Date.now();
        const key = [...PRAYERS].reverse().find(k => this._at(k) <= now);
        return key ? this._entry(key) : null;
    }

    _entry(key) {
        return { key, name: _(NAMES[key]), at: this._at(key) };
    }

    // All times for display, in order.
    get list() {
        return this.today ? Object.keys(NAMES).map(k => ({ ...this._entry(k), prayer: PRAYERS.includes(k) })) : [];
    }

    _offline(d) {
        const { lat, lon, method, asr } = this.cfg;
        return {
            date: ymd(d), source: 'offline', location: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
            times: prayerTimes(d.getFullYear(), d.getMonth() + 1, d.getDate(), { lat, lon, tz: -d.getTimezoneOffset() / 60, method, asr }),
        };
    }

    // Kemenag schedule for d's month (cached per month), or cb(null) to fall back to offline.
    _kemenag(d, cb) {
        this._cityId(this.cfg.city, city => {
            if (!city)
                return cb(null);
            const yyyy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0');
            const file = cachePath(`prayer-${city.id}-${yyyy}-${mm}.json`);
            const pick = month => {
                const row = month && month.find(r => r.date === ymd(d));
                const times = row && parseRow(row);
                cb(times ? { date: ymd(d), source: 'kemenag', location: city.name, times } : null);
            };
            readJson(file, cached => {
                if (validMonth(cached))
                    return pick(cached);
                this._fetch(`${API}/jadwal/${city.id}/${yyyy}/${mm}`, json => {
                    const month = json && json.data && json.data.jadwal;
                    if (!validMonth(month))
                        return pick(null);
                    writeJson(file, month);
                    pick(month);
                });
            });
        });
    }

    // City name -> { id, name } via the API's search, remembered in a small cache file.
    _cityId(city, cb) {
        const file = cachePath('prayer-cities.json');
        const key = city.trim().toLowerCase();
        readJson(file, known => {
            known = known && typeof known === 'object' ? known : {};
            if (known[key] && /^\d+$/.test(known[key].id))
                return cb(known[key]);
            this._fetch(`${API}/kota/cari/${encodeURIComponent(key)}`, json => {
                const hits = (json && Array.isArray(json.data) ? json.data : [])
                    .filter(h => h && /^\d+$/.test(h.id) && typeof h.lokasi === 'string');
                // Prefer the city ("KOTA X") over the regency ("KAB. X") of the same name.
                const hit = hits.find(h => h.lokasi.toLowerCase() === `kota ${key}`) || hits[0];
                if (!hit)
                    return cb(null);
                known[key] = { id: hit.id, name: hit.lokasi };
                writeJson(file, known);
                cb(known[key]);
            });
        });
    }

    // GET + JSON.parse through GVfs (no extra HTTP library). cb(null) on any failure.
    _fetch(url, cb) {
        Gio.File.new_for_uri(url).load_contents_async(this._cancel, (f, res) => {
            try {
                const [, bytes] = f.load_contents_finish(res);
                cb(JSON.parse(new TextDecoder().decode(bytes)));
            } catch (e) {
                if (!e.matches || !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`ponitch: prayer schedule unavailable, using offline times: ${e.message}`);
                cb(null);
            }
        });
    }

    // Wake up at the next moment the notch should change: 15 min before a prayer, at it,
    // 5 min after it, and at midnight for the next day's schedule.
    _plan() {
        this._cancelTimer();
        const now = Date.now();
        const points = []; // [ms, isPrayerStart]
        for (const k of PRAYERS) {
            const t = this._at(k);
            points.push([t - SOON_MS, false], [t, true], [t + NOW_MS, false]);
        }
        const midnight = new Date();
        midnight.setHours(24, 0, 5, 0);
        points.push([midnight.getTime(), false]);
        const [when, isStart] = points.filter(([p]) => p > now).sort((a, b) => a[0] - b[0])[0];
        this._cancelTimer = at(when, () => {
            if (ymd(new Date()) !== this.today.date)
                return this.refresh();
            if (isStart)
                this._adzan();
            this._plan();
            this._emit();
        });
    }

    _adzan() {
        if (this.cfg.adzanFile && !this._platform.dnd.get())
            playSound(this._platform.gi, this.cfg.adzanFile);
    }
};

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Untrusted network data: every time must be HH:MM.
function parseRow(row) {
    const times = {};
    for (const [key, apiKey] of Object.entries(API_KEYS)) {
        const m = typeof row[apiKey] === 'string' && row[apiKey].match(HHMM);
        if (!m)
            return null;
        times[key] = Number(m[1]) * 60 + Number(m[2]);
    }
    return times;
}

const validMonth = m => Array.isArray(m) && m.length >= 28 && m.every(r => r && typeof r.date === 'string' && parseRow(r));

module.exports = { PrayerService };
