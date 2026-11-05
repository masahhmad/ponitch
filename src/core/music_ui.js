// Music views (PLAN.md §4.2, §4A.4). Each builder returns { actor, update(track) }.
const { rgba } = require('./color');
const { iconButton, centered } = require('./widgets');

const EQ_HEIGHTS = [0.8, 1, 0.88, 0.95, 0.76];
const EQ_MAX = 11;
const EQ_STEP_MS = 250;
const EQ_STEPS = 6;
const TICK_MS = 500;

let Clutter, St, GLib;

function initMusicUI(gi) {
    ({ Clutter, St, GLib } = gi);
}

function cover(styleClass) {
    const w = new St.Widget({ style_class: `ponitch-cover ${styleClass}`, y_align: Clutter.ActorAlign.CENTER });
    w.update = track => {
        // Escape quotes so a cache path can't break out of the CSS url().
        w.set_style(track && track.artPath
            ? `background-image: url("${track.artPath.replace(/["\\]/g, '\\$&')}");`
            : null); // null, not '': St can't parse an empty inline style
        w.set_style_pseudo_class(track && track.artPath ? '' : 'empty');
    };
    return w;
}

const playIcon = track => (track && track.status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic');

// Five little bars. Animated as a few discrete steps per second, not a 60 fps ease: every frame
// repaints the whole stage on X11, and a smooth loop measured ~21% of a core (PLAN.md §4.2).
// Steps also avoid ease(), which keeps fullscreen unredirect off while it runs.
function equalizer(animate) {
    const box = new St.BoxLayout({ style_class: 'ponitch-eq', y_align: Clutter.ActorAlign.CENTER });
    const bars = EQ_HEIGHTS.map(h => {
        const bar = new St.Widget({ style_class: 'ponitch-eq-bar', y_align: Clutter.ActorAlign.END });
        bar.set_pivot_point(0.5, 1);
        bar.full = h;
        box.add_child(bar);
        return bar;
    });
    let playing = false, accent = null, step = 0, timer = 0;
    const stop = () => {
        if (timer)
            GLib.source_remove(timer);
        timer = 0;
    };
    const tick = () => {
        step++;
        // Each bar walks its own phase of a triangle wave between 0.3 and 1.
        bars.forEach((bar, i) => {
            const t = ((step + i * 2) % EQ_STEPS) / EQ_STEPS;
            bar.scale_y = 0.3 + 0.7 * (1 - Math.abs(2 * t - 1));
        });
        return GLib.SOURCE_CONTINUE;
    };
    // Watch the last bar, not the box: the box reports mapped before its children are.
    const last = bars[bars.length - 1];
    const sync = () => {
        stop();
        bars.forEach(bar => {
            bar.set_style(`height: ${Math.round(EQ_MAX * bar.full)}px; background-color: ${rgba(accent, 1)};`);
            bar.opacity = playing ? 255 : 90;
            bar.scale_y = playing ? 1 : 3 / (EQ_MAX * bar.full);
        });
        if (playing && animate && last.mapped)
            timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, EQ_STEP_MS, tick);
    };
    last.connect('notify::mapped', sync);
    box.connect('destroy', stop);
    box.update = track => {
        playing = !!track && track.status === 'Playing';
        accent = track && track.accent;
        sync();
    };
    return box;
}

// Closed notch while music plays: round cover and equalizer. No accent wash: the content box is
// clipped as a rectangle, so a gradient bled past the notch's rounded corners.
function buildBar(opts) {
    const box = new St.BoxLayout({ style_class: 'ponitch-music-bar', x_expand: true, y_expand: true });
    const art = cover('small');
    const eq = equalizer(opts.animateEq);
    box.add_child(art);
    box.add_child(new St.Widget({ x_expand: true }));
    box.add_child(eq);
    const update = track => {
        art.update(track);
        eq.update(track);
    };
    return { actor: box, update };
}

// Hover peek: cover, title/artist, transport buttons.
function buildPeek(svc) {
    const box = new St.BoxLayout({ style_class: 'ponitch-music-peek', x_expand: true, y_expand: true });
    const art = cover('medium');
    const text = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'ponitch-music-text' });
    const title = new St.Label({ style_class: 'ponitch-music-title' });
    const artist = new St.Label({ style_class: 'ponitch-music-artist' });
    text.add_child(title);
    text.add_child(artist);
    const prev = iconButton('media-skip-backward-symbolic', 'small', () => svc.previous());
    const play = iconButton('media-playback-start-symbolic', 'prominent', () => svc.playPause());
    const next = iconButton('media-skip-forward-symbolic', 'small', () => svc.next());
    [art, text, centered(prev), centered(play), centered(next)].forEach(a => box.add_child(a));
    const update = track => {
        art.update(track);
        title.text = (track && track.title) || 'Nothing playing';
        artist.text = (track && track.artist) || (track ? track.identity : '');
        play.setIcon(playIcon(track));
        prev.reactive = !!track && track.canPrevious;
        next.reactive = !!track && track.canNext;
    };
    return { actor: box, update };
}

