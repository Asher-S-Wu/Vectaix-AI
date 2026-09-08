#!/bin/bash
set -e

# ============================================================================
# PRoot Android Build Script (OpenMinis fork)
# ============================================================================
# Cross-compiles a statically-linked libtalloc and the OpenMinis/proot fork
# for Android aarch64 using the Android NDK, then installs the proot binary
# AND its two ELF loaders into the app.
#
# The loaders are not optional on Android. proot does embed a copy of the
# loader in its own binary and can normally extract it at runtime, but that
# path is dead on Android 10+: the extracted copy lands in the app's temp dir
# (SELinux label app_data_file), and W^X forbids untrusted_app from executing
# anything with that label — chmod +x succeeds, the exec still gets EACCES.
# The only executable location is nativeLibraryDir, which the installer
# populates from `lib/**/*.so` inside the APK. Hence the loaders ship as
# jniLibs with a .so suffix despite being executables, not shared objects.
#
# Drop them and the failure is quiet and misleading: proot launches fine and
# native_offload initialises, so any "does the sandbox start?" check passes —
# but the first execve("/bin/sh") fails and every command in the app comes
# back as "[Shell not running] (exit code: -1)". See the commit that restored
# this install step for the on-device diagnosis.
#
# Repository: https://github.com/OpenMinis/proot (fork of termux/proot)
#
# Prerequisites:
#   - Android NDK r28+ (default path: ~/Library/Android/sdk/ndk/28.0.12433566,
#     or set $ANDROID_NDK_HOME)
#   - curl, tar, make, awk, sed
#
# Usage:
#   ./build_proot.sh           # incremental build
#   ./build_proot.sh clean     # clean all build artifacts and rebuild
#   ./build_proot.sh distclean # also remove vendored talloc source
#
# Output:
#   src/android/app/src/main/assets/proot-aarch64
#   src/android/app/src/main/jniLibs/arm64-v8a/libproot.so
#   src/android/app/src/main/jniLibs/arm64-v8a/libproot-loader.so
#   src/android/app/src/main/jniLibs/arm64-v8a/libproot-loader32.so
#
# Note on reproducibility: these artifacts are NOT byte-identical across NDK
# releases — the loader's .text differs between toolchain generations (the
# binaries this repo shipped before they were untracked were built with
# clang 21; NDK r28 carries clang 19). Functionally equivalent; do not expect
# checksums to match an older build.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROOT_DIR="$SCRIPT_DIR/proot"
TALLOC_DIR="$SCRIPT_DIR/talloc"
BUILD_DIR="$SCRIPT_DIR/build/proot-android"
ASSETS_DIR="$PROJECT_ROOT/src/android/app/src/main/assets"
OUTPUT_BIN="$ASSETS_DIR/proot-aarch64"
# The APK also ships proot as a native library (extracted to
# app's nativeLibraryDir at install time). Keep both in sync.
JNILIBS_DIR="$PROJECT_ROOT/src/android/app/src/main/jniLibs/arm64-v8a"
JNILIBS_BIN="$JNILIBS_DIR/libproot.so"

# talloc version pinned to a known-good release. Single-file build avoids
# Samba's waf-based build system entirely (we just compile talloc.c).
TALLOC_VERSION="2.4.2"
TALLOC_TARBALL_URL="https://download.samba.org/pub/talloc/talloc-${TALLOC_VERSION}.tar.gz"

# Android target. minSdk=26 in src/android/app/build.gradle.kts.
ANDROID_API=26
ANDROID_ABI="arm64-v8a"
NDK_TRIPLE="aarch64-linux-android"

# ----------------------------------------------------------------------------
# Log helpers
# ----------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[build_proot] $1${NC}"; }
log_success() { echo -e "${GREEN}[build_proot] $1${NC}"; }
log_warn()    { echo -e "${YELLOW}[build_proot] $1${NC}"; }
log_error()   { echo -e "${RED}[build_proot] $1${NC}" >&2; exit 1; }

