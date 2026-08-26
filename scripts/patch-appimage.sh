#!/usr/bin/env bash
#
# Rebuild a Tauri AppImage with the host-WebKitGTK hook in its AppRun.
#
# Tauri hands linuxdeploy the AppDir and linuxdeploy writes AppRun itself, so
# there is no supported hook point for this: the AppImage is unpacked, AppRun
# gains one source line, and it is packed again. See
# src-tauri/appimage/osg-host-webkit.sh for what the hook does and why.
#
# Usage: scripts/patch-appimage.sh path/to/App.AppImage
set -euo pipefail

appimage="${1:?usage: patch-appimage.sh <AppImage>}"
appimage="$(readlink -f "$appimage")"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook="$repo/src-tauri/appimage/osg-host-webkit.sh"

[ -f "$hook" ] || { echo "missing hook: $hook" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# --appimage-extract needs no FUSE, which CI runners do not have.
( cd "$work" && "$appimage" --appimage-extract >/dev/null )
appdir="$work/squashfs-root"
[ -f "$appdir/AppRun" ] || { echo "no AppRun in $appimage" >&2; exit 1; }

if grep -q osg-host-webkit "$appdir/AppRun"; then
    echo "already patched: $appimage"
    exit 0
fi

install -m 0755 "$hook" "$appdir/apprun-hooks/osg-host-webkit.sh"

# Insert ahead of the exec, so the hook can still fall through to the bundled
# path by simply returning. Matching the exec rather than a fixed line number
# keeps this working if linuxdeploy reshuffles its preamble.
awk '
    /^exec / && !done { print "source \"$this_dir\"/apprun-hooks/osg-host-webkit.sh"; done = 1 }
    { print }
' "$appdir/AppRun" > "$appdir/AppRun.new"
grep -q osg-host-webkit "$appdir/AppRun.new" || { echo "could not find exec line in AppRun" >&2; exit 1; }
mv "$appdir/AppRun.new" "$appdir/AppRun"
chmod 0755 "$appdir/AppRun"

if ! command -v appimagetool >/dev/null 2>&1; then
    echo "appimagetool not on PATH" >&2
    exit 1
fi

ARCH="${ARCH:-x86_64}" appimagetool "$appdir" "$appimage" >/dev/null
echo "patched: $appimage"
