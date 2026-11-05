// node tests/test_spring.js — checks the spring against curves measured on notchy.dev (PLAN.md §4A.1).
const assert = require('assert');
const { Spring } = require('../src/core/spring.js');

function run(from, to, ms) {
    const s = new Spring(from);
    s.setTarget(to);
    const samples = [];
    let t = 0, overshoot = 0;
    while (t < ms) {
        s.step(1 / 60);
        t += 1000 / 60;
        samples.push([t, s.value]);
        overshoot = Math.max(overshoot, (s.value - to) * Math.sign(to - from));
    }
    return { s, samples, overshoot };
}

// Last frame at or before `ms` (60 fps frames are 16.7 ms apart).
const progressAt = (samples, from, to, ms) =>
    (samples.filter(([t]) => t <= ms).pop()[1] - from) / (to - from);

// Pill 290 -> panel 680: measured ~79% at 165 ms with ~30 ms of browser render latency, so ~135 ms of spring time.
let r = run(290, 680, 1000);
assert(Math.abs(progressAt(r.samples, 290, 680, 135) - 0.80) < 0.05, 'progress at 135 ms');
assert(progressAt(r.samples, 290, 680, 200) > 0.9, '>90% by 200 ms');
assert(r.overshoot < 1, `overshoot < 1px, got ${r.overshoot}`);
const settled = r.samples.find(([, v]) => Math.abs(v - 680) < 0.4)[0];
assert(settled < 420, `settles by 420 ms, got ${settled}`);
assert(r.s.isAtRest() && r.s.step(1 / 60) === false, 'stops producing frames at rest');

// Shrinking works the same way.
r = run(336, 38, 1000);
assert(r.overshoot < 1 && r.s.value === 38, 'shrink lands exactly');

// Retarget mid-flight keeps velocity: no jump in value.
const s = new Spring(150);
s.setTarget(620);
for (let i = 0; i < 6; i++) s.step(1 / 60);
const before = s.value;
s.setTarget(150);
assert.strictEqual(s.value, before, 'retarget does not jump');
s.step(1 / 60);
assert(s.value > before, 'retarget keeps outward velocity for a moment');

console.log('test_spring: ok');
