// Notification banner (closed notch) and Notifications tab (PLAN.md §4.8, §4A.4).
const { iconButton, centered, setScrollChild, deferred } = require('./widgets');
const { _ } = require('./i18n');

let Clutter, St;

function initNotificationsUI(gi) {
    ({ Clutter, St } = gi);
}

function appIcon(item, styleClass) {
    const icon = new St.Icon({ style_class: styleClass, y_align: Clutter.ActorAlign.CENTER });
    if (item.gicon)
        icon.gicon = item.gicon;
    else
        icon.icon_name = 'dialog-information-symbolic';
    return icon;
}

const oneLine = s => s.replace(/\s+/g, ' ').trim();

// Notchy's banner: icon, title (bold), body or app name (dim).
function buildBanner(item) {
    const box = new St.BoxLayout({ style_class: 'ponitch-banner', x_expand: true, y_expand: true });
    box.add_child(appIcon(item, 'ponitch-banner-icon'));
    const text = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    text.add_child(new St.Label({ text: oneLine(item.title || item.app), style_class: 'ponitch-banner-title' }));
    const sub = oneLine(item.body || item.app);
    if (sub)
        text.add_child(new St.Label({ text: sub, style_class: 'ponitch-banner-body' }));
    box.add_child(text);
    if (item.urgency === 'critical')
        box.add_child(new St.Label({ text: _('Click to open'), style_class: 'ponitch-alert-hint', y_align: Clutter.ActorAlign.CENTER }));
    return { actor: box };
}

const ago = time => {
    const s = Math.floor((Date.now() - time) / 1000);
    if (s < 60)
        return _('now');
    if (s < 3600)
        return _('%sm', Math.floor(s / 60));
    const d = new Date(time);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ctx: { gi, notifications }
function buildNotificationsTab(ctx) {
    initNotificationsUI(ctx.gi);
    const svc = ctx.notifications;
    const box = new St.BoxLayout({ vertical: true, style_class: 'ponitch-notifs', x_expand: true, y_expand: true });
    const head = new St.BoxLayout({ style_class: 'ponitch-list-head' });
    const count = new St.Label({ style_class: 'ponitch-list-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    const clear = new St.Button({ label: _('Clear all'), style_class: 'ponitch-text-btn', can_focus: true });
    clear.connect('clicked', () => svc.clear());
    head.add_child(count);
    head.add_child(clear);
    const scroll = new St.ScrollView({ style_class: 'ponitch-list-scroll', x_expand: true, y_expand: true });
    scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    const items = new St.BoxLayout({ vertical: true, style_class: 'ponitch-notif-items' });
    setScrollChild(scroll, items);
    box.add_child(head);
    box.add_child(scroll);

    const draw = () => {
        items.destroy_all_children();
        const list = svc.items;
        count.text = list.length ? _('Notifications · %s', list.length) : _('Notifications');
        clear.visible = list.length > 0;
        if (!list.length)
            items.add_child(new St.Label({ text: _('No notifications'), style_class: 'ponitch-muted' }));
        for (const item of list) {
            const card = new St.BoxLayout({ style_class: 'ponitch-notif' + (item.urgency === 'critical' ? ' critical' : '') });
            card.add_child(appIcon(item, 'ponitch-notif-icon'));
            const text = new St.BoxLayout({ vertical: true, x_expand: true });
            text.add_child(new St.Label({ text: `${item.app || _('Notification')} · ${ago(item.time)}`, style_class: 'ponitch-notif-meta' }));
            if (item.title)
                text.add_child(new St.Label({ text: oneLine(item.title), style_class: 'ponitch-notif-title' }));
            if (item.body) {
                const body = new St.Label({ text: item.body.trim(), style_class: 'ponitch-notif-body' });
                body.clutter_text.line_wrap = true;
                text.add_child(body);
            }
            if (item.actions.length) {
                const actions = new St.BoxLayout({ style_class: 'ponitch-notif-actions' });
                for (const a of item.actions) {
                    const b = new St.Button({ label: a.label, style_class: 'ponitch-text-btn', can_focus: true });
                    b.connect('clicked', () => a.invoke());
                    actions.add_child(b);
                }
                text.add_child(actions);
            }
            // The text area opens the notification (default action / focus the app). A plain
            // reactive box, not an St.Button: a button (St.Bin) centres its content.
            text.reactive = true;
            text.track_hover = true;
            text.add_style_class_name('ponitch-notif-open');
            text.connect('button-release-event', (_a, e) => {
                if (!(e.get_source() instanceof St.Button)) // action buttons handle themselves
                    item.activate();
                return Clutter.EVENT_STOP;
            });
            card.add_child(text);
            card.add_child(centered(iconButton('window-close-symbolic', 'small', () => svc.dismiss(item.key))));
            items.add_child(card);
        }
    };
    const unsub = svc.subscribe(deferred(box, draw));
    box.connect('destroy', unsub);
    draw();
    return { actor: box };
}

module.exports = { initNotificationsUI, buildBanner, buildNotificationsTab };
