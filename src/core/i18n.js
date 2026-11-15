// Translations (PLAN.md §2A, M7). The adapter hands in its shell's gettext before any UI is
// built; until then (and in node tests) strings pass through untranslated.
let translate = s => s;

// _('in %s', t): translate, then fill each %s in order with the arguments.
function _(msgid, ...args) {
    let i = 0;
    const s = translate(msgid);
    return args.length ? s.replace(/%s/g, () => String(args[i++])) : s;
}

// Marks a string for extraction only; translate it with _() where it is shown.
const N_ = s => s;

function setGettext(fn) {
    translate = fn || (s => s);
}

module.exports = { _, N_, setGettext };
