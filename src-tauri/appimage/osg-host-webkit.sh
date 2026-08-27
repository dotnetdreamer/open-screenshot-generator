# Prefer the host WebKitGTK over the bundled one when the host has a complete
# stack of its own. Sourced from AppRun before linuxdeploy's own GTK hook.
#
# The AppImage carries the WebKitGTK it was built against. That build happens
# on ubuntu-22.04 so the binary links the oldest glibc we support, which also
# means the bundle ships a 2022 WebKit. On distros whose Mesa has moved on -
# Arch, CachyOS, Fedora - that WebKit cannot create an EGL display. Both of its
# helper processes abort with
#
#   Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
#
# the main process survives, and splash.rs's fallback timer then reveals a main
# window that never painted. That is the white screen of issues #25 and #28.
# None of the usual WEBKIT_DISABLE_DMABUF_RENDERER / WEBKIT_DISABLE_COMPOSITING_MODE
# workarounds help, because the failure is in EGL display creation itself and
# happens before any renderer choice is made.
#
# So when the host has its own webkit2gtk-4.1 and the GTK stack that goes with
# it, run against that instead. It is what the .deb already does and the only
# configuration a rolling distro actually tests. Hosts without it - the older
# distros the bundle exists for in the first place - are untouched and keep
# using the bundled stack.
#
# OSG_APPIMAGE_STACK=host or =bundled forces one path and skips the probe.

osg_host_lib_dirs() {
    local dir dirs=
    # Debian/Ubuntu multiarch, then Fedora/openSUSE, then Arch and the rest.
    for dir in /lib/x86_64-linux-gnu /usr/lib/x86_64-linux-gnu /lib64 /usr/lib64 /lib /usr/lib; do
        [ -d "$dir" ] && dirs="${dirs:+$dirs:}$dir"
    done
    printf '%s' "$dirs"
}

# Where the host WebKit will look for WebKitWebProcess and WebKitNetworkProcess.
#
# That path is fixed when WebKit is compiled and distros do not agree on it:
# Debian and Arch keep it beside the library, Fedora and openSUSE put it under
# libexec, Nix puts it in the store. Guessing it wrong is not harmless - the
# first version of this hook only looked beside the library, so it rejected
# every Fedora host and left them on the bundled WebKit, which is issue #28.
# WEBKIT_EXEC_PATH would settle it but current WebKitGTK no longer reads it, so
# read the compiled-in path out of the library instead and only fall back to
# guessing when that turns up nothing.
osg_webkit_helper_dir() {
    local lib="$1" libdir candidate
    libdir="$(dirname "$lib")"

    for candidate in \
        $(grep -aoE '/[[:alnum:]_./+-]*/webkit2gtk-4\.1' "$lib" 2>/dev/null | sort -u) \
        "$libdir/webkit2gtk-4.1" \
        "$(dirname "$libdir")/libexec/webkit2gtk-4.1" \
        /usr/libexec/webkit2gtk-4.1
    do
        if [ -x "$candidate/WebKitNetworkProcess" ] && [ -x "$candidate/WebKitWebProcess" ]; then
            printf '%s' "$candidate"
            return 0
        fi
    done

    return 1
}

# True when every library of the web stack resolves to a host copy. The binary
# has RUNPATH $ORIGIN/../lib, so a library the host is missing silently falls
# back into the bundle; a half-host stack is worse than either whole one, so
# any such fallback disqualifies the host.
osg_host_stack_usable() {
    local dirs="$1" bin="$2" appdir="$3" out lib resolved

    command -v ldd >/dev/null 2>&1 || return 1
    out="$(LD_LIBRARY_PATH="$dirs" ldd "$bin" 2>/dev/null)" || return 1
    case "$out" in
        '') return 1 ;;
        *'not found'*) return 1 ;;
    esac

    for lib in libwebkit2gtk-4.1.so.0 libjavascriptcoregtk-4.1.so.0 \
               libsoup-3.0.so.0 libgtk-3.so.0 libglib-2.0.so.0; do
        resolved="$(printf '%s\n' "$out" | sed -n "s|.*[[:space:]]$lib => \([^ ]*\).*|\1|p" | head -n1)"
        [ -n "$resolved" ] || return 1
        case "$resolved" in
            "$appdir"/*) return 1 ;;
        esac
    done

    # A host library with no helper processes to spawn would only fail once the
    # window was already up, so rule it out now.
    resolved="$(printf '%s\n' "$out" | sed -n 's|.*[[:space:]]libwebkit2gtk-4.1.so.0 => \([^ ]*\).*|\1|p' | head -n1)"
    osg_webkit_helper_dir "$resolved" >/dev/null || return 1

    return 0
}

osg_run_on_host_stack() {
    local dirs="$1" bin="$2"

    # The bundle's module caches describe the bundled GTK, so none of them apply
    # to the host one. linuxdeploy's GTK hook has not run yet, but a nested
    # launch or a user environment can still have set them.
    unset GTK_PATH GTK_EXE_PREFIX GTK_DATA_PREFIX GTK_IM_MODULE_FILE \
          GDK_PIXBUF_MODULE_FILE GIO_EXTRA_MODULES GSETTINGS_SCHEMA_DIR GTK_THEME

    # LD_LIBRARY_PATH is searched before the binary's RUNPATH, which is how the
    # host copies win over the bundled ones without patching the ELF.
    export LD_LIBRARY_PATH="$dirs"

    # Match what the bundled path does. linuxdeploy forces the X11 backend
    # because the GTK it ships crashes on Wayland (tauri-apps/tauri#8541), and
    # holding that constant keeps this change to one variable: which WebKit
    # runs, not which display protocol it runs on.
    export GDK_BACKEND="${GDK_BACKEND:-x11}"

    exec "$bin" "$@"
}

osg_select_stack() {
    local appdir="$1"; shift
    local bin_name bin dirs

    [ "${OSG_APPIMAGE_STACK:-}" = "bundled" ] && return 0

    bin_name="$(awk -F= '/^Exec=/ { print $2; exit }' "$appdir"/*.desktop 2>/dev/null | awk '{ print $1 }')"
    bin="$appdir/usr/bin/$bin_name"
    [ -n "$bin_name" ] && [ -x "$bin" ] || return 0

    dirs="$(osg_host_lib_dirs)"
    [ -n "$dirs" ] || return 0

    if [ "${OSG_APPIMAGE_STACK:-}" = "host" ] || osg_host_stack_usable "$dirs" "$bin" "$appdir"; then
        osg_run_on_host_stack "$dirs" "$bin" "$@"
    fi

    return 0
}

osg_select_stack "$this_dir" "$@"
