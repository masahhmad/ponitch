// GNOME preferences window. Rows are generated from the GSettings schema (summary, range,
// choices), so it stays in step with the keys App uses.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Group titles and choice labels are marked with _(); summaries come translated from the schema.
const N_ = s => s;
const GROUPS = [
    [N_('Notch'), ['shape', 'look-color', 'look-opacity', 'hover-opens-panel', 'close-delay', 'panel-width', 'toggle-key']],
    [N_('Features'), ['hud-enabled', 'music-enabled', 'music-animate-eq', 'control-enabled', 'pomodoro-enabled', 'stopwatch-enabled', 'todo-enabled']],
    [N_('Prayer times'), ['prayer-enabled', 'prayer-city', 'prayer-lat', 'prayer-lon', 'prayer-method', 'prayer-asr', 'prayer-adzan-file']],
    [N_('Notifications'), ['notifications-enabled', 'notifications-history']],
];
const STEPS = { 'close-delay': 50, 'panel-width': 10, 'look-opacity': 5 };
const CHOICE_LABELS = {
    attached: N_('Attached (joined to the top edge)'), floating: N_('Floating (pill below the top edge)'),
    kemenag: N_('Kemenag RI (Indonesia)'), mwl: N_('Muslim World League'), isna: N_('ISNA (North America)'), egypt: N_('Egyptian General Authority'),
    'umm-al-qura': N_('Umm al-Qura (Makkah)'), karachi: N_('Karachi'), jakim: N_('JAKIM (Malaysia)'), muis: N_('MUIS (Singapore)'),
    shafii: N_("Shafi'i, Maliki, Hanbali"), hanafi: N_('Hanafi'),
};

export default class PonitchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const schema = settings.settings_schema;
        const page = new Adw.PreferencesPage();
        for (const [title, keys] of GROUPS) {
            const group = new Adw.PreferencesGroup({ title: _(title) });
            for (const key of keys)
                group.add(row(settings, schema.get_key(key), window));
            page.add(group);
        }
        window.add(page);
        window._settings = settings; // keep it alive with the window
    }
}

function row(settings, key, window) {
    const name = key.get_name(), title = key.get_summary();
    const type = key.get_value_type().dup_string();
    const [rangeType, rangeVal] = key.get_range().recursiveUnpack();

    if (type === 'b') {
        const r = new Adw.SwitchRow({ title });
        settings.bind(name, r, 'active', Gio.SettingsBindFlags.DEFAULT);
        return r;
    }
    if (rangeType === 'range') {
        const [min, max] = rangeVal;
        const step = STEPS[name] || (type === 'd' ? 0.0001 : 1);
        const r = Adw.SpinRow.new_with_range(min, max, step);
        r.set({ title, digits: type === 'd' ? 4 : 0 });
        settings.bind(name, r, 'value', Gio.SettingsBindFlags.DEFAULT);
        return r;
    }
    if (rangeType === 'enum') {
        const r = new Adw.ComboRow({ title, model: Gtk.StringList.new(rangeVal.map(v => (CHOICE_LABELS[v] ? _(CHOICE_LABELS[v]) : v))) });
        const sync = () => { r.selected = Math.max(0, rangeVal.indexOf(settings.get_string(name))); };
        sync();
        settings.connect(`changed::${name}`, sync);
        r.connect('notify::selected', () => settings.set_string(name, rangeVal[r.selected]));
        return r;
    }
    if (name === 'look-color')
        return colorRow(settings, name, title);
    if (name.endsWith('-file'))
        return fileRow(settings, name, title, window);
    if (type === 'as')
        return shortcutRow(settings, name, title);
    const r = new Adw.EntryRow({ title });
    settings.bind(name, r, 'text', Gio.SettingsBindFlags.DEFAULT);
    return r;
}

function colorRow(settings, name, title) {
    const r = new Adw.ActionRow({ title });
    const button = new Gtk.ColorDialogButton({ dialog: new Gtk.ColorDialog({ with_alpha: false }), valign: Gtk.Align.CENTER });
    const rgba = new Gdk.RGBA();
    rgba.parse(settings.get_string(name)) || rgba.parse('rgb(0,0,0)');
    button.rgba = rgba;
    button.connect('notify::rgba', () => {
        const c = button.rgba;
        settings.set_string(name, `rgb(${Math.round(c.red * 255)},${Math.round(c.green * 255)},${Math.round(c.blue * 255)})`);
    });
    r.add_suffix(button);
    return r;
}

function fileRow(settings, name, title, window) {
    const r = new Adw.ActionRow({ title });
    const show = () => { r.subtitle = settings.get_string(name) || _('None'); };
    show();
    settings.connect(`changed::${name}`, show);
    const choose = new Gtk.Button({ label: _('Choose…'), valign: Gtk.Align.CENTER });
    choose.connect('clicked', () => {
        new Gtk.FileDialog({ title }).open(window, null, (d, res) => {
            try {
                settings.set_string(name, d.open_finish(res).get_path());
            } catch (e) {
                // dialog cancelled
            }
        });
    });
    const clear = new Gtk.Button({ icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Clear') });
    clear.connect('clicked', () => settings.set_string(name, ''));
    r.add_suffix(choose);
    r.add_suffix(clear);
    return r;
}

// Accelerator typed as text (e.g. <Alt>n); only valid ones are saved.
function shortcutRow(settings, name, title) {
    const r = new Adw.EntryRow({ title, show_apply_button: true, text: settings.get_strv(name)[0] || '' });
    r.connect('apply', () => {
        const accel = r.text.trim();
        const [ok, keyval] = Gtk.accelerator_parse(accel);
        if (accel === '' || (ok && keyval !== 0))
            settings.set_strv(name, accel ? [accel] : []);
        else
            r.text = settings.get_strv(name)[0] || '';
    });
    return r;
}