# ----------------------------------------------------------------------------
# Locate NDK + clang
# ----------------------------------------------------------------------------
resolve_ndk() {
    if [ -n "$ANDROID_NDK_HOME" ] && [ -d "$ANDROID_NDK_HOME" ]; then
        echo "$ANDROID_NDK_HOME"
        return
    fi
    if [ -n "$ANDROID_NDK_ROOT" ] && [ -d "$ANDROID_NDK_ROOT" ]; then
        echo "$ANDROID_NDK_ROOT"
        return
    fi

    # Auto-detect highest available NDK in the SDK folder
    local base="$HOME/Library/Android/sdk/ndk"
    if [ -d "$base" ]; then
        local latest
        latest=$(ls "$base" 2>/dev/null | sort -V | tail -n 1)
        if [ -n "$latest" ]; then
            echo "$base/$latest"
            return
        fi
    fi

    log_error "Android NDK not found. Set \$ANDROID_NDK_HOME or install via Android Studio."
}

setup_toolchain() {
    NDK_HOME="$(resolve_ndk)"
    log_info "Using NDK: $NDK_HOME"

    local host_tag
    case "$(uname -s)-$(uname -m)" in
        Darwin-*)         host_tag="darwin-x86_64" ;;
        Linux-x86_64)     host_tag="linux-x86_64" ;;
        *)                log_error "Unsupported host: $(uname -s) $(uname -m)" ;;
    esac

    TOOLCHAIN_BIN="$NDK_HOME/toolchains/llvm/prebuilt/$host_tag/bin"
    if [ ! -d "$TOOLCHAIN_BIN" ]; then
        log_error "Toolchain dir missing: $TOOLCHAIN_BIN"
    fi

    CC="$TOOLCHAIN_BIN/${NDK_TRIPLE}${ANDROID_API}-clang"
    AR="$TOOLCHAIN_BIN/llvm-ar"
    STRIP="$TOOLCHAIN_BIN/llvm-strip"
    OBJCOPY="$TOOLCHAIN_BIN/llvm-objcopy"
    OBJDUMP="$TOOLCHAIN_BIN/llvm-objdump"
    RANLIB="$TOOLCHAIN_BIN/llvm-ranlib"

    for tool in "$CC" "$AR" "$STRIP" "$OBJCOPY" "$OBJDUMP" "$RANLIB"; do
        if [ ! -x "$tool" ]; then
            log_error "Missing toolchain binary: $tool"
        fi
    done
    log_info "Clang: $CC"
}

# ----------------------------------------------------------------------------
# Stage: fetch talloc source (single-file build)
# ----------------------------------------------------------------------------
fetch_talloc() {
    if [ -f "$TALLOC_DIR/talloc.c" ] && [ -f "$TALLOC_DIR/talloc.h" ]; then
        log_info "talloc source already present, skipping download"
        return
    fi

    log_info "Downloading talloc $TALLOC_VERSION..."
    mkdir -p "$TALLOC_DIR"
    local tarball="$BUILD_DIR/talloc-${TALLOC_VERSION}.tar.gz"
    mkdir -p "$BUILD_DIR"
    if [ ! -f "$tarball" ]; then
        curl -fsSL "$TALLOC_TARBALL_URL" -o "$tarball"
    fi

    local tmp
    tmp=$(mktemp -d)
    tar xzf "$tarball" -C "$tmp"
    cp "$tmp/talloc-${TALLOC_VERSION}/talloc.c" "$TALLOC_DIR/"
    cp "$tmp/talloc-${TALLOC_VERSION}/talloc.h" "$TALLOC_DIR/"
    rm -rf "$tmp"

    # talloc.c expects Samba's `replace.h` — a compat shim that pulls in the
    # standard C + POSIX headers and provides a handful of fallback macros.
    # We ship a minimal standalone version so talloc builds against bionic
    # without needing the rest of Samba. Numbers must match talloc.h constants.
    cat > "$TALLOC_DIR/replace.h" <<'EOF'
#ifndef REPLACE_H
#define REPLACE_H

#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <stdint.h>
#include <string.h>
#include <stdbool.h>
#include <errno.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/auxv.h>

#define TALLOC_BUILD_VERSION_MAJOR   2
#define TALLOC_BUILD_VERSION_MINOR   4
#define TALLOC_BUILD_VERSION_RELEASE 2

#define HAVE_SYS_AUXV_H 1
#define HAVE_INTPTR_T 1
#define HAVE_VA_COPY 1

/* valgrind hooks are no-ops outside Samba */
#define VALGRIND_MAKE_MEM_UNDEFINED(p, n) do { (void)(p); (void)(n); } while (0)
#define VALGRIND_MAKE_MEM_DEFINED(p, n)   do { (void)(p); (void)(n); } while (0)
#define VALGRIND_MAKE_MEM_NOACCESS(p, n)  do { (void)(p); (void)(n); } while (0)

#ifndef ZERO_STRUCT
#define ZERO_STRUCT(x) memset((char *)&(x), 0, sizeof(x))
#endif

#ifndef discard_const
#define discard_const(ptr) ((void *)((uintptr_t)(ptr)))
#endif

#ifndef MIN
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#endif
#ifndef MAX
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#endif

#define HAVE_CONSTRUCTOR_ATTRIBUTE 1

#endif /* REPLACE_H */
EOF

    log_success "talloc $TALLOC_VERSION unpacked into deps/talloc/"
}

