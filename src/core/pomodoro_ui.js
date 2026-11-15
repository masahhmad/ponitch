// Pomodoro tab: countdown + controls on the left, durations on the right (PLAN.md §4.10).
const { iconButton, centered, ticker } = require('./widgets');
const { countdown } = require('./activity');
const { _, N_ } = require('./i18n');

let Clutter, St;

// [key, label, unit, step]; the service clamps to its limits.
const SETTINGS = [
    ['focus', N_('Focus'), N_('min'), 5],
    ['short', N_('Short break'), N_('min'), 1],
    ['long', N_('Long break'), N_('min'), 5],
    ['cycles', N_('Long break every'), N_('sessions'), 1],
];

const EXPAND_ICON = on => (on ? 'view-restore-symbolic' : 'view-fullscreen-symbolic');

// ctx: { gi, pomodoro, expanded(): bool, toggleExpanded() }
function buildPomodoroTab(ctx) {
    ({ Clutter, St } = ctx.gi);
    const pomo = ctx.pomodoro;
    const box = new St.BoxLayout({ style_class: 'ponitch-pomodoro', x_expand: true, y_expand: true });

    const timer = new St.BoxLayout({ vertical: true, style_class: 'ponitch-pomo-timer', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    const phase = new St.Label({ style_class: 'ponitch-pomo-phase', x_align: Clutter.ActorAlign.CENTER });
    const time = new St.Label({ style_class: 'ponitch-pomo-big', x_align: Clutter.ActorAlign.CENTER });
    const round = new St.Label({ style_class: 'ponitch-muted', x_align: Clutter.ActorAlign.CENTER });
    const controls = new St.BoxLayout({ style_class: 'ponitch-controls', x_align: Clutter.ActorAlign.CENTER });
    const toggle = iconButton('media-playback-start-symbolic', 'prominent large', () => pomo.toggle());
    controls.add_child(centered(iconButton('view-refresh-symbolic', 'small', () => pomo.reset())));
    controls.add_child(centered(toggle));
    controls.add_child(centered(iconButton('media-skip-forward-symbolic', 'small', () => pomo.skip())));
    const expand = iconButton(EXPAND_ICON(ctx.expanded()), 'small', () => ctx.toggleExpanded());
    controls.add_child(centered(expand));
    [phase, time, round, controls].forEach(a => timer.add_child(a));

    const settings = new St.BoxLayout({ vertical: true, style_class: 'ponitch-pomo-settings', y_align: Clutter.ActorAlign.CENTER });
    const values = {};
    for (const [key, name, unit, step] of SETTINGS) {
        const row = new St.BoxLayout({ style_class: 'ponitch-stepper' });
        row.add_child(new St.Label({ text: _(name), style_class: 'ponitch-stepper-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        row.add_child(centered(iconButton('list-remove-symbolic', 'small', () => pomo.setConfig(key, pomo.config[key] - step))));
        values[key] = new St.Label({ style_class: 'ponitch-stepper-value', y_align: Clutter.ActorAlign.CENTER });
        row.add_child(values[key]);
        row.add_child(centered(iconButton('list-add-symbolic', 'small', () => pomo.setConfig(key, pomo.config[key] + step))));
        row.add_child(new St.Label({ text: _(unit), style_class: 'ponitch-stepper-unit', y_align: Clutter.ActorAlign.CENTER }));
        settings.add_child(row);
    }

    box.add_child(timer);
    box.add_child(settings);

    const draw = () => {
        const v = pomo.view;
        phase.text = v.label;
        time.text = countdown(Date.now() + v.remaining, Date.now());
        round.text = _('Session %s · long break every %s', v.phase === 'focus' ? v.round + 1 : v.round, v.config.cycles);
        toggle.setIcon(v.running ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic');
        expand.setIcon(EXPAND_ICON(ctx.expanded()));
        for (const [key] of SETTINGS)
            values[key].text = String(v.config[key]);
    };
    const unsub = pomo.subscribe(draw);
    box.connect('destroy', unsub);
    ticker(box, 1000, draw);
    return { actor: box };
}

// Expanded pomodoro: a black layer over the whole monitor (like a browser's F11) with the
// countdown centred. Font size is half the monitor height, smaller if the text would not fit.
// ctx: { gi, pomodoro }; layout(mon, scale) places it on the monitor (physical px).
function buildPomodoroFocus(ctx) {
    ({ Clutter, St } = ctx.gi);
    const actor = new St.Widget({ style_class: 'ponitch-focus', reactive: true, layout_manager: new Clutter.BinLayout() });
    const time = new St.Label({ style_class: 'ponitch-focus-time', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
    actor.add_child(time);
    let geom = null, chars = 0;
    const fit = () => {
        if (!geom || time.text.length === chars)
            return;
        chars = time.text.length;
        // Bold tabular digits are ~0.6em wide; keep 5% margin on each side. St scales font px by the UI scale.
        const px = Math.min(geom.h * 0.5, (geom.w * 0.9) / (chars * 0.6)) / geom.scale;
        time.set_style(`font-size: ${Math.floor(px)}px;`);
        time.ensure_style();
        // Centre the glyphs, not the line box (which has room for descenders below the digits).
        const [ink, logical] = time.clutter_text.get_layout().get_pixel_extents();
        time.translation_x = Math.round(logical.x + logical.width / 2 - (ink.x + ink.width / 2));
        time.translation_y = Math.round(logical.y + logical.height / 2 - (ink.y + ink.height / 2));
    };
    ticker(actor, 1000, () => {
        const v = ctx.pomodoro.view;
        time.text = countdown(Date.now() + v.remaining, Date.now());
        fit();
    });
    const layout = (mon, scale) => {
        actor.set_position(mon.x, mon.y);
        actor.set_size(mon.width, mon.height);
        geom = { w: mon.width, h: mon.height, scale };
        chars = 0;
        fit();
    };
    return { actor, layout };
}

module.exports = { buildPomodoroTab, buildPomodoroFocus, EXPAND_ICON };
