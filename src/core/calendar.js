// Month grid for the Home tab. Pure JS so node can test it.

// 42 days (6 weeks) covering the month of `year`/`month` (0-based), starting on `weekStart`
// (0 = Sunday, 1 = Monday). Each day: { y, m, d, inMonth }.
function monthGrid(year, month, weekStart = 0) {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() - weekStart + 7) % 7;
    const days = [];
    for (let i = 0; i < 42; i++) {
        const date = new Date(year, month, 1 - offset + i);
        days.push({ y: date.getFullYear(), m: date.getMonth(), d: date.getDate(), inMonth: date.getMonth() === month });
    }
    return days;
}

module.exports = { monthGrid };
