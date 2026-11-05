// "Up next" on Home and the Todo tab (PLAN.md §4.5).
const { iconButton, centered, setScrollChild, deferred } = require('./widgets');

let Clutter, St;

const when = due => {
    if (due === null)
        return '';
    const d = new Date(due), today = new Date();
    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (d.toDateString() === today.toDateString())
        return t;
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    return d.toDateString() === tomorrow.toDateString() ? `Tomorrow ${t}` : `${d.getDate()}/${d.getMonth() + 1} ${t}`;
};

// ctx: { gi, todo, openTab }
function buildUpNext(ctx) {
    ({ Clutter, St } = ctx.gi);
    const box = new St.BoxLayout({ vertical: true, style_class: 'ponitch-section ponitch-upnext', x_expand: true });
    const head = new St.BoxLayout({ style_class: 'ponitch-section-title' });
    head.add_child(new St.Label({ text: 'UP NEXT', style_class: 'ponitch-upnext-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
    head.add_child(centered(iconButton('list-add-symbolic', 'round', () => ctx.openTab('todo'))));
    const items = new St.BoxLayout({ vertical: true, style_class: 'ponitch-upnext-items' });
    box.add_child(head);
    box.add_child(items);
    const draw = () => {
        items.destroy_all_children();
        const open = ctx.todo.list.filter(t => !t.done).slice(0, 4);
        if (!open.length)
            items.add_child(new St.Label({ text: 'Nothing to do', style_class: 'ponitch-muted' }));
        for (const t of open) {
            const row = new St.BoxLayout({ style_class: 'ponitch-upnext-row' + (t.due !== null && t.due < Date.now() ? ' overdue' : '') });
            row.add_child(new St.Widget({ style_class: 'ponitch-upnext-bar' }));
            const text = new St.BoxLayout({ vertical: true, x_expand: true });
            text.add_child(new St.Label({ text: t.title, style_class: 'ponitch-upnext-name' }));
            if (t.due !== null)
                text.add_child(new St.Label({ text: when(t.due), style_class: 'ponitch-upnext-when' }));
            row.add_child(text);
            items.add_child(row);
        }
    };
    const unsub = ctx.todo.subscribe(draw);
    box.connect('destroy', unsub);
    draw();
    return box;
}

// ctx: { gi, todo, platform }
function buildTodoTab(ctx) {
    ({ Clutter, St } = ctx.gi);
    const box = new St.BoxLayout({ vertical: true, style_class: 'ponitch-todo', x_expand: true, y_expand: true });
    const entry = new St.Entry({ style_class: 'ponitch-entry', hint_text: 'Add a task… e.g. "Send report @15:30" or "besok Rapat"', can_focus: true, x_expand: true });
    const scroll = new St.ScrollView({ style_class: 'ponitch-list-scroll', x_expand: true, y_expand: true });
    scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    const items = new St.BoxLayout({ vertical: true, style_class: 'ponitch-list-items' });
    setScrollChild(scroll, items);
    box.add_child(entry);
    box.add_child(scroll);

    // The notch is shell chrome: typing needs a modal keyboard grab, held only while editing.
    let release = null;
    const stopEditing = () => {
        if (release)
            release();
        release = null;
    };
    entry.clutter_text.connect('button-press-event', () => {
        if (!release)
            release = ctx.platform.grabKeyboard(entry);
        return Clutter.EVENT_PROPAGATE;
    });
    entry.clutter_text.connect('activate', () => {
        ctx.todo.add(entry.get_text());
        entry.set_text('');
    });
    entry.clutter_text.connect('key-press-event', (_a, e) => {
        if (e.get_key_symbol() === Clutter.KEY_Escape) {
            entry.set_text('');
            stopEditing();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    box.connect('destroy', stopEditing);

    const draw = () => {
        items.destroy_all_children();
        const all = ctx.todo.list;
        if (!all.length)
            items.add_child(new St.Label({ text: 'No tasks yet', style_class: 'ponitch-muted' }));
        for (const t of all.slice(0, 50)) {
            const row = new St.BoxLayout({ style_class: 'ponitch-todo-row' + (t.done ? ' done' : '') });
            const check = iconButton(t.done ? 'checkbox-checked-symbolic' : 'checkbox-symbolic', 'small', () => ctx.todo.toggle(t.id));
            row.add_child(centered(check));
            row.add_child(new St.Label({ text: t.title, style_class: 'ponitch-todo-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
            row.add_child(new St.Label({ text: when(t.due), style_class: 'ponitch-row-detail', y_align: Clutter.ActorAlign.CENTER }));
            row.add_child(centered(iconButton('edit-delete-symbolic', 'small', () => ctx.todo.remove(t.id))));
            items.add_child(row);
        }
    };
    const unsub = ctx.todo.subscribe(deferred(box, draw));
    box.connect('destroy', unsub);
    draw();
    return { actor: box };
}

module.exports = { buildUpNext, buildTodoTab };
