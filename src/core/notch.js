// Platform-neutral: everything shell-specific comes in through `platform` (PLAN.md §2A).
const { Spring } = require('./spring');
const { parseColor } = require('./color');
const { initMusicUI, buildBar, buildPeek, buildPage } = require('./music_ui');
const { initWidgets, ticker, iconButton, centered } = require('./widgets');
const { buildPanel } = require('./panel_ui');
const { buildHome } = require('./home_ui');
const { buildControl } = require('./control_ui');
const { buildPrayerTab } = require('./prayer_ui');
const { buildTodoTab } = require('./todo_ui');
const { buildPomodoroTab, buildPomodoroFocus, EXPAND_ICON } = require('./pomodoro_ui');
const { buildStopwatchTab } = require('./stopwatch_ui');
const { initNotificationsUI, buildBanner, buildNotificationsTab } = require('./notifications_ui');
const { pickActivity, countdown, POMODORO_ALERTS } = require('./activity');
const { _ } = require('./i18n');

let Clutter, St, GLib;

// Sizes in logical px, from notchy.dev (PLAN.md §4A.3).
const EAR = 18;
const IDLE = { w: 150, h: 24, r: 13 };
const PANEL_H = 336, PANEL_R = 28;
const TUCKED = { w: 120, h: 4, r: 2 };
const FLOAT_GAP = 6;
const HUD = { w: 300, h: 38, r: 19 };
const MUSIC = { w: 290, h: 44, r: 22 };
const PLAYER_PEEK = { w: 400, h: 92, r: 28 };
const TRACK_FLASH_MS = 4000;
const BANNER = { w: 420, h: 64, r: 32 };
const BANNER_MS = 4000;
const TINTS = { green: '#30D158', orange: '#FF9F0A', red: '#FF453A', yellow: '#FFD60A', teal: '#40C8E0' };
const ACTIVITY_ICONS = { prayer: 'daytime-sunset-symbolic', timer: 'alarm-symbolic', todo: 'task-due-symbolic', stopwatch: 'preferences-system-time-symbolic' };
const TOAST_H = 30, TOAST_R = 15;
const HUD_BAR_W = 172;
const HUD_HIDE_MS = 1500; // same as Cinnamon's own OSD
const HOVER_DELAY = 60;
const CONTENT_MS = 260;