const fmt = us => {
    const s = Math.max(0, Math.floor(us / 1e6));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

// Open panel: big cover with accent glow, text, seekable progress, transport, player switch.
function buildPage(svc) {
    const box = new St.BoxLayout({ style_class: 'ponitch-music-page', x_expand: true, y_expand: true });
    const art = cover('large');
    // Accent halo behind the cover instead of a box-shadow glow: St blurs shadows on the CPU and
    // the first frame of the panel took ~150 ms with one. A flat, slightly larger tint costs nothing.
    const halo = new St.Widget({ style_class: 'ponitch-cover-halo', layout_manager: new Clutter.BinLayout(), y_align: Clutter.ActorAlign.CENTER });
    halo.add_child(art);
    const col = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true, style_class: 'ponitch-music-col' });
    const player = new St.Button({ style_class: 'ponitch-chip', can_focus: true });
    const playerRow = new St.BoxLayout(); // keeps the chip at its natural width inside the vertical column
    playerRow.add_child(player);
    player.connect('clicked', () => svc.cyclePlayer());
    const title = new St.Label({ style_class: 'ponitch-music-title large' });
    const artist = new St.Label({ style_class: 'ponitch-music-artist large' });

    const track = new St.Widget({ style_class: 'ponitch-progress', reactive: true, x_expand: true });
    const fill = new St.Widget({ style_class: 'ponitch-progress-fill' });
    track.add_child(fill);
    const times = new St.BoxLayout({ style_class: 'ponitch-times' });
    const elapsed = new St.Label({ style_class: 'ponitch-time', x_expand: true });
    const total = new St.Label({ style_class: 'ponitch-time' });
    times.add_child(elapsed);
    times.add_child(total);

    const controls = new St.BoxLayout({ style_class: 'ponitch-controls', x_align: Clutter.ActorAlign.CENTER });
    const prev = iconButton('media-skip-backward-symbolic', 'small', () => svc.previous());
    const play = iconButton('media-playback-start-symbolic', 'prominent large', () => svc.playPause());
    const next = iconButton('media-skip-forward-symbolic', 'small', () => svc.next());
    [prev, play, next].forEach(a => controls.add_child(centered(a)));

    [playerRow, title, artist, new St.Widget({ y_expand: true }), track, times, controls].forEach(a => col.add_child(a));
    box.add_child(halo);
    box.add_child(col);

    let current = null, tick = 0;
    const drawProgress = () => {
        const len = current ? current.length : 0;
        const pos = svc.position();
        if (track.has_allocation()) // not before it is on stage (see widgets.js)
            fill.width = len ? Math.round(track.width * Math.min(pos / len, 1)) : 0;
        elapsed.text = fmt(pos);
        total.text = len ? fmt(len) : '--:--';
        return GLib.SOURCE_CONTINUE;
    };
    // Ticks only while this page exists and the track is playing.
    const syncTick = () => {
        const want = current && current.status === 'Playing';
        if (want && !tick)
            tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, drawProgress);
        else if (!want && tick) {
            GLib.source_remove(tick);
            tick = 0;
        }
    };
    box.connect('destroy', () => {
        if (tick)
            GLib.source_remove(tick);
        tick = 0;
    });
    track.connect('notify::width', drawProgress);
    track.connect('button-press-event', (_a, event) => {
        if (!current || !current.canSeek || !current.length || !track.has_allocation() || !track.width)
            return Clutter.EVENT_STOP;
        const [x, y] = event.get_coords();
        const [ok, lx] = track.transform_stage_point(x, y);
        if (ok)
            svc.setPosition(current.length * Math.max(0, Math.min(lx / track.width, 1)));
        drawProgress();
        return Clutter.EVENT_STOP;
    });

    const update = t => {
        current = t;
        art.update(t);
        halo.set_style(`background-color: ${rgba(t && t.accent, t && t.accent ? 0.22 : 0)};`);
        title.text = (t && t.title) || 'Nothing playing';
        artist.text = (t && t.artist) || '';
        player.label = t ? (t.players > 1 ? `${t.identity}  ⇄` : t.identity) : '';
        player.visible = !!t;
        player.reactive = !!t && t.players > 1;
        play.setIcon(playIcon(t));
        prev.reactive = !!t && t.canPrevious;
        next.reactive = !!t && t.canNext;
        track.reactive = !!t && t.canSeek;
        fill.set_style(`background-color: ${rgba(t && t.accent, 1)};`);
        drawProgress();
        syncTick();
    };
    svc.refreshPosition();
    return { actor: box, update };
}

module.exports = { initMusicUI, buildBar, buildPeek, buildPage };
