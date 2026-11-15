#!/bin/sh
# Builds the extension for this desktop and symlinks it into place, plus notchctl.
#   ./install.sh            detect the desktop from XDG_CURRENT_DESKTOP
#   ./install.sh cinnamon   force a desktop
set -eu
here=$(cd "$(dirname "$0")" && pwd)
uuid=ponitch@masahhmad

desktop=${1:-}
if [ -z "$desktop" ]; then
    case "${XDG_CURRENT_DESKTOP:-}" in
        *Cinnamon*) desktop=cinnamon ;;
        *GNOME*) desktop=gnome ;;
        *) echo "install: unsupported desktop '${XDG_CURRENT_DESKTOP:-unknown}' (ponitch supports Cinnamon and GNOME)" >&2; exit 1 ;;
    esac
fi
case "$desktop" in
    cinnamon) extdir="$HOME/.local/share/cinnamon/extensions" ;;
    gnome) extdir="$HOME/.local/share/gnome-shell/extensions" ;;
    *) echo "install: unknown desktop '$desktop'" >&2; exit 1 ;;
esac

python3 "$here/build.py" "$desktop" >/dev/null

mkdir -p "$extdir" "$HOME/.local/bin"
if [ -e "$extdir/$uuid" ] && [ ! -L "$extdir/$uuid" ]; then
    echo "install: $extdir/$uuid exists and is not a symlink; remove it first" >&2
    exit 1
fi
ln -sfn "$here/dist/$desktop/$uuid" "$extdir/$uuid"
if [ "$desktop" = cinnamon ]; then
    # Cinnamon (and its settings window) read xlet translations from ~/.local/share/locale.
    for mo in "$here/dist/cinnamon/$uuid"/locale/*/LC_MESSAGES/"$uuid.mo"; do
        [ -e "$mo" ] || continue
        lang=$(basename "$(dirname "$(dirname "$mo")")")
        mkdir -p "$HOME/.local/share/locale/$lang/LC_MESSAGES"
        ln -sf "$mo" "$HOME/.local/share/locale/$lang/LC_MESSAGES/$uuid.mo"
    done
fi
chmod +x "$here/bin/notchctl"
ln -sf "$here/bin/notchctl" "$HOME/.local/bin/notchctl"
echo "Installed for $desktop. Enable 'ponitch' in your desktop's Extensions settings."
