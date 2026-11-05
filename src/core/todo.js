// Todos (PLAN.md §4.5), stored in ~/.local/share/ponitch/todos.json.
const { Emitter } = require('./emitter');
const { parseTodo } = require('./todo_parse');
const { initStore, dataPath, readJson, writeJson, setAside, onResume, at } = require('./store');

const WINDOW_MS = 15 * 60 * 1000; // same window the closed notch uses (activity.js)

const valid = t => t && typeof t.id === 'string' && typeof t.title === 'string' && typeof t.done === 'boolean' &&
    (t.due === null || Number.isFinite(t.due));

var TodoService = class TodoService extends Emitter {
    constructor(platform) {
        super();
        initStore(platform.gi);
        this.items = [];
        this._cancelTimer = () => {};
        this._file = dataPath('todos.json');
    }

    start() {
        this._unResume = onResume(() => this._changed(false));
        readJson(this._file, (items, broken) => {
            // A damaged list is kept aside rather than overwritten by the next save.
            if (broken || (items !== null && !Array.isArray(items)))
                setAside(this._file);
            const added = this.items; // todos added before the file finished loading
            if (Array.isArray(items))
                this.items = items.filter(valid).concat(added);
            this._loaded = true;
            this._changed(added.length > 0);
        });
    }

    stop() {
        this._cancelTimer();
        this._unResume();
    }

    add(text) {
        const { title, due } = parseTodo(text);
        if (!title)
            return;
        this.items.push({ id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`, title, due, done: false, created: Date.now() });
        this._changed(true);
    }

    toggle(id) {
        const t = this.items.find(x => x.id === id);
        if (t) {
            t.done = !t.done;
            this._changed(true);
        }
    }

    remove(id) {
        this.items = this.items.filter(x => x.id !== id);
        this._changed(true);
    }

    // Open first (by due time, undated last), then done.
    get list() {
        const key = t => [t.done ? 1 : 0, t.due === null ? Infinity : t.due, t.created];
        return [...this.items].sort((a, b) => {
            const ka = key(a), kb = key(b);
            return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
        });
    }

    // Nearest open todo with a due time that is not long past.
    get next() {
        const now = Date.now();
        return this.list.find(t => !t.done && t.due !== null && t.due > now - WINDOW_MS) || null;
    }

    _changed(save) {
        if (save && this._loaded)
            writeJson(this._file, this.items);
        this._cancelTimer();
        const now = Date.now();
        const points = this.items.filter(t => !t.done && t.due !== null)
            .flatMap(t => [t.due - WINDOW_MS, t.due, t.due + WINDOW_MS]).filter(p => p > now);
        if (points.length)
            this._cancelTimer = at(Math.min(...points), () => this._changed(false));
        this._emit();
    }
};

module.exports = { TodoService };
