#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Rebuild libmpv + deps for iOS Simulator (arm64).
# Reuses source trees from the device build in .ios-build/.
# Output: src-tauri/libs/ios-sim/
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="${PROJECT_DIR}/.ios-sim-build"
PREFIX="${BUILD_DIR}/prefix"
OUTPUT_DIR="${PROJECT_DIR}/src-tauri/libs/ios-sim"
SRC_DIR="${PROJECT_DIR}/.ios-build"  # reuse downloaded sources

FFMPEG_VERSION="7.1"
MPV_VERSION="0.39.0"
FREETYPE_VERSION="2.13.3"
FRIBIDI_VERSION="1.0.16"
HARFBUZZ_VERSION="10.1.0"
LIBASS_VERSION="0.17.3"

IOS_SIM_SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
IOS_MIN="14.0"

CC="$(xcrun --sdk iphonesimulator -f clang)"
CXX="$(xcrun --sdk iphonesimulator -f clang++)"
AR="$(xcrun --sdk iphonesimulator -f ar)"
RANLIB="$(xcrun --sdk iphonesimulator -f ranlib)"
STRIP="$(xcrun --sdk iphonesimulator -f strip)"

COMMON_FLAGS="-arch arm64 -isysroot ${IOS_SIM_SDK} -target arm64-apple-ios${IOS_MIN}-simulator"

GREEN='\033[0;32m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
step()  { echo -e "\n${GREEN}════════════════════════════════════════${NC}"; echo -e "${GREEN}  $*${NC}"; echo -e "${GREEN}════════════════════════════════════════${NC}\n"; }

NJOBS="$(sysctl -n hw.ncpu)"
mkdir -p "$BUILD_DIR" "$PREFIX/lib/pkgconfig"

# ── Create meson cross file for simulator ─────────────────────
cat > "${BUILD_DIR}/ios-sim-cross.txt" << CROSSFILE
[binaries]
c = '${CC}'
cpp = '${CXX}'
objc = '${CC}'
ar = '${AR}'
strip = '${STRIP}'
ranlib = '${RANLIB}'
pkg-config = '$(which pkg-config)'

[built-in options]
c_args = ['-arch', 'arm64', '-isysroot', '${IOS_SIM_SDK}', '-target', 'arm64-apple-ios${IOS_MIN}-simulator']
c_link_args = ['-arch', 'arm64', '-isysroot', '${IOS_SIM_SDK}', '-target', 'arm64-apple-ios${IOS_MIN}-simulator']
cpp_args = ['-arch', 'arm64', '-isysroot', '${IOS_SIM_SDK}', '-target', 'arm64-apple-ios${IOS_MIN}-simulator']
cpp_link_args = ['-arch', 'arm64', '-isysroot', '${IOS_SIM_SDK}', '-target', 'arm64-apple-ios${IOS_MIN}-simulator']
objc_args = ['-arch', 'arm64', '-isysroot', '${IOS_SIM_SDK}', '-target', 'arm64-apple-ios${IOS_MIN}-simulator']
objc_link_args = ['-arch', 'arm64', '-isysroot', '${IOS_SIM_SDK}', '-target', 'arm64-apple-ios${IOS_MIN}-simulator']

[host_machine]
system = 'darwin'
subsystem = 'ios-simulator'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'

[properties]
pkg_config_libdir = '${PREFIX}/lib/pkgconfig'
needs_exe_wrapper = true
CROSSFILE

