// GNOME Shell entry point: GSettings -> cfg, the toggle shortcut, the clock move, and App
// (core/app.js).
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { platform, resetPlatform } from './platform.js';
import { App, SETTINGS } from './app.js';

export default class PonitchExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._cfg = {};
        this._app = new App(platform, this._cfg);
        const read = (key, prop) => {
            this._cfg[prop] = this._settings.get_value(key).recursiveUnpack();
        };
        this._settingIds = SETTINGS.map(([key, prop, group]) => {
            read(key, prop);
            return this._settings.connect(`changed::${key}`, () => {
                read(key, prop);
                if (group)
                    this._app.changed(group);
            });
        });
        this._app.enable();
        Main.wm.addKeybinding('toggle-key', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._app.toggle());
        this._moveClock();
    }

    disable() {
        for (const step of [
            () => Main.wm.removeKeybinding('toggle-key'),
            () => this._restoreClock(),
            () => this._app.disable(),
            () => this._settingIds.forEach(id => this._settings.disconnect(id)),
            resetPlatform,
        ]) {
            try {
                step();
            } catch (e) {
                console.warn(`ponitch: disable step failed: ${e}`);
            }
        }
        this._app = this._settings = this._cfg = this._settingIds = null;
    }

    // The notch sits on the middle of the top bar, where GNOME puts the clock: move the date menu
    // to the right side (PLAN.md §2A), and put it back exactly where it was on disable.
    _moveClock() {
        const container = Main.panel.statusArea.dateMenu?.container;
        const from = container && container.get_parent();
        if (!from || from !== Main.panel._centerBox)
            return; // someone (another extension) already moved it; leave it
        this._clock = { container, index: from.get_children().indexOf(container) };
        from.remove_child(container);
        Main.panel._rightBox.insert_child_at_index(container, 0);
    }

    _restoreClock() {
        if (!this._clock)
            return;
        const { container, index } = this._clock;
        this._clock = null;
        if (container.get_parent() !== Main.panel._rightBox)
            return;
        Main.panel._rightBox.remove_child(container);
        Main.panel._centerBox.insert_child_at_index(container, index);
    }
}
