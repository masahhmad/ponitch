// Small widgets shared by the notch views.
let Clutter, St, GLib;

function initWidgets(gi) {
    ({ Clutter, St, GLib } = gi);
}

// No x_align/y_align on St.Bin subclasses (St.Button): in Cinnamon's St they are St.Align and
// position the *child*, in GNOME they position the button itself. Rows center buttons instead.
function iconButton(iconName, styleClass, onClick) {
    const icon = new St.Icon({ icon_name: iconName, style_class: 'ponitch-btn-icon' });
    const btn = new St.Button({ style_class: `ponitch-btn ${styleClass}`, child: icon, can_focus: true });
    btn.connect('clicked', onClick);
    btn.setIcon = name => { icon.icon_name = name; };
    return btn;
}

// Rows stretch children to the row height; wrapping keeps a round button at its own size, centered.
function centered(actor) {
    const wrap = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    wrap.add_child(actor);
    return wrap;
}

// Horizontal 0..1 slider: click, drag (while the pointer stays on it) and scroll.
// onChange(v) fires for user input only; setValue() never calls it.
function makeSlider(onChange) {
    const hit = new St.Widget({ style_class: 'ponitch-slider', reactive: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, layout_manager: new Clutter.BinLayout() });
    const track = new St.Widget({ style_class: 'ponitch-slider-track', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    const fill = new St.Widget({ style_class: 'ponitch-slider-fill' });
    track.add_child(fill);
    hit.add_child(track);
    let value = 0, dragging = false;
    // Reading width before the track is allocated (off stage) makes St query its theme node and warn.
    const draw = () => {
        if (track.has_allocation())
            fill.width = Math.round(track.width * value);
    };
    const fromEvent = event => {
        const [x, y] = event.get_coords();
        const [ok, lx] = track.transform_stage_point(x, y);
        if (ok && track.width > 0)
            set(lx / track.width);
    };
    const set = v => {
        value = Math.max(0, Math.min(1, v));
        draw();
        onChange(value);
    };
    track.connect('notify::width', draw);
    hit.connect('button-press-event', (_a, e) => { dragging = true; fromEvent(e); return Clutter.EVENT_STOP; });
    hit.connect('motion-event', (_a, e) => { if (dragging) fromEvent(e); return Clutter.EVENT_STOP; });
    hit.connect('button-release-event', () => { dragging = false; return Clutter.EVENT_STOP; });
    hit.connect('leave-event', () => { dragging = false; return Clutter.EVENT_PROPAGATE; });
    hit.connect('scroll-event', (_a, e) => {
        const dir = e.get_scroll_direction();
        if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.RIGHT)
            set(value + 0.05);
        else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.LEFT)
            set(value - 0.05);
        return Clutter.EVENT_STOP;
    });
    hit.setValue = v => {
        if (dragging)
            return; // don't fight the user's drag with the echo of their own change
        value = Math.max(0, Math.min(1, v));
        draw();
    };
    return hit;
}

// Cinnamon's St.ScrollView must get its child through add_actor(): St.Bin.set_child() skips the
// ScrollView's own hook and Cinnamon aborts in st_bin_destroy() when the view is destroyed
// (crashed the shell in M2 testing). GNOME 46 removed add_actor() and wants set_child().
function setScrollChild(scroll, child) {
    if (typeof scroll.add_actor === 'function')
        scroll.add_actor(child);
    else
        scroll.set_child(child);
}

// Calls fn now and every `ms` while `actor` is on screen; stops when it is hidden or destroyed,
// so countdowns cost nothing while the notch shows something else.
function ticker(actor, ms, fn) {
    let id = 0;
    const stop = () => {
        if (id)
            GLib.source_remove(id);
        id = 0;
    };
    const sync = () => {
        stop();
        if (actor.mapped) {
            fn();
            id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                fn();
                return GLib.SOURCE_CONTINUE;
            });
        }
    };
    actor.connect('notify::mapped', sync);
    actor.connect('destroy', stop);
    sync();
}

// Returns a function that runs fn once at idle (repeated calls coalesce). Lists rebuilt from a
// click handler must not destroy the clicked button while it is still emitting 'clicked'.
function deferred(actor, fn) {
    let id = 0, gone = false;
    actor.connect('destroy', () => {
        gone = true;
        if (id)
            GLib.source_remove(id);
        id = 0;
    });
    return () => {
        if (id || gone)
            return;
        id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            id = 0;
            fn();
            return GLib.SOURCE_REMOVE;
        });
    };
}

module.exports = { initWidgets, iconButton, centered, makeSlider, setScrollChild, ticker, deferred };