# ----------------------------------------------------------------------------
# Stage: build libtalloc.a (static)
# ----------------------------------------------------------------------------
build_talloc() {
    local out="$BUILD_DIR/libtalloc.a"
    if [ -f "$out" ] && [ "$FORCE_REBUILD" != "1" ]; then
        log_info "libtalloc.a already built, skipping"
        return
    fi

    log_info "Compiling libtalloc.a for android-$ANDROID_API ($ANDROID_ABI)..."
    mkdir -p "$BUILD_DIR/talloc-obj"

    # talloc.c needs a small amount of Samba boilerplate that's gated by
    # HAVE_* defines. We define just enough for a standalone build against
    # bionic: the common Linux/POSIX features minus Samba-specific plumbing.
    local defines=(
        -DHAVE_STDARG_H=1
        -DHAVE_VA_COPY=1
        -DHAVE_UNISTD_H=1
        -DHAVE_INTPTR_T=1
    )

    "$CC" -c "$TALLOC_DIR/talloc.c" \
        -o "$BUILD_DIR/talloc-obj/talloc.o" \
        -I"$TALLOC_DIR" \
        -fPIC -O2 -Wall -std=gnu99 \
        "${defines[@]}"

    "$AR" rcs "$out" "$BUILD_DIR/talloc-obj/talloc.o"
    "$RANLIB" "$out"

    log_success "libtalloc.a built ($(du -h "$out" | awk '{print $1}'))"
}

# ----------------------------------------------------------------------------
# Stage: build proot
# ----------------------------------------------------------------------------
build_proot() {
    if [ ! -d "$PROOT_DIR/src" ]; then
        log_error "PRoot source missing at $PROOT_DIR. Did you clone OpenMinis/proot?"
    fi

    log_info "Building proot (aarch64)..."

    # proot's GNUmakefile has a quirk where `-f <path>` out-of-tree builds
    # double-prefix source paths via $(SRC)$<. Simpler to build in-tree under
    # src/ — object files land next to sources, cleaned by `make clean`.
    # Note: Makefile's default CPPFLAGS adds `-D_FILE_OFFSET_BITS=64
    # -D_GNU_SOURCE -I. -I$(VPATH)` — we must preserve -I. since proot
    # sources use paths like `#include "execve/elf.h"`.
    local cppflags="-D_FILE_OFFSET_BITS=64 -D_GNU_SOURCE -I. -DARG_MAX=131072 -I$TALLOC_DIR"
    local cflags="-O2 -Wall -Wextra -fPIE"
    local ldflags="-Wl,-z,noexecstack -pie -L$BUILD_DIR -ltalloc"

    (
        cd "$PROOT_DIR/src"
        if [ "$FORCE_REBUILD" = "1" ]; then
            make clean >/dev/null 2>&1 || true
        fi

        make \
            CC="$CC" \
            STRIP="$STRIP" \
            OBJCOPY="$OBJCOPY" \
            OBJDUMP="$OBJDUMP" \
            CPPFLAGS="$cppflags" \
            CFLAGS="$cflags" \
            LDFLAGS="$ldflags" \
            -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)"
    )

    local built="$PROOT_DIR/src/proot"
    if [ ! -f "$built" ]; then
        log_error "Build finished but $built is missing"
    fi

    "$STRIP" "$built"

    # Sanity-check: ELF aarch64 shared-object (PIE)
    if ! "$OBJDUMP" -a "$built" | grep -q 'aarch64'; then
        log_error "Output is not aarch64 ELF"
    fi

    log_success "proot built: $built ($(du -h "$built" | awk '{print $1}'))"
    BUILT_PROOT="$built"
}