# ── FFmpeg ────────────────────────────────────────────────────
build_ffmpeg() {
    step "Building FFmpeg ${FFMPEG_VERSION} for iOS Simulator arm64"
    cd "$BUILD_DIR"
    if [ ! -d "ffmpeg-${FFMPEG_VERSION}" ]; then
        cp -a "${SRC_DIR}/ffmpeg-${FFMPEG_VERSION}" .
    fi
    cd "ffmpeg-${FFMPEG_VERSION}"
    [ -f "${PREFIX}/lib/libavcodec.a" ] && { info "FFmpeg already built, skipping."; return; }

    make distclean 2>/dev/null || true

    ./configure \
        --prefix="$PREFIX" \
        --enable-cross-compile \
        --arch=arm64 \
        --target-os=darwin \
        --cc="$CC" \
        --cxx="$CXX" \
        --extra-cflags="$COMMON_FLAGS" \
        --extra-ldflags="$COMMON_FLAGS" \
        --enable-static --disable-shared \
        --disable-programs --disable-doc --disable-debug \
        --enable-pic \
        --enable-videotoolbox --enable-audiotoolbox \
        --disable-avdevice --disable-postproc \
        --disable-network --disable-encoders --disable-muxers \
        --enable-encoder=aac --enable-encoder=libx264 \
        --disable-bsfs --disable-filters \
        --enable-filter=aresample --enable-filter=scale \
        --enable-filter=format --enable-filter=aformat \
        --enable-filter=null --enable-filter=anull \
        --disable-protocols --enable-protocol=file --enable-protocol=pipe \
        --enable-swresample --enable-swscale

    make -j"$NJOBS"
    make install
    info "FFmpeg build complete."
}

# ── freetype ──────────────────────────────────────────────────
build_freetype() {
    step "Building freetype ${FREETYPE_VERSION} for iOS Simulator arm64"
    cd "$BUILD_DIR"
    if [ ! -d "freetype-${FREETYPE_VERSION}" ]; then
        cp -a "${SRC_DIR}/freetype-${FREETYPE_VERSION}" .
    fi
    cd "freetype-${FREETYPE_VERSION}"
    [ -f "${PREFIX}/lib/libfreetype.a" ] && { info "freetype already built, skipping."; return; }

    rm -rf build-sim && mkdir build-sim && cd build-sim
    meson setup \
        --cross-file "${BUILD_DIR}/ios-sim-cross.txt" \
        --prefix="$PREFIX" \
        --default-library=static \
        -Dharfbuzz=disabled -Dpng=disabled -Dzlib=disabled -Dbzip2=disabled -Dbrotli=disabled \
        ..
    ninja -j"$NJOBS"
    ninja install
    info "freetype build complete."
}

# ── fribidi ───────────────────────────────────────────────────
build_fribidi() {
    step "Building fribidi ${FRIBIDI_VERSION} for iOS Simulator arm64"
    cd "$BUILD_DIR"
    if [ ! -d "fribidi-${FRIBIDI_VERSION}" ]; then
        cp -a "${SRC_DIR}/fribidi-${FRIBIDI_VERSION}" .
    fi
    cd "fribidi-${FRIBIDI_VERSION}"
    [ -f "${PREFIX}/lib/libfribidi.a" ] && { info "fribidi already built, skipping."; return; }

    rm -rf build-sim && mkdir build-sim && cd build-sim
    meson setup \
        --cross-file "${BUILD_DIR}/ios-sim-cross.txt" \
        --prefix="$PREFIX" \
        --default-library=static \
        -Ddocs=false -Dbin=false -Dtests=false \
        ..
    ninja -j"$NJOBS"
    ninja install
    info "fribidi build complete."
}

# ── harfbuzz ──────────────────────────────────────────────────
build_harfbuzz() {
    step "Building harfbuzz ${HARFBUZZ_VERSION} for iOS Simulator arm64"
    cd "$BUILD_DIR"
    if [ ! -d "harfbuzz-${HARFBUZZ_VERSION}" ]; then
        cp -a "${SRC_DIR}/harfbuzz-${HARFBUZZ_VERSION}" .
    fi
    cd "harfbuzz-${HARFBUZZ_VERSION}"
    [ -f "${PREFIX}/lib/libharfbuzz.a" ] && { info "harfbuzz already built, skipping."; return; }

    rm -rf build-sim && mkdir build-sim && cd build-sim
    meson setup \
        --cross-file "${BUILD_DIR}/ios-sim-cross.txt" \
        --prefix="$PREFIX" \
        --default-library=static \
        -Dfreetype=enabled -Dglib=disabled -Dcairo=disabled \
        -Dcoretext=disabled -Dicu=disabled -Dtests=disabled \
        -Dintrospection=disabled -Ddocs=disabled -Dbenchmark=disabled \
        ..
    ninja -j"$NJOBS"
    ninja install
    info "harfbuzz build complete."
}

