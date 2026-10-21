#!/bin/sh
# Install the HUD Plymouth theme (the disk passphrase screen, black and white),
# make it the default and rebuild the initramfs:
#   doas sh ~/.local/src/plymouth-hud/install.sh      (or sudo)
set -eu
user=${DOAS_USER:-${SUDO_USER:-}}
[ -n "$user" ] || { echo "run this with doas (or sudo)" >&2; exit 1; }
here=$(dirname "$0")
dir=/usr/share/plymouth/themes/hud

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
python3 -I "$here/generate.py" "$tmp"
mkdir -p "$dir"
cp "$tmp"/* "$dir"/
chmod 644 "$dir"/*

if command -v plymouth-set-default-theme >/dev/null; then
    plymouth-set-default-theme hud
fi
# rebuild the initramfs so the new theme is there before the disk is unlocked
if command -v mkinitcpio >/dev/null; then mkinitcpio -P
elif command -v dracut >/dev/null; then dracut --force --regenerate-all
elif command -v update-initramfs >/dev/null; then update-initramfs -u -k all
fi
echo "installed $dir"