# ----------------------------------------------------------------------------
# Stage: install into Android assets
# ----------------------------------------------------------------------------
install_asset() {
    if [ ! -f "$BUILT_PROOT" ]; then
        log_error "No proot binary to install"
    fi
    mkdir -p "$ASSETS_DIR"

    # No .bak of the previous binary: anything left in assets/ is packaged
    # into the APK, so a backup silently added ~260K of dead weight to every
    # build. The binary is reproducible from source — rerun this script.
    rm -f "$OUTPUT_BIN.bak"

    install -m 0755 "$BUILT_PROOT" "$OUTPUT_BIN"
    log_success "Installed: $OUTPUT_BIN ($(du -h "$OUTPUT_BIN" | awk '{print $1}'))"

    mkdir -p "$JNILIBS_DIR"
    install -m 0755 "$BUILT_PROOT" "$JNILIBS_BIN"
    log_success "Installed: $JNILIBS_BIN ($(du -h "$JNILIBS_BIN" | awk '{print $1}'))"

    # The ELF loaders MUST ship as jniLibs too, or the sandbox can start but
    # cannot execute anything inside the rootfs.
    #
    # Android 10+ enforces W^X for untrusted_app: a file labelled
    # app_data_file (everything under the app's files/ dir, including the
    # extracted Alpine rootfs) can never be exec'd. Only apk_data_file —
    # i.e. what the installer extracts into nativeLibraryDir from lib/ in
    # the APK — is executable. proot's answer is these loaders: the loader
    # itself lives in nativeLibraryDir (executable), and it maps the guest
    # ELF from the rootfs instead of handing it to the kernel's execve.
    #
    # Without them proot still launches and native_offload still initializes
    # — which is why a "does the sandbox start?" smoke test passes — but the
    # first execve("/bin/sh") fails with EACCES and every command comes back
    # as "[Shell not running] (exit code: -1)".
    #
    # Only files matching lib/**/*.so are extracted to nativeLibraryDir, so
    # the .so suffix is load-bearing here even though these are executables,
    # not shared objects.
    # ── DO NOT install the fork-built loaders. ────────────────────────────
    #
    # The loaders that ship are VENDORED TERMUX BUILDS (proot 5.1.107-70),
    # tracked in git as an explicit exception to the no-binaries rule; this
    # script only VERIFIES them. History, because this has now bitten twice:
    #
    #  * bc2566b2 untracked all jniLibs binaries; a25d93f7 then rebuilt the
    #    loaders from deps/proot and installed them here, believing them
    #    "identical modulo stripping" to the deleted ones. They are not: the
    #    deleted ones were Termux's builds, which carry Android-specific
    #    loader patches our deps/proot fork does not have.
    #  * Pairing our proot with the FORK-built loader works on some devices
    #    (Pixel 4a / Android 13) but SEGVs the guest's first instruction on
    #    others (OnePlus 7 Pro / crDroid 12.11, rooted: "proot info: vpid 1:
    #    terminated with signal 11", proot exit=255). The Termux pair works
    #    fleet-wide and did so through 0.20.
    #  * The exact Termux deb has been rotated out of packages.termux.dev
    #    (404), so these bytes can be neither re-downloaded nor rebuilt from
    #    anything in this tree. The git copies are the only source.
    #
    # To ever go back to fork-built loaders: first port Termux's loader
    # patches into deps/proot, then verify on a non-stock ROM (the Pixel
    # passing is exactly what hid this regression).
    local want64="44ef39c1e1a18c09f6e4c4b5d6f8bba82d30596598bd155ec162d05c5122ff04"
    local want32="25f6bd90bc5a3d3088026289a0d3eaf3e502bd2b00e5cb74fadd9791132efa34"
    local have64 have32
    have64=$(shasum -a 256 "$JNILIBS_DIR/libproot-loader.so" 2>/dev/null | awk '{print $1}')
    have32=$(shasum -a 256 "$JNILIBS_DIR/libproot-loader32.so" 2>/dev/null | awk '{print $1}')
    if [ "$have64" != "$want64" ]; then
        log_error "libproot-loader.so is NOT the vendored Termux build (sha256=${have64:-missing}). Restore: git checkout -- src/android/app/src/main/jniLibs/arm64-v8a/libproot-loader.so"
    fi
    if [ "$have32" != "$want32" ]; then
        log_error "libproot-loader32.so is NOT the vendored Termux build (sha256=${have32:-missing}). Restore: git checkout -- src/android/app/src/main/jniLibs/arm64-v8a/libproot-loader32.so"
    fi
    log_success "Verified vendored Termux loaders (sha256-pinned): libproot-loader.so, libproot-loader32.so"
}

