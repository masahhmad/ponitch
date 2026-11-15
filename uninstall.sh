#!/bin/sh
# Removes only the symlinks install.sh created. Settings and data are kept.
set -eu
uuid=ponitch@masahhmad
for extdir in "$HOME/.local/share/cinnamon/extensions" "$HOME/.local/share/gnome-shell/extensions"; do
    if [ -L "$extdir/$uuid" ]; then rm "$extdir/$uuid"; fi
done
if [ -L "$HOME/.local/bin/notchctl" ]; then rm "$HOME/.local/bin/notchctl"; fi
for mo in "$HOME"/.local/share/locale/*/LC_MESSAGES/"$uuid.mo"; do
    if [ -L "$mo" ]; then rm "$mo"; fi
done
echo "Uninstalled. Disable 'ponitch' in your desktop's Extensions settings if it is still listed."
