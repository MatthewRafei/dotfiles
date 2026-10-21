#!/usr/bin/env python3
"""Build the HUD Plymouth theme: black and white, so it never needs rebuilding
when the wallpaper changes.

  generate.py OUTDIR

Writes hud.plymouth, hud.script and the images it uses into OUTDIR.
install.sh runs this and installs the result.
"""
import os
import shutil
import socket
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))

# the palette keys wallpaper-theme uses, in greys
MONO = {
    "text": "#f2f2f2",
    "textDim": "#9a9a9a",
    "textFaint": "#5c5c5c",
    "accent": "#ffffff",       # bullets, cursor, progress, header square
    "danger": "#ffffff",       # wrong passphrase: bright against the faint hint
    "bgPanel": "#000000",
    "bgCard": "#0d0d0d",
    "borderAccent": "#3a3a3a",
    "trackBg": "#1c1c1c",
}


def rgb(hexcolor):
    h = hexcolor.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def png(path, color, alpha=255):
    """a 1x1 PNG of one colour; the script scales it to size"""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    raw = b"\x00" + bytes(rgb(color)) + bytes([alpha])
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw)))
        f.write(chunk(b"IEND", b""))


def floats(hexcolor):
    return ", ".join(f"{c / 255:.3f}" for c in rgb(hexcolor))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = sys.argv[1]
    p = MONO
    os.makedirs(out, exist_ok=True)

    colors = []
    for name, key in (("text", "text"), ("dim", "textDim"), ("faint", "textFaint"),
                      ("accent", "accent"), ("danger", "danger")):
        r, g, b = (f"{c / 255:.3f}" for c in rgb(p[key]))
        colors.append(f"{name}.r = {r}; {name}.g = {g}; {name}.b = {b};")
    host = socket.gethostname().split(".")[0].upper()

    with open(os.path.join(HERE, "hud.script")) as f:
        script = f.read()
    script = (script.replace("@COLORS@", "\n".join(colors))
                    .replace("@HOST@", host)
                    .replace("@BG@", floats(p["bgPanel"])))
    with open(os.path.join(out, "hud.script"), "w") as f:
        f.write(script)
    shutil.copy(os.path.join(HERE, "hud.plymouth"), out)

    png(os.path.join(out, "accent.png"), p["accent"])
    png(os.path.join(out, "border.png"), p["borderAccent"])
    png(os.path.join(out, "card.png"), p["bgCard"], 230)
    png(os.path.join(out, "track.png"), p["trackBg"])

    png(os.path.join(out, "background.png"), p["bgPanel"])
    print(f"theme written to {out} (host {host})")


if __name__ == "__main__":
    main()
