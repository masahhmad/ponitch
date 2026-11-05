// Home tab: what is happening now (PLAN.md §4.1, §4A.5), laid out like Notchy's home grid:
//   [ now playing (full width)          ]
//   [ month ] [ prayer ] [ up next     ]
// Each card appears only when its feature is on. Pomodoro has its own tab.
const { buildPeek } = require('./music_ui');
const { iconButton } = require('./widgets');
const { monthGrid } = require('./calendar');
const { buildPrayerCard } = require('./prayer_ui');
const { buildUpNext } = require('./todo_ui');

let Clutter, St, GLib;

// ctx: { gi, music, prayer, todo (services or null), openTab, weekStart }
function buildHome(ctx) {
    ({ Clutter, St, GLib } = ctx.gi);
    const box = new St.BoxLayout({ vertical: true, style_class: 'ponitch-home', x_expand: true, y_expand: true });
    const top = new St.BoxLayout({ style_class: 'ponitch-home-row' });
    const bottom = new St.BoxLayout({ style_class: 'ponitch-home-row', y_expand: true });
    box.add_child(top);
    box.add_child(bottom);

    const audio = new St.BoxLayout({ vertical: true, style_class: 'ponitch-section ponitch-home-audio', x_expand: true });
    audio.add_child(sectionTitle('audio-x-generic-symbolic', 'Now Playing'));
    let player = null;
    const empty = new St.Label({ text: 'Nothing playing', style_class: 'ponitch-muted' });
    if (ctx.music) {
        player = buildPeek(ctx.music);
        player.actor.add_style_class_name('compact');
        audio.add_child(player.actor);
    }
    audio.add_child(empty);
    top.add_child(audio);

    bottom.add_child(buildMonth(ctx.weekStart || 0));
    if (ctx.prayer)
        bottom.add_child(buildPrayerCard(ctx));
    if (ctx.todo)
        bottom.add_child(buildUpNext(ctx));

    const update = track => {
        empty.visible = !track;
        if (player) {
            player.actor.visible = !!track;
            player.update(track);
        }
    };
    return { actor: box, update };
}

function sectionTitle(icon, text) {
    const row = new St.BoxLayout({ style_class: 'ponitch-section-title' });
    row.add_child(new St.Icon({ icon_name: icon, style_class: 'ponitch-section-icon', y_align: Clutter.ActorAlign.CENTER }));
    row.add_child(new St.Label({ text, y_align: Clutter.ActorAlign.CENTER }));
    return row;
}

// Month calendar with ‹ › paging; today is highlighted.
function buildMonth(weekStart) {
    const now = GLib.DateTime.new_now_local();
    const today = { y: now.get_year(), m: now.get_month() - 1, d: now.get_day_of_month() };
    let shown = { y: today.y, m: today.m };

    const box = new St.BoxLayout({ vertical: true, style_class: 'ponitch-section ponitch-cal' });
    const head = new St.BoxLayout({ style_class: 'ponitch-cal-head' });
    const title = new St.Label({ style_class: 'ponitch-cal-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    const prev = iconButton('go-previous-symbolic', 'round', () => page(-1));
    const next = iconButton('go-next-symbolic', 'round', () => page(1));
    [title, prev, next].forEach(a => head.add_child(a));
    const grid = new St.Widget({ layout_manager: new Clutter.GridLayout({ column_homogeneous: true }), style_class: 'ponitch-cal-grid' });
    box.add_child(head);
    box.add_child(grid);

    // Weekday initials from the locale (2026-11-01 was a Sunday).
    const initials = [...Array(7)].map((_, i) => {
        const d = GLib.DateTime.new_local(2026, 11, 1 + ((i + weekStart) % 7), 0, 0, 0);
        return d.format('%a').slice(0, 1).toUpperCase();
    });

    function render() {
        grid.destroy_all_children();
        const layout = grid.layout_manager;
        initials.forEach((t, c) => layout.attach(new St.Label({ text: t, style_class: 'ponitch-cal-dow' }), c, 0, 1, 1));
        monthGrid(shown.y, shown.m, weekStart).forEach((day, i) => {
            const cls = ['ponitch-cal-day'];
            if (!day.inMonth)
                cls.push('out');
            if (day.y === today.y && day.m === today.m && day.d === today.d)
                cls.push('today');
            // Fixed-size label centred in its (wider) cell, so "today" is a circle, not a pill.
            layout.attach(new St.Label({ text: String(day.d), style_class: cls.join(' '), x_align: Clutter.ActorAlign.CENTER }), i % 7, 1 + Math.floor(i / 7), 1, 1);
        });
        title.text = GLib.DateTime.new_local(shown.y, shown.m + 1, 1, 0, 0, 0).format('%B %Y');
    }

    function page(delta) {
        const m = shown.m + delta;
        shown = { y: shown.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
        render();
    }

    render();
    return box;
}

module.exports = { buildHome };
