// node tests/test_calendar.js
const assert = require('assert');
const { monthGrid } = require('../src/core/calendar.js');

// November 2026 starts on a Sunday.
let g = monthGrid(2026, 10, 0);
assert.strictEqual(g.length, 42);
assert.deepStrictEqual(g[0], { y: 2026, m: 10, d: 1, inMonth: true });
assert.deepStrictEqual(g[29], { y: 2026, m: 10, d: 30, inMonth: true });
assert.deepStrictEqual(g[30], { y: 2026, m: 11, d: 1, inMonth: false });

// Monday-first: the grid starts on Monday 26 October.
g = monthGrid(2026, 10, 1);
assert.deepStrictEqual(g[0], { y: 2026, m: 9, d: 26, inMonth: false });
assert.deepStrictEqual(g[6], { y: 2026, m: 10, d: 1, inMonth: true });

// Year boundary and leap February.
g = monthGrid(2024, 1, 0); // Feb 2024 starts on Thursday
assert.deepStrictEqual(g[4], { y: 2024, m: 1, d: 1, inMonth: true });
assert.strictEqual(g.filter(x => x.inMonth).length, 29);
g = monthGrid(2027, 0, 0); // Jan 2027 starts on Friday; leading days are Dec 2026
assert.deepStrictEqual(g[0], { y: 2026, m: 11, d: 27, inMonth: false });

// Every grid starts on the requested weekday.
for (let m = 0; m < 12; m++)
    for (const ws of [0, 1])
        assert.strictEqual(new Date(...[monthGrid(2026, m, ws)[0]].map(x => [x.y, x.m, x.d])[0]).getDay(), ws);

console.log('test_calendar: ok');
