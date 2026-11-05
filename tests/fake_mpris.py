#!/usr/bin/env python3
"""A scriptable MPRIS player for testing ponitch's music support.

  python3 tests/fake_mpris.py [suffix]     # owns org.mpris.MediaPlayer2.ponitchtest[suffix]

Besides org.mpris.MediaPlayer2(.Player) it exposes dev.ponitch.Test on the same path:
  SetTrack(s title, s artist, s artUrl, x lengthUs)  new track, emits PropertiesChanged
  SetStatus(s status)                                Playing / Paused / Stopped
  Calls -> as                                        player methods received so far
"""
import sys

import gi
gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

PATH = "/org/mpris/MediaPlayer2"
XML = """
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/><method name="Quit"/>
    <property name="Identity" type="s" access="read"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="HasTrackList" type="b" access="read"/>
    <property name="SupportedUriSchemes" type="as" access="read"/>
    <property name="SupportedMimeTypes" type="as" access="read"/>
  </interface>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/><method name="Previous"/><method name="Pause"/>
    <method name="PlayPause"/><method name="Stop"/><method name="Play"/>
    <method name="Seek"><arg direction="in" name="Offset" type="x"/></method>
    <method name="SetPosition"><arg direction="in" name="TrackId" type="o"/><arg direction="in" name="Position" type="x"/></method>
    <method name="OpenUri"><arg direction="in" name="Uri" type="s"/></method>
    <signal name="Seeked"><arg name="Position" type="x"/></signal>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Rate" type="d" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Volume" type="d" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="MinimumRate" type="d" access="read"/>
    <property name="MaximumRate" type="d" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
  <interface name="dev.ponitch.Test">
    <method name="SetTrack"><arg direction="in" type="s"/><arg direction="in" type="s"/><arg direction="in" type="s"/><arg direction="in" type="x"/></method>
    <method name="SetStatus"><arg direction="in" type="s"/></method>
    <property name="Calls" type="as" access="read"/>
  </interface>
</node>
"""


class Player:
    def __init__(self, suffix):
        self.name = "org.mpris.MediaPlayer2.ponitchtest" + suffix
        self.status = "Stopped"
        self.track = 0
        self.title, self.artist, self.art, self.length = "", "", "", 0
        self.pos_us, self.pos_at = 0, GLib.get_monotonic_time()
        self.calls = []
        self.conn = None

    def position(self):
        if self.status == "Playing":
            return self.pos_us + (GLib.get_monotonic_time() - self.pos_at)
        return self.pos_us

    def set_pos(self, us):
        self.pos_us, self.pos_at = max(0, us), GLib.get_monotonic_time()

    def metadata(self):
        md = {"mpris:trackid": GLib.Variant("o", f"/dev/ponitch/track/{self.track}")}
        if self.title:
            md["xesam:title"] = GLib.Variant("s", self.title)
        if self.artist:
            md["xesam:artist"] = GLib.Variant("as", [self.artist])
        if self.art:
            md["mpris:artUrl"] = GLib.Variant("s", self.art)
        if self.length:
            md["mpris:length"] = GLib.Variant("x", self.length)
        return md

    def prop(self, iface, name):
        player = {
            "PlaybackStatus": GLib.Variant("s", self.status),
            "Rate": GLib.Variant("d", 1.0),
            "Metadata": GLib.Variant("a{sv}", self.metadata()),
            "Volume": GLib.Variant("d", 1.0),
            "Position": GLib.Variant("x", int(self.position())),
            "MinimumRate": GLib.Variant("d", 1.0),
            "MaximumRate": GLib.Variant("d", 1.0),
            "CanGoNext": GLib.Variant("b", True),
            "CanGoPrevious": GLib.Variant("b", True),
            "CanPlay": GLib.Variant("b", True),
            "CanPause": GLib.Variant("b", True),
            "CanSeek": GLib.Variant("b", True),
            "CanControl": GLib.Variant("b", True),
        }
        root = {
            "Identity": GLib.Variant("s", "Ponitch Test Player"),
            "CanQuit": GLib.Variant("b", False),
            "CanRaise": GLib.Variant("b", False),
            "HasTrackList": GLib.Variant("b", False),
            "SupportedUriSchemes": GLib.Variant("as", []),
            "SupportedMimeTypes": GLib.Variant("as", []),
        }
        test = {"Calls": GLib.Variant("as", self.calls)}
        return {"org.mpris.MediaPlayer2": root, "org.mpris.MediaPlayer2.Player": player, "dev.ponitch.Test": test}[iface][name]

    def changed(self, *names):
        props = {n: self.prop("org.mpris.MediaPlayer2.Player", n) for n in names}
        self.conn.emit_signal(None, PATH, "org.freedesktop.DBus.Properties", "PropertiesChanged",
                              GLib.Variant("(sa{sv}as)", ("org.mpris.MediaPlayer2.Player", props, [])))

    def on_call(self, conn, sender, path, iface, method, params, invocation):
        args = params.unpack()
        if iface != "dev.ponitch.Test":
            self.calls.append(method if not args else f"{method}{list(args)}")
        if method == "SetTrack":
            self.track += 1
            self.title, self.artist, self.art, self.length = args
            self.set_pos(0)
            self.changed("Metadata")
        elif method == "SetStatus":
            self.set_pos(self.position())
            self.status = args[0]
            self.changed("PlaybackStatus")
        elif method in ("PlayPause", "Play", "Pause"):
            self.set_pos(self.position())
            self.status = {"PlayPause": "Paused" if self.status == "Playing" else "Playing",
                           "Play": "Playing", "Pause": "Paused"}[method]
            self.changed("PlaybackStatus")
        elif method in ("Next", "Previous"):
            self.track += 1
            self.title = f"{method} track {self.track}"
            self.set_pos(0)
            self.changed("Metadata")
        elif method == "SetPosition":
            track_id, us = args
            if track_id == f"/dev/ponitch/track/{self.track}":
                self.set_pos(us)
                conn.emit_signal(None, PATH, "org.mpris.MediaPlayer2.Player", "Seeked", GLib.Variant("(x)", (us,)))
        elif method == "Seek":
            self.set_pos(self.position() + args[0])
            conn.emit_signal(None, PATH, "org.mpris.MediaPlayer2.Player", "Seeked", GLib.Variant("(x)", (int(self.position()),)))
        invocation.return_value(None)

    def on_get(self, conn, sender, path, iface, name):
        return self.prop(iface, name)


def main():
    player = Player(sys.argv[1] if len(sys.argv) > 1 else "")
    info = Gio.DBusNodeInfo.new_for_xml(XML)
    loop = GLib.MainLoop()

    def on_bus(conn, _name):
        player.conn = conn
        for iface in info.interfaces:
            conn.register_object(PATH, iface, player.on_call, player.on_get, None)

    Gio.bus_own_name(Gio.BusType.SESSION, player.name, Gio.BusNameOwnerFlags.NONE, on_bus,
                     lambda *_: print("ready", player.name, flush=True), lambda *_: loop.quit())
    try:
        loop.run()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
