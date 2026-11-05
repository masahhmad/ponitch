// Offline prayer times (PLAN.md §4.6). Pure JS so node can test it against Kemenag's published
// schedule (tests/test_praytimes.js). Low-precision sun position, good to well under a minute.

// fajr/isha: sun depression in degrees; ishaMinutes: fixed time after maghrib instead of an angle;
// ihtiyath: safety minutes Kemenag adds to every time except sunrise (which it moves earlier).
const METHODS = {
    kemenag: { fajr: 20, isha: 18, ihtiyath: 2 },
    mwl: { fajr: 18, isha: 17 },
    isna: { fajr: 15, isha: 15 },
    egypt: { fajr: 19.5, isha: 17.5 },
    'umm-al-qura': { fajr: 18.5, ishaMinutes: 90 },
    karachi: { fajr: 18, isha: 18 },
    jakim: { fajr: 20, isha: 18 },
    muis: { fajr: 20, isha: 18 },
};

const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
const fix = (a, b) => ((a % b) + b) % b;

// Sun declination (deg) and equation of time (hours) for a Julian day.
function sun(jd) {
    const d = jd - 2451545.0;
    const g = fix(357.529 + 0.98560028 * d, 360);
    const q = fix(280.459 + 0.98564736 * d, 360);
    const L = fix(q + 1.915 * Math.sin(rad(g)) + 0.020 * Math.sin(rad(2 * g)), 360);
    const e = 23.439 - 0.00000036 * d;
    const ra = fix(deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(L)), Math.cos(rad(L)))) / 15, 24);
    return { decl: deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(L)))), eqt: q / 15 - ra };
}

function julian(y, m, d) {
    if (m <= 2) {
        y -= 1;
        m += 12;
    }
    const a = Math.floor(y / 100);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + 2 - a + Math.floor(a / 4) - 1524.5;
}

// Hours from solar noon until the sun is `angle` degrees below the horizon.
function hourAngle(angle, decl, lat) {
    const v = (-Math.sin(rad(angle)) - Math.sin(rad(decl)) * Math.sin(rad(lat))) / (Math.cos(rad(decl)) * Math.cos(rad(lat)));
    return deg(Math.acos(Math.max(-1, Math.min(1, v)))) / 15;
}

// Prayer times for a date as minutes after local midnight.
// opts: { lat, lon, tz (hours, e.g. 7), method (key of METHODS), asr: 'shafii' | 'hanafi' }
function prayerTimes(y, m, d, opts) {
    const method = METHODS[opts.method] || METHODS.kemenag;
    const jd = julian(y, m, d) - opts.lon / 360; // around local noon
    const { decl, eqt } = sun(jd + 0.5);
    const noon = 12 + opts.tz - opts.lon / 15 - eqt;
    const shadow = opts.asr === 'hanafi' ? 2 : 1;
    const asrAlt = -deg(Math.atan(1 / (shadow + Math.tan(rad(Math.abs(opts.lat - decl))))));
    const sunrise = noon - hourAngle(0.8333, decl, opts.lat);
    const sunset = noon + hourAngle(0.8333, decl, opts.lat);
    const h = {
        fajr: noon - hourAngle(method.fajr, decl, opts.lat),
        sunrise,
        dhuha: noon - hourAngle(-4.5, decl, opts.lat), // sun 4.5° above the horizon
        dhuhr: noon,
        asr: noon + hourAngle(asrAlt, decl, opts.lat),
        maghrib: sunset,
        isha: method.ishaMinutes ? sunset + method.ishaMinutes / 60 : noon + hourAngle(method.isha, decl, opts.lat),
    };
    const ih = method.ihtiyath || 0;
    const out = {};
    // Round toward caution, as published schedules do: prayers up, sunrise (end of fajr) down.
    for (const [k, hours] of Object.entries(h))
        out[k] = k === 'sunrise' ? Math.floor(hours * 60) - ih : Math.ceil(hours * 60) + ih;
    out.imsak = out.fajr - 10;
    return out;
}

module.exports = { prayerTimes, METHODS };