# ----------------------------------------------------------------------------
# Stage: verify every artifact the APK needs is present and sane
# ----------------------------------------------------------------------------
# This exists because of a real regression: when the loaders stopped being
# installed, the build stayed green, Gradle packaged the APK happily (it never
# inspects jniLibs contents), and the only symptom was every shell command in
# the app returning "[Shell not running]" at runtime. Nothing between the
# build and the user's device checked that the sandbox was actually complete.
#
# Fail loudly here instead. A missing file is a broken sandbox, so it must
# stop the build rather than produce a silently unusable APK.
verify_artifacts() {
    log_info "Verifying installed artifacts…"

    local failed=0

    # path:min_bytes:arch — the size floor catches a truncated or zero-length
    # install, which a plain -f test would happily accept. `arch` is the
    # expected ELF machine: the 32-bit loader really is 32-bit ARM (it exists
    # to run 32-bit guest binaries), so demanding aarch64 of it is wrong.
    local required=(
        "$OUTPUT_BIN:100000:aarch64"
        "$JNILIBS_BIN:100000:aarch64"
        "$JNILIBS_DIR/libproot-loader.so:4000:aarch64"
    )
    # 32-bit loader is genuinely optional (Alpine aarch64 is pure 64-bit), so
    # it is checked only when present rather than being required.
    if [ -f "$JNILIBS_DIR/libproot-loader32.so" ]; then
        required+=("$JNILIBS_DIR/libproot-loader32.so:2000:elf32-littlearm")
    fi

    for entry in "${required[@]}"; do
        local path="${entry%%:*}"
        local rest="${entry#*:}"
        local min="${rest%%:*}"
        local arch="${rest#*:}"
        local name="${path##*/}"

        if [ ! -f "$path" ]; then
            log_warn "MISSING: $path"
            failed=1
            continue
        fi
        local size
        size=$(wc -c < "$path" | tr -d ' ')
        if [ "$size" -lt "$min" ]; then
            log_warn "TOO SMALL: $name is $size bytes (expected >= $min) — truncated install?"
            failed=1
            continue
        fi
        if ! "$OBJDUMP" -a "$path" 2>/dev/null | grep -q "$arch"; then
            log_warn "WRONG ARCH: $name is not $arch"
            failed=1
            continue
        fi
        log_success "  ✓ $name ($size bytes)"
    done

    if [ "$failed" -ne 0 ]; then
        log_error "Artifact verification failed — the APK built from this tree would have a broken sandbox (shell commands would return '[Shell not running]'). Fix the errors above and rerun."
    fi

    log_success "All sandbox artifacts present and valid"
}

# ----------------------------------------------------------------------------
# Entry points
# ----------------------------------------------------------------------------
do_clean() {
    log_info "Cleaning build artifacts..."
    rm -rf "$BUILD_DIR"
    if [ -d "$PROOT_DIR/src" ]; then
        (cd "$PROOT_DIR/src" && make clean >/dev/null 2>&1 || true)
    fi
    log_success "Clean complete"
}

do_distclean() {
    do_clean
    rm -rf "$TALLOC_DIR"
    log_success "Distclean complete"
}

main() {
    case "${1:-}" in
        clean)     do_clean; FORCE_REBUILD=1 ;;
        distclean) do_distclean; FORCE_REBUILD=1 ;;
        "")        FORCE_REBUILD=0 ;;
        *)         log_error "Unknown argument: $1 (expected: clean|distclean)" ;;
    esac

    setup_toolchain
    fetch_talloc
    build_talloc
    build_proot
    install_asset
    verify_artifacts

    log_success "All done. proot binary ready at $OUTPUT_BIN"
}

main "$@"