# ── libass ────────────────────────────────────────────────────
build_libass() {
    step "Building libass ${LIBASS_VERSION} for iOS Simulator arm64"
    cd "$BUILD_DIR"
    if [ ! -d "libass-${LIBASS_VERSION}" ]; then
        cp -a "${SRC_DIR}/libass-${LIBASS_VERSION}" .
    fi
    cd "libass-${LIBASS_VERSION}"
    [ -f "${PREFIX}/lib/libass.a" ] && { info "libass already built, skipping."; return; }

    rm -rf build-sim && mkdir build-sim && cd build-sim
    meson setup \
        --cross-file "${BUILD_DIR}/ios-sim-cross.txt" \
        --prefix="$PREFIX" \
        --default-library=static \
        -Dcoretext=enabled -Dfontconfig=disabled \
        ..
    ninja -j"$NJOBS"
    ninja install
    info "libass build complete."
}

# ── libplacebo ────────────────────────────────────────────────
build_libplacebo() {
    step "Building libplacebo for iOS Simulator arm64"
    cd "$BUILD_DIR"
    if [ ! -d "libplacebo" ]; then
        cp -a "${SRC_DIR}/libplacebo" .
    fi
    cd libplacebo
    [ -f "${PREFIX}/lib/libplacebo.a" ] && { info "libplacebo already built, skipping."; return; }

    rm -rf build-sim && mkdir build-sim && cd build-sim
    meson setup \
        --cross-file "${BUILD_DIR}/ios-sim-cross.txt" \
        --prefix="$PREFIX" \
        --default-library=static \
        -Dvulkan=disabled -Dd3d11=disabled -Dgl-proc-addr=disabled \
        -Ddemos=false -Dtests=false -Dbench=false \
        ..
    ninja -j"$NJOBS"
    ninja install
    info "libplacebo build complete."
}

# ── mpv ───────────────────────────────────────────────────────
build_mpv() {
    step "Building mpv ${MPV_VERSION} for iOS Simulator arm64"
    cd "$BUILD_DIR"
    if [ ! -d "mpv-${MPV_VERSION}" ]; then
        cp -a "${SRC_DIR}/mpv-${MPV_VERSION}" .
    fi
    cd "mpv-${MPV_VERSION}"
    [ -f "${PREFIX}/lib/libmpv.a" ] && { info "mpv already built, skipping."; return; }

    rm -rf build-sim && mkdir build-sim && cd build-sim
    PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig" \
    meson setup \
        --cross-file "${BUILD_DIR}/ios-sim-cross.txt" \
        --prefix="$PREFIX" \
        --default-library=static \
        -Dlibmpv=true \
        -Dcplayer=false \
        -Dtests=false \
        -Dplain-gl=enabled \
        -Dgl=enabled \
        -Dios-gl=disabled \
        -Daudiounit=enabled \
        -Dvulkan=disabled \
        -Dcocoa=disabled \
        -Dcoreaudio=disabled \
        -Davfoundation=disabled \
        -Dmacos-cocoa-cb=disabled \
        -Dmacos-media-player=disabled \
        -Dmacos-touchbar=disabled \
        -Dswift-build=disabled \
        ..
    ninja -j"$NJOBS"
    ninja install
    info "mpv build complete."
}

# ── Install to output dir ─────────────────────────────────────
install_output() {
    step "Installing to ${OUTPUT_DIR}"
    mkdir -p "${OUTPUT_DIR}/lib" "${OUTPUT_DIR}/include"
    cp -a "${PREFIX}/lib/"*.a "${OUTPUT_DIR}/lib/" 2>/dev/null || true
    cp -a "${PREFIX}/lib/pkgconfig" "${OUTPUT_DIR}/lib/" 2>/dev/null || true
    cp -a "${PREFIX}/include/"* "${OUTPUT_DIR}/include/" 2>/dev/null || true

    info "Installed libraries:"
    for f in "${OUTPUT_DIR}"/lib/*.a; do
        info "  $f ($(du -h "$f" | cut -f1))"
    done
    info "Done! Simulator libraries at: ${OUTPUT_DIR}"
}

# ── Main ──────────────────────────────────────────────────────
build_ffmpeg
build_freetype
build_fribidi
build_harfbuzz
build_libass
build_libplacebo
build_mpv
install_output
