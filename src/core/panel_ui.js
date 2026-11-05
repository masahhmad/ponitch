// Open panel: header (tab capsule + quick actions) over the selected tab (PLAN.md §4A.5).
const { iconButton } = require('./widgets');

let Clutter, St;

// ctx: {
//   gi, tabs: [{ id, icon, label, build: () => view }], tab: initial id, onTab(id),
//   power, audio (services or null), pinned: bool, onPin(bool), lock()
// }
// view: { actor, update?(track) }. Tabs are built the first time they are shown.
function buildPanel(ctx) {
    ({ Clutter, St } = ctx.gi);
    const box = new St.BoxLayout({ vertical: true, style_class: 'ponitch-panel', x_expand: true, y_expand: true });
    const header = new St.BoxLayout({ style_class: 'ponitch-header' });
    const tabbar = new St.BoxLayout({ style_class: 'ponitch-tabs', y_align: Clutter.ActorAlign.CENTER });
    const actions = new St.BoxLayout({ style_class: 'ponitch-actions', y_align: Clutter.ActorAlign.CENTER });
    header.add_child(tabbar);
    header.add_child(new St.Widget({ x_expand: true }));
    header.add_child(actions);
    const content = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true });
    box.add_child(header);
    box.add_child(content);

    const views = new Map();
    const buttons = new Map();
    let current = null, track = null;

    for (const t of ctx.tabs) {
        const inner = new St.BoxLayout({ style_class: 'ponitch-tab-inner' });
        inner.add_child(new St.Icon({ icon_name: t.icon, style_class: 'ponitch-tab-icon' }));
        const label = new St.Label({ text: t.label, style_class: 'ponitch-tab-label', y_align: Clutter.ActorAlign.CENTER });
        inner.add_child(label);
        const btn = new St.Button({ style_class: 'ponitch-tab', child: inner, can_focus: true, accessible_name: t.label });
        btn.connect('clicked', () => select(t.id));
        btn.label_actor = label;
        buttons.set(t.id, { btn, label });
        tabbar.add_child(btn);
    }

    function select(id) {
        const tab = ctx.tabs.find(t => t.id === id) || ctx.tabs[0];
        if (current === tab.id)
            return;
        current = tab.id;
        for (const [tid, { btn, label }] of buttons) {
            const on = tid === tab.id;
            btn.checked = on;
            label.visible = on; // the active tab widens to show its name, like Notchy's capsule
        }
        if (!views.has(tab.id))
            views.set(tab.id, tab.build());
        content.remove_all_children();
        const view = views.get(tab.id);
        content.add_child(view.actor);
        if (view.update)
            view.update(track);
        ctx.onTab(tab.id);
    }

    // Quick actions; each one hides when its service has nothing to offer.
    const battery = new St.BoxLayout({ style_class: 'ponitch-battery' });
    const batteryIcon = new St.Icon({ style_class: 'ponitch-battery-icon', y_align: Clutter.ActorAlign.CENTER });
    const batteryText = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
    battery.add_child(batteryIcon);
    battery.add_child(batteryText);
    const mute = iconButton('audio-volume-high-symbolic', 'chrome', () => ctx.audio.toggleMute('output'));
    const awake = iconButton('preferences-desktop-screensaver-symbolic', 'chrome', () => ctx.power.setKeepAwake(!ctx.power.keepAwake));
    let pinned = ctx.pinned;
    const pin = iconButton('view-pin-symbolic', 'chrome', () => {
        pinned = !pinned;
        pin.checked = pinned;
        ctx.onPin(pinned);
    });
    pin.checked = pinned;
    const lock = iconButton('system-lock-screen-symbolic', 'chrome', () => ctx.lock());
    [battery, mute, awake, pin, lock].forEach(a => actions.add_child(a));

    const refreshHeader = () => {
        const b = ctx.power && ctx.power.battery;
        battery.visible = !!b;
        if (b) {
            batteryText.text = `${b.percent}%`;
            batteryIcon.icon_name = b.icon || 'battery-good-symbolic';
        }
        const out = ctx.audio && ctx.audio.output;
        mute.visible = !!out;
        if (out) {
            mute.checked = out.muted;
            mute.setIcon(out.muted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic');
        }
        awake.visible = !!ctx.power;
        awake.checked = !!ctx.power && ctx.power.keepAwake;
    };
    const unsubs = [ctx.power, ctx.audio].filter(Boolean).map(s => s.subscribe(refreshHeader));
    box.connect('destroy', () => {
        unsubs.forEach(u => u());
        // Tabs not on screen were only removed (kept for reuse); destroy them too, or the GC later
        // finalizes actors that still have ::destroy handlers (Gjs-CRITICAL, can crash).
        views.forEach(v => {
            if (!v.actor.get_parent())
                v.actor.destroy();
        });
    });
    refreshHeader();
    select(ctx.tab);

    const update = t => {
        track = t;
        const view = views.get(current);
        if (view && view.update)
            view.update(t);
    };
    return { actor: box, update, select };
}

module.exports = { buildPanel };