var Notch = class Notch {
    constructor(platform, cfg) {
        ({ Clutter, St, GLib } = platform.gi);
        this._platform = platform;
        initWidgets(platform.gi);
        initMusicUI(platform.gi);
        initNotificationsUI(platform.gi);
        this._panelTab = 'home';
        this.cfg = cfg; // { shape, hoverOpensPanel, closeDelay, panelWidth }
        this.state = 'closed';
        this._pinned = false;
        this._timers = {};
        this._springs = { w: new Spring(IDLE.w), h: new Spring(IDLE.h), r: new Spring(IDLE.r) };
        this._ear = -1;
        this._radius = -1;

        this.actor = new St.Widget({ reactive: true, track_hover: true, name: 'ponitch' });
        this._body = new St.Widget({ style_class: 'ponitch-body', layout_manager: new Clutter.BinLayout(), clip_to_allocation: true });
        this._ears = [0, 1].map(side => {
            const ear = new St.DrawingArea();
            ear.connect('repaint', area => this._paintEar(area, side));
            this.actor.add_child(ear);
            return ear;
        });
        this.actor.add_child(this._body);

        this.actor.connect('notify::hover', () => this._onHover());
        this.actor.connect('button-press-event', (_a, event) => {
            if (this._insideButton(event.get_source()))
                return Clutter.EVENT_PROPAGATE; // transport buttons in the peek card handle their own clicks
            if (this.state === 'alert')
                this.setState('closed'); // clicking the alert acknowledges it
            else if (this.state === 'banner') {
                this._banner.activate(); // open the app, like clicking a desktop banner
                this._endBanner();
            }
            else if (this.state !== 'open')
                this.setState('open');
            return Clutter.EVENT_STOP;
        });

        this._timeline = platform.newTimeline(this.actor);
        this._timeline.connect('new-frame', () => this._onFrame());

        platform.addChrome(this.actor);
        this._disconnects = [
            platform.connectMonitorsChanged(() => this._relayout()),
            platform.connectScaleChanged(() => this._relayout()),
        ];

        this.applyConfig();
        this._refresh();
    }

    // Music becomes part of the closed/peek/open content (PLAN.md §4.2).
    // getControl(): returns { power, audio, network, bluetooth } (started on first call), or null
    // when the Control tab is turned off. Called only when the panel opens.
    setControl(getControl) {
        this._getControl = getControl;
        if (this.state === 'open') {
            this._shownKind = null;
            this._refresh();
        }
    }

    // features: { prayer, pomodoro, todo, stopwatch, notifications } services (any may be null). They feed the closed
    // notch's live activity (PLAN.md §5) and the Home/Prayer/Todo panel content.
    setFeatures(features) {
        (this._unsubFeatures || []).forEach(u => u());
        this._features = features;
        if (this.state === 'alert' && !features.pomodoro)
            this.state = 'closed'; // the alert belongs to the pomodoro that was just turned off
        if (!features.pomodoro)
            this._removeFocus();
        this._unsubFeatures = Object.values(features).filter(Boolean).map(s => s.subscribe(() => this._refresh()));
        if (features.pomodoro)
            this._unsubFeatures.push(features.pomodoro.subscribe(() => this._checkPomodoroAlert()));
        this._shownKind = null;
        this._refresh();
    }

    // svc: an MprisService, or null to turn music off.
    setMusic(svc) {
        if (this._unsubMusic)
            this._unsubMusic();
        this._unsubMusic = null;
        this._music = svc;
        if (svc)
            this._unsubMusic = svc.subscribe(t => this._onMusic(t));
        this._onMusic(svc ? svc.current : null);
    }

    destroy() {
        this._destroyed = true;
        if (this._unsubMusic)
            this._unsubMusic();
        (this._unsubFeatures || []).forEach(u => u());
        Object.keys(this._timers).forEach(k => this._clearTimer(k));
        this._removeFocus();
        this._timeline.stop();
        this._disconnects.forEach(d => d());
        this._platform.removeChrome(this.actor);
        this.actor.destroy();
    }

    applyConfig() {
        this._body.set_style_class_name(`ponitch-body ${this.cfg.shape}`);
        // Look (PLAN.md §4.7): one colour + opacity covers black, custom colour and glass.
        const [r, g, b] = parseColor(this.cfg.color) || [0, 0, 0];
        this._bg = [r, g, b, Math.max(0.3, Math.min(1, (this.cfg.opacity || 100) / 100))];
        for (const e of this._ears)
            e.queue_repaint();
        this._ears.forEach(e => e.visible = this.cfg.shape === 'attached');
        this._ear = this._radius = -1;
        this._shownKind = null; // rebuild content so config like the EQ animation applies
        this._refresh();
    }

    toggle() {
        this.setState(this.state === 'open' ? 'closed' : 'open');
    }

    // Pomodoro fills the primary monitor; the notch stays above it and, closed, shows the
    // countdown with a restore button. The same button, the one in the Pomodoro tab, or Esc shrinks it.
    togglePomodoroExpanded() {
        const pomo = this._features && this._features.pomodoro;
        if (this._focus) {
            this._removeFocus();
        } else if (pomo) {
            this._focus = buildPomodoroFocus({ gi: this._platform.gi, pomodoro: pomo });
            this._platform.addChrome(this._focus.actor);
            // Both are shell chrome in the same layer; keep the notch on top of the overlay.
            const parent = this.actor.get_parent();
            if (parent && parent === this._focus.actor.get_parent())
                parent.set_child_above_sibling(this.actor, null);
            this._relayout();
            this._releaseEsc = this._platform.grabKey('Escape', () => this.togglePomodoroExpanded());
            this.state = 'closed'; // out of the way of the countdown (pinned or not)
        }
        this._shownKind = null;
        this._refresh();
    }

    _removeFocus() {
        if (!this._focus)
            return;
        this._releaseEsc();
        this._platform.removeChrome(this._focus.actor);
        this._focus.actor.destroy();
        this._focus = null;
    }

    _relayout() {
        this._apply();
        const mon = this._platform.primaryMonitor();
        if (this._focus && mon)
            this._focus.layout(mon, this._platform.uiScale());
    }

    // Open the panel on tab `id` (unknown ids fall back to the first tab).
    openTab(id) {
        this._panelTab = id;
        if (this.state === 'open' && this._view && this._view.select)
            this._view.select(id);
        else
            this.setState('open');
    }

    setPinned(pinned) {
        this._pinned = pinned;
        if (!pinned)
            this._onHover();
    }

    setState(state) {
        if (state === this.state)
            return;
        if (this.state === 'hud')
            this._clearTimer('hud');
        if (this.state === 'banner')
            this._clearTimer('banner');
        this.state = state;
        this._refresh();
    }

    _playing() {
        return !!this._track && this._track.status === 'Playing';
    }

    // Which content the notch shows now; content is only rebuilt (with the crossfade) when this changes.
    _kind() {
        switch (this.state) {
        case 'open': return 'panel';
        case 'tucked': return 'none';
        case 'hud': return 'hud';
        case 'alert': return `alert:${this._alert.at}`;
        case 'banner': return `banner:${this._bannerRev}`;
        case 'peek': return this._track ? 'player' : 'dot';
        default:
            if (this._focus)
                return 'expanded';
            if (this._activity())
                return `activity:${this._act.key}`;
            return this._playing() ? 'music' : 'dot';
        }
    }

    // Live activity for the closed notch, or null; music and the idle dot come after it.
    _activity() {
        const f = this._features || {};
        this._act = pickActivity({
            now: Date.now(),
            prayer: f.prayer && f.prayer.today ? { next: f.prayer.next, current: f.prayer.current } : null,
            pomodoro: f.pomodoro ? f.pomodoro.view : null,
            todo: f.todo ? f.todo.next : null,
            stopwatch: f.stopwatch ? f.stopwatch.view : null,
        });
        return this._act;
    }

    _refresh() {
        this._retarget();
        const kind = this._kind();
        if (kind !== this._shownKind) {
            this._shownKind = kind;
            this._view = this._buildContent(kind);
            this._setContent(this._view.actor);
        }
        if (this._view.update)
            this._view.update(this._track);
    }

    _onMusic(track) {
        this._track = track;
        // A track that starts playing flashes the player card once while the notch is closed
        // (not again on pause/resume of the same track).
        const key = track && `${track.name}|${track.trackId}|${track.title}`;
        const newTrack = track && track.status === 'Playing' && key !== this._flashedKey;
        if (newTrack)
            this._flashedKey = key;
        if (newTrack && this.state === 'closed') {
            this.setState('peek');
            this._clearTimer('flash');
            this._startTimer('flash', TRACK_FLASH_MS, () => {
                if (this.state === 'peek' && !this.actor.hover)
                    this.setState('closed');
            });
            return;
        }
        this._refresh();
    }

    _buildPanel() {
        const gi = this._platform.gi;
        const control = this._getControl ? this._getControl() : null;
        const f = this._features || {};
        const openTab = id => this._view && this._view.select && this._view.select(id);
        const tabs = [{ id: 'home', icon: 'go-home-symbolic', label: _('Home'), build: () => buildHome({ gi, music: this._music, ...f, openTab }) }];
        if (this._music)
            tabs.push({ id: 'music', icon: 'audio-x-generic-symbolic', label: _('Music'), build: () => buildPage(this._music) });
        if (f.prayer)
            tabs.push({ id: 'prayer', icon: 'daytime-sunset-symbolic', label: _('Prayer'), build: () => buildPrayerTab({ gi, prayer: f.prayer }) });
        if (f.todo)
            tabs.push({ id: 'todo', icon: 'view-list-symbolic', label: _('Todo'), build: () => buildTodoTab({ gi, todo: f.todo, platform: this._platform }) });
        if (f.pomodoro)
            tabs.push({ id: 'pomodoro', icon: 'alarm-symbolic', label: _('Pomodoro'), build: () => buildPomodoroTab({ gi, pomodoro: f.pomodoro,
                expanded: () => !!this._focus, toggleExpanded: () => this.togglePomodoroExpanded() }) });
        if (f.stopwatch)
            tabs.push({ id: 'stopwatch', icon: 'preferences-system-time-symbolic', label: _('Stopwatch'), build: () => buildStopwatchTab({ gi, stopwatch: f.stopwatch }) });
        if (f.notifications)
            tabs.push({ id: 'notifications', icon: 'preferences-system-notifications-symbolic', label: _('Notifications'), build: () => buildNotificationsTab({ gi, notifications: f.notifications }) });
        if (control)
            tabs.push({ id: 'control', icon: 'emblem-system-symbolic', label: _('Control'), build: () => buildControl({ gi, platform: this._platform, ...control }) });
        return buildPanel({
            gi, tabs, tab: this._panelTab, onTab: id => { this._panelTab = id; },
            power: control && control.power, audio: control && control.audio,
            pinned: this._pinned, onPin: on => this.setPinned(on), lock: () => this._platform.lock(),
        });
    }

    // A desktop notification (item from NotificationService). Returns false when the notch can't
    // show it (hidden by a fullscreen window), so the desktop's own banner logic applies.
    showBanner(item) {
        if (this.state === 'open' || this.state === 'alert')
            return true; // it is in the Notifications tab; don't cover the panel or a pomodoro alert
        if (!this.actor.visible)
            return false;
        this._banner = item;
        this._bannerRev = (this._bannerRev || 0) + 1;
        if (this.state !== 'banner') {
            this._bannerReturn = this.state === 'tucked' ? 'tucked' : 'closed';
            this.setState('banner');
        } else {
            this._refresh();
        }
        this._armBanner();
        return true;
    }

    // Normal notifications leave after a few seconds; critical ones wait for a click.
    _armBanner() {
        this._clearTimer('banner');
        if (this._banner.urgency !== 'critical' && !this.actor.hover)
            this._startTimer('banner', BANNER_MS, () => this._endBanner());
    }

    _endBanner() {
        this.setState(this._bannerReturn);
        this._onHover();
    }

    // A pomodoro session ran out: grow to the media-card size and stay until clicked, so it is
    // noticed even with the sound muted. Not while the panel is open (the user is looking).
    _checkPomodoroAlert() {
        const ended = this._features.pomodoro.view.ended;
        if (!ended || ended.at === this._alertSeen)
            return;
        this._alertSeen = ended.at;
        if (this.state === 'open')
            return;
        this._alert = ended;
        this.setState('alert');
    }

    _buildAlert() {
        const info = POMODORO_ALERTS[this._alert.to];
        const tint = TINTS[info.tint];
        const box = new St.BoxLayout({ style_class: 'ponitch-alert', x_expand: true, y_expand: true });
        box.add_child(new St.Icon({ icon_name: 'alarm-symbolic', style_class: 'ponitch-alert-icon', style: `color: ${tint};`, y_align: Clutter.ActorAlign.CENTER }));
        const text = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        text.add_child(new St.Label({ text: _(info.title), style_class: 'ponitch-alert-title' }));
        const sub = new St.Label({ style_class: 'ponitch-alert-sub' });
        text.add_child(sub);
        box.add_child(text);
        box.add_child(new St.Label({ text: _('Click to dismiss'), style_class: 'ponitch-alert-hint', y_align: Clutter.ActorAlign.CENTER }));
        const pomo = this._features.pomodoro;
        ticker(box, 1000, () => {
            const v = pomo.view;
            sub.text = `${v.label} · ${countdown(Date.now() + v.remaining, Date.now())}`;
        });
        return { actor: box };
    }

    // Closed-notch live activity (PLAN.md §5): tinted icon, text, countdown or "Now"/"Done".
    _buildActivity(act) {
        const box = new St.BoxLayout({ style_class: 'ponitch-activity', x_expand: true, y_expand: true });
        const tint = TINTS[act.tint] || '#fff';
        box.add_child(new St.Icon({ icon_name: ACTIVITY_ICONS[act.icon], style_class: 'ponitch-activity-icon', style: `color: ${tint};`, y_align: Clutter.ActorAlign.CENTER }));
        box.add_child(new St.Label({ text: act.text, style_class: 'ponitch-activity-text', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        const right = new St.Label({ style_class: 'ponitch-activity-right', style: `color: ${tint};`, y_align: Clutter.ActorAlign.CENTER });
        box.add_child(right);
        if (act.since)
            ticker(box, 1000, () => { right.text = countdown(Date.now(), act.since); });
        else if (act.until)
            ticker(box, 1000, () => { right.text = countdown(act.until, Date.now()); });
        else
            right.text = act.label === 'now' ? _('Now') : _('Done');
        return { actor: box };
    }

    // Closed notch while the pomodoro is expanded: phase, countdown and the restore button.
    _buildExpanded() {
        const box = new St.BoxLayout({ style_class: 'ponitch-activity', x_expand: true, y_expand: true });
        const tint = TINTS.orange;
        box.add_child(new St.Icon({ icon_name: ACTIVITY_ICONS.timer, style_class: 'ponitch-activity-icon', style: `color: ${tint};`, y_align: Clutter.ActorAlign.CENTER }));
        const label = new St.Label({ style_class: 'ponitch-activity-text', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        const right = new St.Label({ style_class: 'ponitch-activity-right', style: `color: ${tint};`, y_align: Clutter.ActorAlign.CENTER });
        const restore = iconButton(EXPAND_ICON(true), 'small', () => this.togglePomodoroExpanded());
        restore.accessible_name = _('Exit full screen');
        [label, right, centered(restore)].forEach(a => box.add_child(a));
        const pomo = this._features.pomodoro;
        ticker(box, 1000, () => {
            const v = pomo.view;
            label.text = v.label;
            right.text = countdown(Date.now() + v.remaining, Date.now());
        });
        return { actor: box };
    }

    _insideButton(actor) {
        for (let a = actor; a && a !== this.actor; a = a.get_parent()) {
            if (a instanceof St.Button)
                return true;
        }
        return false;
    }

    // info: { icon: Gio.Icon|null, label: string|null, level: 0..1+ or null }.
    // Returns false when the notch can't show it, so the caller falls back to the desktop's own OSD.
    showHud(info) {
        if (this.state === 'open' || !this.actor.visible) // panel open, or hidden by a fullscreen window
            return false;
        this._hud = info;
        if (this.state !== 'hud') {
            this._hudReturn = this.state === 'tucked' || this.state === 'alert' ? this.state : 'closed';
            this.setState('hud');
        } else {
            this._retarget(); // size may change between a level HUD and a label toast
            this._updateHud();
        }
        this._clearTimer('hud');
        this._startTimer('hud', HUD_HIDE_MS, () => {
            this.setState(this._hudReturn);
            this._onHover();
        });
        return true;
    }

    _target() {
        switch (this.state) {
        case 'open': {
            const mon = this._platform.primaryMonitor();
            const maxW = mon ? mon.width / this._platform.uiScale() - 32 : this.cfg.panelWidth;
            return { w: Math.min(this.cfg.panelWidth, maxW), h: PANEL_H, r: PANEL_R };
        }
        // With nothing to show, peek is a small widen as feedback.
        case 'peek': return this._track ? PLAYER_PEEK : { w: IDLE.w + 10, h: IDLE.h, r: IDLE.r };
        case 'tucked': return TUCKED;
        case 'alert': return PLAYER_PEEK;
        case 'banner': return BANNER;
        case 'hud': {
            if (this._hud.level !== null)
                return HUD;
            // shortcut: toast width is estimated from the label length, not measured; measure the laid-out label if it looks off.
            const w = Math.max(160, Math.min(420, 60 + 7 * (this._hud.label || '').length));
            return { w, h: TOAST_H, r: TOAST_R };
        }
        default: return this._focus || this._activity() || this._playing() ? MUSIC : IDLE;
        }
    }

    _retarget() {
        const t = this._target();
        for (const k of ['w', 'h', 'r'])
            this._springs[k].setTarget(t[k]);
        this._lastFrame = -1;
        if (!this._timeline.is_playing())
            this._timeline.start();
        this._apply();
    }

    _onFrame() {
        const now = this._timeline.get_elapsed_time();
        // First frame of a run has no dt yet. Use real elapsed time so slow frames don't stretch the animation;
        // the closed-form spring stays exact for any dt, the cap only guards against a suspend-sized jump.
        const dt = this._lastFrame < 0 ? 0 : Math.min((now - this._lastFrame) / 1000, 0.25);
        this._lastFrame = now;
        let moving = false;
        for (const k of ['w', 'h', 'r'])
            moving = this._springs[k].step(dt) || moving;
        this._apply();
        if (!moving)
            this._timeline.stop(); // no frames once at rest
    }

    _apply() {
        const mon = this._platform.primaryMonitor();
        if (!mon)
            return;
        const s = this._platform.uiScale();
        const w = this._springs.w.value, h = this._springs.h.value;
        const attached = this.cfg.shape === 'attached';
        // Notchy caps the bottom radius at 26 and derives the ear size from it (PLAN.md §4A.2).
        const r = attached
            ? Math.min(this._springs.r.value, 26, w / 2, h / 2)
            : Math.min(this._springs.r.value, w / 2, h / 2);
        const m = attached ? Math.max(0, Math.min(Math.min(r, 26) * EAR / 26, EAR, h / 3, w / 4)) : 0;

        const W = Math.round(w * s), H = Math.round(h * s), M = Math.round(m * s), R = Math.round(r * s);
        this.actor.set_size(W + 2 * M, H);
        this.actor.set_position(
            mon.x + Math.round((mon.width - W - 2 * M) / 2),
            mon.y + (attached ? 0 : Math.round(FLOAT_GAP * s)));
        this._body.set_position(M, 0);
        this._body.set_size(W, H);

        if (R !== this._radius) {
            this._radius = R;
            const bg = `background-color: rgba(${this._bg.join(', ')});`;
            this._body.set_style(attached ? `border-radius: 0 0 ${R}px ${R}px; ${bg}` : `border-radius: ${R}px; ${bg}`);
        }
        if (M !== this._ear) {
            this._ear = M;
            this._ears.forEach(e => {
                e.set_size(M, M);
                e.queue_repaint();
            });
        }
        this._ears[0].set_position(0, 0);
        this._ears[1].set_position(M + W, 0);
    }

    // Concave flare joining the notch to the top screen edge.
    _paintEar(area, side) {
        const cr = area.get_context();
        const [m] = area.get_surface_size();
        if (m > 0) {
            const [r, g, b, a] = this._bg;
            cr.setSourceRGBA(r / 255, g / 255, b / 255, a);
            if (side === 0) {
                cr.moveTo(0, 0);
                cr.lineTo(m, 0);
                cr.lineTo(m, m);
                cr.arcNegative(0, m, m, 0, -Math.PI / 2);
            } else {
                cr.moveTo(m, 0);
                cr.lineTo(0, 0);
                cr.lineTo(0, m);
                cr.arc(m, m, m, Math.PI, 1.5 * Math.PI);
            }
            cr.fill();
        }
        cr.$dispose();
    }

    _onHover() {
        this._clearTimer('enter');
        this._clearTimer('leave');
        if (this.state === 'banner') {
            // Reading it: keep it up while the pointer is on it, count down again after.
            if (this.actor.hover)
                this._clearTimer('banner');
            else
                this._armBanner();
            return;
        }
        if (this.state === 'hud' || this.state === 'alert')
            return; // the HUD ends by itself; the alert stays until clicked
        if (this.actor.hover) {
            if (this.state === 'tucked')
                this.setState('closed');
            else if (this.state === 'closed' && !this._focus) // expanded: keep the restore button in place
                this._startTimer('enter', HOVER_DELAY, () =>
                    this.setState(this.cfg.hoverOpensPanel ? 'open' : 'peek'));
        } else if (!this._pinned && (this.state === 'peek' || this.state === 'open')) {
            this._startTimer('leave', this.cfg.closeDelay, () => this.setState('closed'));
        }
    }

    _startTimer(name, ms, fn) {
        this._timers[name] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            delete this._timers[name];
            fn();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearTimer(name) {
        if (this._timers[name]) {
            GLib.source_remove(this._timers[name]);
            delete this._timers[name];
        }
    }

    // HUD layout from notchy.dev (PLAN.md §4A.4): icon, 172×11 bar, value. A label-only OSD becomes a toast.
    _buildHud() {
        const box = new St.BoxLayout({ style_class: 'ponitch-hud', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        const icon = new St.Icon({ style_class: 'ponitch-hud-icon', y_align: Clutter.ActorAlign.CENTER });
        const track = new St.Widget({ style_class: 'ponitch-hud-track', y_align: Clutter.ActorAlign.CENTER, width: Math.round(HUD_BAR_W * this._platform.uiScale()) });
        const fill = new St.Widget({ style_class: 'ponitch-hud-fill' });
        track.add_child(fill);
        const value = new St.Label({ style_class: 'ponitch-hud-value', y_align: Clutter.ActorAlign.CENTER });
        const label = new St.Label({ style_class: 'ponitch-hud-label', y_align: Clutter.ActorAlign.CENTER, x_expand: true });
        [icon, track, value, label].forEach(a => box.add_child(a));
        this._hudParts = { box, icon, track, fill, value, label };
        this._updateHud(true);
        return box;
    }

    _updateHud(initial = false) {
        const p = this._hudParts, { icon, label, level } = this._hud;
        const isLevel = level !== null;
        p.icon.gicon = icon;
        p.icon.visible = icon !== null;
        p.track.visible = p.value.visible = isLevel;
        p.label.visible = !isLevel && !!label;
        p.box.set_style_class_name(isLevel ? 'ponitch-hud' : 'ponitch-hud toast');
        if (!isLevel) {
            p.label.text = label || '';
            return;
        }
        p.value.text = `${Math.round(level * 100)}%`;
        // Over-amplified volume (>100%) fills the bar; the label still shows the real value.
        const w = Math.round(Math.max(10, HUD_BAR_W * Math.min(level, 1)) * this._platform.uiScale());
        p.fill.remove_all_transitions();
        if (initial)
            p.fill.width = w;
        else
            p.fill.ease({ width: w, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
    }

    // Returns a view: { actor, update?(track) }.
    _buildContent(kind) {
        switch (kind) {
        case 'none': return { actor: new St.Widget() };
        case 'hud': return { actor: this._buildHud() };
        case `banner:${this._bannerRev}`: return buildBanner(this._banner);
        case `alert:${this._alert && this._alert.at}`: return this._buildAlert();
        case 'music': return buildBar({ animateEq: this.cfg.musicAnimateEq });
        case 'expanded': return this._buildExpanded();
        case `activity:${this._act && this._act.key}`: return this._buildActivity(this._act);
        case 'player': return buildPeek(this._music);
        case 'panel': return this._buildPanel();
        default:
            return { actor: new St.Widget({ style_class: 'ponitch-dot', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER }) };
        }
    }

    // Old content leaves (fade, up 5 px), then new content enters (fade, from 7 px below): PLAN.md §4A.1.
    _setContent(next) {
        const prev = this._content;
        this._content = next;
        next.opacity = 0;
        next.translation_y = 7;
        const enter = () => {
            if (this._destroyed)
                return;
            if (this._content !== next)
                return next.destroy(); // superseded while the old content was leaving
            this._body.add_child(next);
            next.ease({ opacity: 255, translation_y: 0, duration: CONTENT_MS, mode: Clutter.AnimationMode.EASE_OUT_QUINT });
        };
        // An unparented prev is still waiting for its own enter(), which will destroy it.
        if (!prev || !prev.get_parent())
            return enter();
        prev.remove_all_transitions();
        prev.ease({
            opacity: 0, translation_y: -5, duration: CONTENT_MS, mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            onComplete: () => {
                prev.destroy();
                enter();
            },
        });
    }
};

module.exports = { Notch };
