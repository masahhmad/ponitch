// Quick-add syntax for todos (PLAN.md §4.5). Pure JS so node can test it.
//   "Kirim laporan @15:30"      today 15:30
//   "besok Rapat" / "tomorrow"  tomorrow 09:00 (or @time if given)
//   "Beli kopi"                 no due time
// Returns { title, due } with due as epoch ms or null.
const TOMORROW = /(^|\s)(besok|tomorrow)(?=\s|$)/i;
const AT = /(^|\s)@?([01]?\d|2[0-3])[:.]([0-5]\d)(?=\s|$)/;

function parseTodo(text, now = new Date()) {
    let title = text.trim();
    let tomorrow = false, hh = null, mm = null;
    if (TOMORROW.test(title)) {
        tomorrow = true;
        title = title.replace(TOMORROW, ' ');
    }
    const at = title.match(AT);
    if (at) {
        hh = Number(at[2]);
        mm = Number(at[3]);
        title = title.replace(AT, ' ');
    }
    title = title.replace(/\s+/g, ' ').trim();
    if (!tomorrow && hh === null)
        return { title, due: null };
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (tomorrow ? 1 : 0), hh === null ? 9 : hh, mm || 0);
    return { title: title || text.trim(), due: due.getTime() };
}

module.exports = { parseTodo };
