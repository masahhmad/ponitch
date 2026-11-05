// Pomodoro tab: countdown + controls on the left, durations on the right (PLAN.md §4.10).
const { iconButton, centered, ticker } = require('./widgets');
const { countdown } = require('./activity');

let Clutter, St;

// [key, label, unit, step]; the service clamps to its limits.
const SETTINGS = [
    ['focus', 'Focus', 'min', 5],
    ['short', 'Short break', 'min', 1],
    ['long', 'Long break', 'min', 5],
    ['cycles', 'Long break every', 'sessions', 1],
];

// ctx: { gi, pomodoro }
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
    [phase, time, round, controls].forEach(a => timer.add_child(a));

    const settings = new St.BoxLayout({ vertical: true, style_class: 'ponitch-pomo-settings', y_align: Clutter.ActorAlign.CENTER });
    const values = {};
    for (const [key, name, unit, step] of SETTINGS) {
        const row = new St.BoxLayout({ style_class: 'ponitch-stepper' });
        row.add_child(new St.Label({ text: name, style_class: 'ponitch-stepper-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        row.add_child(centered(iconButton('list-remove-symbolic', 'small', () => pomo.setConfig(key, pomo.config[key] - step))));
        values[key] = new St.Label({ style_class: 'ponitch-stepper-value', y_align: Clutter.ActorAlign.CENTER });
        row.add_child(values[key]);
        row.add_child(centered(iconButton('list-add-symbolic', 'small', () => pomo.setConfig(key, pomo.config[key] + step))));
        row.add_child(new St.Label({ text: unit, style_class: 'ponitch-stepper-unit', y_align: Clutter.ActorAlign.CENTER }));
        settings.add_child(row);
    }

    box.add_child(timer);
    box.add_child(settings);

    const draw = () => {
        const v = pomo.view;
        phase.text = v.label;
        time.text = countdown(Date.now() + v.remaining, Date.now());
        round.text = `Session ${v.phase === 'focus' ? v.round + 1 : v.round} · long break every ${v.config.cycles}`;
        toggle.setIcon(v.running ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic');
        for (const [key] of SETTINGS)
            values[key].text = String(v.config[key]);
    };
    const unsub = pomo.subscribe(draw);
    box.connect('destroy', unsub);
    ticker(box, 1000, draw);
    return { actor: box };
}

module.exports = { buildPomodoroTab };
