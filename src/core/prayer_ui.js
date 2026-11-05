// Prayer card (Home) and Prayer tab (PLAN.md §4.6).
const { ticker } = require('./widgets');
const { countdown } = require('./activity');

let Clutter, St;

const hhmm = ms => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Hijri date in the system locale (Umm al-Qura calendar; local sighting can differ by a day).
function hijri(date = new Date()) {
    try {
        return new Intl.DateTimeFormat([], { calendar: 'islamic-umalqura', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    } catch (e) {
        return '';
    }
}

function sectionTitle(icon, text) {
    const row = new St.BoxLayout({ style_class: 'ponitch-section-title' });
    row.add_child(new St.Icon({ icon_name: icon, style_class: 'ponitch-section-icon', y_align: Clutter.ActorAlign.CENTER }));
    row.add_child(new St.Label({ text, y_align: Clutter.ActorAlign.CENTER }));
    return row;
}

// ctx: { gi, prayer, openTab }
function buildPrayerCard(ctx) {
    ({ Clutter, St } = ctx.gi);
    const box = new St.BoxLayout({ vertical: true, style_class: 'ponitch-section ponitch-card' });
    const name = new St.Label({ style_class: 'ponitch-card-big' });
    const left = new St.Label({ style_class: 'ponitch-card-sub' });
    const date = new St.Label({ style_class: 'ponitch-muted small', text: hijri() });
    [sectionTitle('daytime-sunset-symbolic', 'Prayer'), name, left, date].forEach(a => box.add_child(a));
    const btn = new St.Button({ style_class: 'ponitch-card-btn', child: box, can_focus: true });
    btn.connect('clicked', () => ctx.openTab('prayer'));
    const draw = () => {
        const next = ctx.prayer.next;
        name.text = next ? `${next.name} ${hhmm(next.at)}` : 'Loading…';
        left.text = next ? `in ${countdown(next.at, Date.now())}` : '';
    };
    const unsub = ctx.prayer.subscribe(draw);
    btn.connect('destroy', unsub);
    ticker(btn, 1000, draw);
    // A St.Button centres itself vertically in the row; a vertical box keeps the card top-aligned.
    const wrap = new St.BoxLayout({ vertical: true });
    wrap.add_child(btn);
    return wrap;
}

// ctx: { gi, prayer }
function buildPrayerTab(ctx) {
    ({ Clutter, St } = ctx.gi);
    const box = new St.BoxLayout({ vertical: true, style_class: 'ponitch-prayer', x_expand: true, y_expand: true });
    const head = new St.Label({ style_class: 'ponitch-muted' });
    const grid = new St.Widget({ layout_manager: new Clutter.GridLayout({ column_homogeneous: true, column_spacing: 18, row_spacing: 4 }), x_expand: true });
    box.add_child(head);
    box.add_child(grid);
    const draw = () => {
        const p = ctx.prayer;
        grid.destroy_all_children();
        if (!p.today) {
            head.text = 'Loading…';
            return;
        }
        const source = p.today.source === 'kemenag' ? 'Kemenag RI' : 'calculated offline';
        head.text = `${p.today.location} · ${source} · ${hijri()}`;
        const next = p.next;
        p.list.forEach((t, i) => {
            const row = new St.BoxLayout({ style_class: 'ponitch-prayer-row' + (next && t.key === next.key && t.at === next.at ? ' next' : '') + (t.prayer ? '' : ' minor') });
            row.add_child(new St.Label({ text: t.name, x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
            row.add_child(new St.Label({ text: hhmm(t.at), style_class: 'ponitch-prayer-time', y_align: Clutter.ActorAlign.CENTER }));
            grid.layout_manager.attach(row, i % 2, Math.floor(i / 2), 1, 1);
        });
    };
    const unsub = ctx.prayer.subscribe(draw);
    box.connect('destroy', unsub);
    draw();
    return { actor: box };
}

module.exports = { buildPrayerCard, buildPrayerTab, hijri };
