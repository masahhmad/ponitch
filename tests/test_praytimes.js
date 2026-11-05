// node tests/test_praytimes.js: offline calculation vs Kemenag's published schedule (via
// api.myquran.com), two cities in different time zones. PLAN.md §4.6 tolerance: ±2 minutes.
const assert = require('assert');
const { prayerTimes, METHODS } = require('../src/core/praytimes.js');

const KEYS = { imsak: 'imsak', subuh: 'fajr', terbit: 'sunrise', dhuha: 'dhuha', dzuhur: 'dhuhr', ashar: 'asr', maghrib: 'maghrib', isya: 'isha' };
const CASES = [
    ['surabaya-2026-11.json', -7.2575, 112.7521, 7],
    ['jayapura-2026-06.json', -2.5337, 140.7181, 9],
];

for (const [file, lat, lon, tz] of CASES) {
    for (const day of require(`./fixtures/${file}`).data.jadwal) {
        const [y, m, d] = day.date.split('-').map(Number);
        const t = prayerTimes(y, m, d, { lat, lon, tz, method: 'kemenag' });
        for (const [api, ours] of Object.entries(KEYS)) {
            const [hh, mm] = day[api].split(':').map(Number);
            const diff = t[ours] - (hh * 60 + mm);
            assert(Math.abs(diff) <= 2, `${file} ${day.date} ${api}: off by ${diff} min`);
        }
    }
}

// Times are in order for every method, including high latitude in summer (London, June).
for (const method of Object.keys(METHODS)) {
    for (const [lat, lon, tz] of [[-7.2575, 112.7521, 7], [21.4225, 39.8262, 3], [51.5074, -0.1278, 1]]) {
        const t = prayerTimes(2026, 6, 21, { lat, lon, tz, method });
        const order = ['imsak', 'fajr', 'sunrise', 'dhuha', 'dhuhr', 'asr', 'maghrib', 'isha'];
        order.slice(1).forEach((k, i) => assert(t[k] > t[order[i]], `${method} ${lat}: ${order[i]} !< ${k}`));
        assert(t.isha < 24 * 60 + 120, `${method} ${lat}: isha out of range`);
    }
}

// Hanafi asr is later than Shafi'i.
const shafii = prayerTimes(2026, 11, 1, { lat: -7.2575, lon: 112.7521, tz: 7, method: 'kemenag' });
const hanafi = prayerTimes(2026, 11, 1, { lat: -7.2575, lon: 112.7521, tz: 7, method: 'kemenag', asr: 'hanafi' });
assert(hanafi.asr > shafii.asr + 30);

console.log('test_praytimes: ok');
