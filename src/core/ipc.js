const MAX_LINE = 4096;

let Gio, GLib;

// One JSON object per line in, one per line out, then the connection closes.
var IpcServer = class IpcServer {
    constructor(platform, handler) {
        ({ Gio, GLib } = platform.gi);
        this._handler = handler;
        this.path = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'ponitch.sock']);
    }

    start() {
        // A previous Cinnamon run (crash/restart) leaves the socket file behind.
        GLib.unlink(this.path);
        this._service = new Gio.SocketService();
        this._service.add_address(Gio.UnixSocketAddress.new(this.path), Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);
        this._service.connect('incoming', (_svc, conn) => {
            this._serve(conn);
            return true;
        });
        this._service.start();
    }

    stop() {
        if (!this._service)
            return;
        this._service.stop();
        this._service.close();
        this._service = null;
        GLib.unlink(this.path);
    }

    _serve(conn) {
        const input = new Gio.DataInputStream({ base_stream: conn.get_input_stream() });
        input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
            let reply;
            try {
                const [line] = stream.read_line_finish_utf8(res);
                if (line === null || line.length > MAX_LINE)
                    throw new Error('bad request');
                const req = JSON.parse(line);
                if (typeof req !== 'object' || req === null || typeof req.cmd !== 'string')
                    throw new Error('missing cmd');
                reply = this._handler(req);
            } catch (e) {
                reply = { ok: false, error: e.message };
            }
            const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(reply) + '\n'));
            conn.get_output_stream().write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, (out, r) => {
                try {
                    out.write_bytes_finish(r);
                } catch (e) {
                    // client went away; nothing to report to
                }
                conn.close_async(GLib.PRIORITY_DEFAULT, null, null);
            });
        });
    }
};

module.exports = { IpcServer };
