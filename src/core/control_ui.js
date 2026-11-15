// Control tab: switches that change the system (PLAN.md §4.3). Every control reflects outside
// changes through the services' subscriptions; nothing polls.
const { iconButton, centered, makeSlider, setScrollChild, deferred } = require('./widgets');
const { _, N_ } = require('./i18n');

let Clutter, St;

const PROFILES = [
    ['power-saver', 'power-profile-power-saver-symbolic', N_('Saver')],
    ['balanced', 'power-profile-balanced-symbolic', N_('Balanced')],
    ['performance', 'power-profile-performance-symbolic', N_('Performance')],
];

// ctx: { gi, power, audio, network, bluetooth, platform }
function buildControl(ctx) {
    ({ Clutter, St } = ctx.gi);
    const root = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true });
    const main = new St.BoxLayout({ vertical: true, style_class: 'ponitch-control', x_expand: true, y_expand: true });
    root.add_child(main);
    const refreshers = [];
    const unsubs = [];
    const watch = (svc, fn) => {
        refreshers.push(fn);
        if (svc)
            unsubs.push(svc.subscribe(fn));
    };

    // --- tiles ---
    const tiles = new St.BoxLayout({ style_class: 'ponitch-tiles' });
    main.add_child(tiles);

    const wifi = tile('network-wireless-signal-excellent-symbolic', _('Wi-Fi'), () => ctx.network.setEnabled(!ctx.network.wifi.enabled),
        () => openList(wifiList));
    watch(ctx.network, () => {
        const w = ctx.network.wifi;
        wifi.actor.visible = !!w;
        if (!w)
            return;
        const on = w.enabled && w.hardware;
        wifi.set(on, !w.hardware ? _('Hardware off') : !w.enabled ? _('Off') : (w.ssid || _('Not connected')),
            !on ? 'network-wireless-offline-symbolic' : `network-wireless-signal-${signal(w.strength)}-symbolic`);
    });

    const bt = tile('bluetooth-active-symbolic', 'Bluetooth', () => ctx.bluetooth.setPowered(!ctx.bluetooth.state.powered),
        () => openList(btList));
    watch(ctx.bluetooth, () => {
        const s = ctx.bluetooth.state;
        bt.actor.visible = !!s;
        if (!s)
            return;
        const conn = s.devices.filter(d => d.connected);
        bt.set(s.powered, !s.powered ? _('Off') : conn.length ? conn.map(d => d.name).join(', ') : _('On'),
            s.powered ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic');
    });

    const awake = tile('preferences-desktop-screensaver-symbolic', _('Keep awake'), () => ctx.power.setKeepAwake(!ctx.power.keepAwake));
    watch(ctx.power, () => awake.set(ctx.power.keepAwake, ctx.power.keepAwake ? _('On') : _('Off')));

    const dnd = tile('notifications-disabled-symbolic', _('Do not disturb'), () => ctx.platform.dnd.set(!ctx.platform.dnd.get()));
    refreshers.push(() => dnd.set(ctx.platform.dnd.get(), ctx.platform.dnd.get() ? _('On') : _('Off')));
    unsubs.push(ctx.platform.dnd.watch(() => refreshers.forEach(f => f())));
    [wifi, bt, awake, dnd].forEach(t => tiles.add_child(t.actor));

    // --- sliders ---
    const volume = sliderRow('audio-volume-high-symbolic', () => ctx.audio.toggleMute('output'), v => ctx.audio.setVolume('output', v));
    watch(ctx.audio, () => volume.show(ctx.audio.output, 'audio-volume'));
    const mic = sliderRow('microphone-sensitivity-high-symbolic', () => ctx.audio.toggleMute('input'), v => ctx.audio.setVolume('input', v));
    watch(ctx.audio, () => mic.show(ctx.audio.input, 'microphone-sensitivity'));
    const light = sliderRow('display-brightness-symbolic', null, v => ctx.platform.brightness.set(Math.max(1, v * 100)));
    const readLight = () => ctx.platform.brightness.get(pct => light.show(pct === null ? null : { volume: pct / 100, muted: false }));
    unsubs.push(ctx.platform.brightness.watch(readLight));
    readLight();
    [volume, mic, light].forEach(r => main.add_child(r.actor));

    // --- power profile + lock ---
    const bottom = new St.BoxLayout({ style_class: 'ponitch-control-bottom' });
    const segs = new St.BoxLayout({ style_class: 'ponitch-segments', x_expand: true });
    const segButtons = PROFILES.map(([id, icon, label]) => {
        const inner = new St.BoxLayout({ style_class: 'ponitch-seg-inner' });
        inner.add_child(new St.Icon({ icon_name: icon, style_class: 'ponitch-btn-icon' }));
        inner.add_child(new St.Label({ text: _(label), y_align: Clutter.ActorAlign.CENTER }));
        const b = new St.Button({ style_class: 'ponitch-seg', child: inner, x_expand: true, can_focus: true });
        b.connect('clicked', () => ctx.power.setProfile(id));
        segs.add_child(b);
        return [id, b];
    });
    watch(ctx.power, () => {
        const p = ctx.power.profile;
        segs.visible = !!p;
        if (p)
            segButtons.forEach(([id, b]) => {
                b.checked = p.active === id;
                b.visible = p.available.includes(id);
            });
    });
    bottom.add_child(segs);
    const lock = iconButton('system-lock-screen-symbolic', 'chrome large', () => ctx.platform.lock());
    bottom.add_child(centered(lock));
    main.add_child(new St.Widget({ y_expand: true }));
    main.add_child(bottom);

    // --- Wi-Fi / Bluetooth lists (replace the main view; ‹ goes back) ---
    let list = null;
    function openList(make) {
        main.hide();
        list = make();
        root.add_child(list.actor);
    }
    // Called from the ‹ button inside the list, so destroy the list after the click has finished
    // emitting instead of tearing down the button in the middle of its own signal.
    function closeList() {
        const old = list;
        list = null;
        main.show();
        if (!old)
            return;
        old.actor.hide();
        let gone = false; // the whole panel may close (and destroy it) before the idle runs
        old.actor.connect('destroy', () => { gone = true; });
        ctx.gi.GLib.idle_add(ctx.gi.GLib.PRIORITY_DEFAULT, () => {
            if (!gone)
                old.actor.destroy();
            return ctx.gi.GLib.SOURCE_REMOVE;
        });
    }

    function wifiList() {
        ctx.network.scan();
        return listPage(_('Wi-Fi'), ctx.network, () => ctx.network.networks.map(n => ({
            icon: n.secure ? 'network-wireless-encrypted-symbolic' : `network-wireless-signal-${signal(n.strength)}-symbolic`,
            name: n.ssid, detail: n.active ? _('Connected') : `${n.strength}%`, active: n.active,
            activate: () => ctx.network.connect(n.ssid),
        })), _('No networks found'));
    }

    function btList() {
        return listPage(_('Bluetooth'), ctx.bluetooth, () => (ctx.bluetooth.state ? ctx.bluetooth.state.devices : []).map(d => ({
            icon: `${d.icon}-symbolic`, name: d.name,
            detail: [d.connected ? _('Connected') : _('Not connected'), d.battery !== null ? `${d.battery}%` : null].filter(Boolean).join(' · '),
            active: d.connected, activate: () => ctx.bluetooth.toggleDevice(d.path),
        })), _('No paired devices'));
    }

    function listPage(title, svc, rows, emptyText) {
        const page = new St.BoxLayout({ vertical: true, style_class: 'ponitch-list', x_expand: true, y_expand: true });
        const head = new St.BoxLayout({ style_class: 'ponitch-list-head' });
        head.add_child(centered(iconButton('go-previous-symbolic', 'round', closeList)));
        head.add_child(new St.Label({ text: title, style_class: 'ponitch-list-title', y_align: Clutter.ActorAlign.CENTER }));
        const scroll = new St.ScrollView({ style_class: 'ponitch-list-scroll', x_expand: true, y_expand: true });
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        const items = new St.BoxLayout({ vertical: true, style_class: 'ponitch-list-items' });
        setScrollChild(scroll, items);
        page.add_child(head);
        page.add_child(scroll);
        const render = () => {
            items.destroy_all_children();
            const all = rows();
            if (!all.length)
                items.add_child(new St.Label({ text: emptyText, style_class: 'ponitch-muted' }));
            for (const r of all.slice(0, 30)) {
                const row = new St.BoxLayout({ style_class: 'ponitch-row' });
                row.add_child(new St.Icon({ icon_name: r.icon, style_class: 'ponitch-btn-icon', y_align: Clutter.ActorAlign.CENTER }));
                row.add_child(new St.Label({ text: r.name, style_class: 'ponitch-row-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
                row.add_child(new St.Label({ text: r.detail, style_class: 'ponitch-row-detail', y_align: Clutter.ActorAlign.CENTER }));
                const b = new St.Button({ style_class: 'ponitch-row-btn', child: row, can_focus: true, x_expand: true });
                b.checked = r.active;
                b.connect('clicked', r.activate);
                items.add_child(b);
            }
        };
        const unsub = svc.subscribe(deferred(page, render));
        page.connect('destroy', unsub);
        render();
        return { actor: page };
    }

    root.connect('destroy', () => unsubs.forEach(u => u()));
    refreshers.forEach(f => f());
    return { actor: root };
}

const signal = s => (s > 75 ? 'excellent' : s > 50 ? 'good' : s > 25 ? 'ok' : 'weak');

// Tile: click toggles; the optional › opens details.
function tile(icon, title, onToggle, onDetails) {
    const box = new St.BoxLayout({ style_class: 'ponitch-tile-inner' });
    const ic = new St.Icon({ icon_name: icon, style_class: 'ponitch-tile-icon', y_align: Clutter.ActorAlign.CENTER });
    const text = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    text.add_child(new St.Label({ text: title, style_class: 'ponitch-tile-title' }));
    const sub = new St.Label({ style_class: 'ponitch-tile-sub' });
    text.add_child(sub);
    box.add_child(ic);
    box.add_child(text);
    const btn = new St.Button({ style_class: 'ponitch-tile', child: box, x_expand: true, can_focus: true });
    btn.connect('clicked', onToggle);
    let actor = btn;
    if (onDetails) {
        actor = new St.BoxLayout({ style_class: 'ponitch-tile-wrap', x_expand: true });
        actor.add_child(btn);
        actor.add_child(iconButton('go-next-symbolic', 'tile-more', onDetails));
    }
    return {
        actor,
        set(on, subtitle, iconName) {
            btn.checked = on;
            sub.text = subtitle;
            if (iconName)
                ic.icon_name = iconName;
        },
    };
}

// Icon button (mute toggle, or plain icon) + slider + percentage.
function sliderRow(icon, onIcon, onChange) {
    const row = new St.BoxLayout({ style_class: 'ponitch-slider-row' });
    const btn = iconButton(icon, 'small', () => onIcon && onIcon());
    btn.reactive = !!onIcon;
    const slider = makeSlider(onChange);
    const value = new St.Label({ style_class: 'ponitch-slider-value', y_align: Clutter.ActorAlign.CENTER });
    row.add_child(centered(btn));
    row.add_child(slider);
    row.add_child(value);
    return {
        actor: row,
        // s: { volume 0..1, muted } or null (hide). iconBase gives -muted/-high icon names.
        show(s, iconBase) {
            row.visible = !!s;
            if (!s)
                return;
            slider.setValue(s.volume);
            value.text = s.muted ? _('Muted') : `${Math.round(s.volume * 100)}%`;
            if (iconBase)
                btn.setIcon(`${iconBase}-${s.muted ? 'muted' : 'high'}-symbolic`);
            btn.checked = s.muted;
        },
    };
}

module.exports = { buildControl };
