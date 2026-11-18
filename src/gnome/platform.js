// GNOME Shell (46+) side of the platform interface used by core (PLAN.md §2A).
// API details checked against gnome-shell 46 sources (layout.js, osdWindow.js, messageTray.js,
// main.js, status/brightness.js).
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import NM from 'gi://NM';
import Gvc from 'gi://Gvc';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const POWER = ['org.gnome.SettingsDaemon.Power', '/org/gnome/SettingsDaemon/Power', 'org.gnome.SettingsDaemon.Power.Screen'];

const themeContext = () => St.ThemeContext.get_for_stage(global.stage);

let brightnessProxy = null;

export const platform = {
    gi: { Clutter, St, GLib, Gio, GObject, GdkPixbuf, NM, Mixer: Gvc },

    addChrome(actor) {
        Main.layoutManager.addChrome(actor, { trackFullscreen: true, affectsInputRegion: true, affectsStruts: false });
    },

    removeChrome(actor) {
        Main.layoutManager.removeChrome(actor);
    },

    primaryMonitor() {
        return Main.layoutManager.primaryMonitor;
    },

    connectMonitorsChanged(cb) {
        const id = Main.layoutManager.connect('monitors-changed', cb);
        return () => Main.layoutManager.disconnect(id);
    },

    uiScale() {
        return themeContext().scale_factor;
    },

    connectScaleChanged(cb) {
        const ctx = themeContext();
        const id = ctx.connect('notify::scale-factor', cb);
        return () => ctx.disconnect(id);
    },

    // GNOME's frame clock needs the actor the timeline animates.
    newTimeline(actor) {
        return new Clutter.Timeline({ duration: 1000 * 1000, actor });
    },

    // GNOME passes level as a fraction (and maxLevel > 1 for over-amplified volume), which is
    // already core's 0..1+ scale.
    interceptOsd(handler) {
        const mgr = Main.osdWindowManager;
        const hadOwn = Object.prototype.hasOwnProperty.call(mgr, 'show');
        const original = mgr.show;
        const patched = function (monitorIndex, icon, label, level, maxLevel) {
            let handled = false;
            try {
                handled = handler({ icon: icon || null, label: label == null ? null : String(label), level: typeof level === 'number' ? level : null });
            } catch (e) {
                console.warn(`ponitch: HUD failed, using the default OSD: ${e}`);
            }
            if (!handled)
                return original.call(this, monitorIndex, icon, label, level, maxLevel);
        };
        mgr.show = patched;
        return () => {
            if (mgr.show !== patched)
                return console.warn('ponitch: osdWindowManager.show was re-patched by someone else; leaving it');
            if (hadOwn)
                mgr.show = original;
            else
                delete mgr.show;
        };
    },

    // Notifications: patch Source.addNotification (looked up per call, so sources that existed
    // before enable() are covered too). A notification we show is marked acknowledged *before*
    // the tray sees it; the tray never banners acknowledged notifications, while the message
    // list (calendar menu) still keeps it. Updates re-arrive as acknowledged=false, which our
    // handler (connected before the source's own) turns back into true.
    interceptNotifications(handler) {
        const proto = MessageTray.Source.prototype;
        const original = proto.addNotification;
        const keys = new WeakMap();
        let nextKey = 1;
        const toInfo = n => ({
            key: keys.get(n),
            app: (n.source && n.source.title) || '',
            title: n.title || '',
            body: n.body || '',
            gicon: n.gicon || (n.source && n.source.icon) || null,
            urgency: n.urgency >= MessageTray.Urgency.CRITICAL ? 'critical' : n.urgency <= MessageTray.Urgency.LOW ? 'low' : 'normal',
            transient: n.isTransient,
            actions: (n.actions || []).map(a => ({ label: a.label, invoke: () => a.activate() })),
            activate: () => n.activate(),
            dismiss: () => n.destroy(MessageTray.NotificationDestroyedReason.DISMISSED),
            onClosed: cb => n.connect('destroy', () => cb()),
        });
        const offer = n => {
            try {
                if (handler(toInfo(n)))
                    n.acknowledged = true;
            } catch (e) {
                console.warn(`ponitch: notification failed, using the banner: ${e}`);
            }
        };
        const patched = function (notification) {
            // Already acknowledged (e.g. restored from a previous session): leave it alone.
            if (!keys.has(notification) && !notification.acknowledged) {
                keys.set(notification, nextKey++);
                notification.connect('notify::acknowledged', () => {
                    if (!notification.acknowledged)
                        offer(notification);
                });
                offer(notification);
            }
            return original.call(this, notification);
        };
        proto.addNotification = patched;
        return () => {
            if (proto.addNotification === patched)
                proto.addNotification = original;
            else
                console.warn('ponitch: Source.addNotification was re-patched by someone else; leaving it');
        };
    },

    // Screen brightness 0..100 via gsd-power's Brightness property (GNOME 46). cb(null) when
    // there is no backlight (the property is -1) or the service is missing.
    brightness: {
        _proxy(cb) {
            if (brightnessProxy)
                return cb(brightnessProxy);
            Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES, null, ...POWER, null, (_o, res) => {
                try {
                    brightnessProxy = Gio.DBusProxy.new_finish(res);
                } catch (e) {
                    return cb(null);
                }
                cb(brightnessProxy);
            });
        },
        get(cb) {
            this._proxy(p => {
                const v = p && p.get_cached_property('Brightness');
                const pct = v ? v.unpack() : -1;
                cb(pct >= 0 ? pct : null);
            });
        },
        set(pct) {
            this._proxy(p => p && p.call('org.freedesktop.DBus.Properties.Set',
                new GLib.Variant('(ssv)', [POWER[2], 'Brightness', new GLib.Variant('i', Math.round(pct))]),
                Gio.DBusCallFlags.NONE, -1, null, null));
        },
        watch(cb) {
            let id = 0, proxy = null, gone = false;
            this._proxy(p => {
                if (p && !gone) {
                    proxy = p;
                    id = p.connect('g-properties-changed', () => cb());
                }
            });
            return () => {
                gone = true;
                if (proxy && id)
                    proxy.disconnect(id);
            };
        },
    },

    lock() {
        Main.screenShield?.lock(true);
    },

    // Do not disturb = GNOME's own "notification banners off" switch.
    dnd: {
        _settings: null,
        _s() {
            return this._settings || (this._settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' }));
        },
        get() {
            return !this._s().get_boolean('show-banners');
        },
        set(on) {
            this._s().set_boolean('show-banners', !on);
        },
        watch(cb) {
            const s = this._s();
            const id = s.connect('changed::show-banners', () => cb());
            return () => s.disconnect(id);
        },
    },

    // A file path, or (path null) a freedesktop theme sound name such as 'complete'.
    playSound(path, themeName) {
        const player = global.display.get_sound_player();
        if (path)
            player.play_from_file(Gio.File.new_for_path(path), 'ponitch', null);
        else
            player.play_from_theme(themeName, 'ponitch', null);
    },

    // Keyboard focus for a text entry inside shell chrome. Returns a release function.
    // GNOME's pushModal also pops itself if the actor is destroyed.
    // Global shortcut held only until the returned function is called (e.g. Esc while the
    // pomodoro is expanded). Unlike grabKeyboard it leaves every other key and the pointer alone.
    grabKey(accel, cb) {
        const action = global.display.grab_accelerator(accel, Meta.KeyBindingFlags.NONE);
        if (action === Meta.KeyBindingAction.NONE)
            return () => {};
        const name = Meta.external_binding_name_for_action(action);
        Main.wm.allowKeybinding(name, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
        const id = global.display.connect('accelerator-activated', (_d, a) => {
            if (a === action)
                cb();
        });
        return () => {
            global.display.disconnect(id);
            global.display.ungrab_accelerator(action);
            Main.wm.allowKeybinding(name, Shell.ActionMode.NONE);
        };
    },

    grabKeyboard(actor) {
        const grab = Main.pushModal(actor);
        if ((grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
            Main.popModal(grab);
            return () => {};
        }
        actor.grab_key_focus();
        return () => {
            // popModal() on a grab that is not on the stack throws and drops key focus.
            if (Main.modalActorFocusStack.some(r => r.grab === grab))
                Main.popModal(grab);
        };
    },
};

// Called from disable(): drop module state so the next enable() starts clean.
export function resetPlatform() {
    brightnessProxy = null;
    platform.dnd._settings = null;
}
