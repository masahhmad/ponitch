# ponitch

Notch interaktif ala Dynamic Island untuk desktop Linux berbasis **Cinnamon** (Linux Mint) dan **GNOME Shell 46+** (Ubuntu).
Status: Cinnamon jalan (M0). Dukungan GNOME menyusul (milestone MG). Rencana lengkap: [PLAN.md](PLAN.md).

Lisensi: GPL-3.0-or-later.

## Pasang

```sh
./install.sh   # deteksi desktop, build, symlink extension + ~/.local/bin/notchctl
```

Lalu aktifkan **ponitch** di pengaturan Extensions desktopmu. Notch muncul di monitor primary.

## Pakai

- Hover: mengintip. Klik atau `Alt+N`: buka panel. Pointer keluar: tutup.
- `notchctl toggle|open|close|tuck|untuck|pin|unpin|state`

## Struktur

- `src/core/`: kode bersama, netral platform (tanpa `imports.*`, `Main`, `global`).
- `src/cinnamon/`, `src/gnome/`: adapter per desktop.
- `python3 build.py [cinnamon|gnome|all]` → `dist/<desktop>/ponitch@masahhmad/`. Untuk GNOME, modul core diubah ke ESM.

## Tes

```sh
node tests/test_spring.js
node tests/test_color.js
node tests/test_calendar.js
node tests/test_praytimes.js
node tests/test_m3_logic.js
python3 tests/test_build.py
```

Uji musik tanpa aplikasi musik asli: `python3 tests/fake_mpris.py` menjalankan player MPRIS palsu yang bisa dikendalikan lewat D-Bus (`dev.ponitch.Test.SetTrack/SetStatus`, lihat docstring).

## Catatan pengembangan

- Setelah mengubah kode: `./install.sh`, lalu nonaktif/aktifkan extension.
- Cinnamon meng-cache stylesheet. Setelah mengubah `stylesheet.css`, jalankan `Main.themeManager._changeTheme()` di Looking Glass (`Alt+F2` → `lg`) atau restart Cinnamon. **Jangan** `Main.loadTheme()`: ia membuang stylesheet semua applet/extension dari tema aktif.
- Log Cinnamon: `~/.xsession-errors`.
- Jangan pakai `box-shadow` pada notch: St mem-blur ulang di CPU tiap ukuran berubah (PLAN.md §4A.6).

## Copot

```sh
./uninstall.sh
```
