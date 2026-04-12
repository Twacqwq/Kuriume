#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Build libmpv + FFmpeg as static libraries for iOS arm64 (device).
#
# Prerequisites:
#   brew install meson ninja pkg-config nasm
#   Xcode with iOS SDK (xcode-select -s /Applications/Xcode.app/...)
#   rustup target add aarch64-apple-ios
#
# Output:
#   src-tauri/libs/ios/lib/*.a    — static libraries
#   src-tauri/libs/ios/include/*  — headers
#   src-tauri/libs/ios/lib/pkgconfig/*.pc — pkg-config files
#
# Usage:
#   bash scripts/build-mpv-ios.sh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="${PROJECT_DIR}/.ios-build"
PREFIX="${BUILD_DIR}/prefix"
OUTPUT_DIR="${PROJECT_DIR}/src-tauri/libs/ios"

FFMPEG_VERSION="7.1"
MPV_VERSION="0.39.0"
FREETYPE_VERSION="2.13.3"
FRIBIDI_VERSION="1.0.16"
HARFBUZZ_VERSION="10.1.0"
LIBASS_VERSION="0.17.3"
LIBPLACEBO_VERSION="7.349.0"

IOS_SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
IOS_MIN="14.0"

CC="$(xcrun --sdk iphoneos -f clang)"
CXX="$(xcrun --sdk iphoneos -f clang++)"
AR="$(xcrun --sdk iphoneos -f ar)"
RANLIB="$(xcrun --sdk iphoneos -f ranlib)"
STRIP="$(xcrun --sdk iphoneos -f strip)"

COMMON_FLAGS="-arch arm64 -isysroot ${IOS_SDK} -miphoneos-version-min=${IOS_MIN}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${GREEN}════════════════════════════════════════${NC}"; echo -e "${GREEN}  $*${NC}"; echo -e "${GREEN}════════════════════════════════════════${NC}\n"; }

# ── Check prerequisites ───────────────────────────────────────
for cmd in meson ninja pkg-config nasm; do
    command -v "$cmd" >/dev/null || error "'$cmd' not found. Install with: brew install $cmd"
done
[ -d "$IOS_SDK" ] || error "iOS SDK not found. Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"

NJOBS="$(sysctl -n hw.ncpu)"
mkdir -p "$BUILD_DIR" "$PREFIX/lib/pkgconfig"

# ── Create shared meson cross file ────────────────────────────
cat > "${BUILD_DIR}/ios-arm64-cross.txt" << CROSSFILE
[binaries]
c = '${CC}'
cpp = '${CXX}'
objc = '${CC}'
ar = '${AR}'
strip = '${STRIP}'
ranlib = '${RANLIB}'
pkg-config = '$(which pkg-config)'

[built-in options]
c_args = ['-arch', 'arm64', '-isysroot', '${IOS_SDK}', '-miphoneos-version-min=${IOS_MIN}']
c_link_args = ['-arch', 'arm64', '-isysroot', '${IOS_SDK}', '-miphoneos-version-min=${IOS_MIN}']
cpp_args = ['-arch', 'arm64', '-isysroot', '${IOS_SDK}', '-miphoneos-version-min=${IOS_MIN}']
cpp_link_args = ['-arch', 'arm64', '-isysroot', '${IOS_SDK}', '-miphoneos-version-min=${IOS_MIN}']
objc_args = ['-arch', 'arm64', '-isysroot', '${IOS_SDK}', '-miphoneos-version-min=${IOS_MIN}']
objc_link_args = ['-arch', 'arm64', '-isysroot', '${IOS_SDK}', '-miphoneos-version-min=${IOS_MIN}']

[host_machine]
system = 'darwin'
subsystem = 'ios'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'

[properties]
pkg_config_libdir = '${PREFIX}/lib/pkgconfig'
needs_exe_wrapper = true
CROSSFILE

# ── Step 1: Build FFmpeg ──────────────────────────────────────
build_ffmpeg() {
    step "Building FFmpeg ${FFMPEG_VERSION} for iOS arm64"

    cd "$BUILD_DIR"
    if [ ! -f "ffmpeg-${FFMPEG_VERSION}.tar.xz" ]; then
        info "Downloading FFmpeg ${FFMPEG_VERSION}..."
        curl -L -o "ffmpeg-${FFMPEG_VERSION}.tar.xz" \
            "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
    fi

    if [ ! -d "ffmpeg-${FFMPEG_VERSION}" ]; then
        info "Extracting FFmpeg..."
        tar xf "ffmpeg-${FFMPEG_VERSION}.tar.xz"
    fi

    cd "ffmpeg-${FFMPEG_VERSION}"

    # Skip if already built
    if [ -f "${PREFIX}/lib/libavcodec.a" ]; then
        info "FFmpeg already built, skipping."
        return
    fi

    info "Configuring FFmpeg..."
    ./configure \
        --prefix="${PREFIX}" \
        --enable-cross-compile \
        --arch=arm64 \
        --target-os=darwin \
        --cc="${CC}" \
        --cxx="${CXX}" \
        --ar="${AR}" \
        --ranlib="${RANLIB}" \
        --strip="${STRIP}" \
        --extra-cflags="${COMMON_FLAGS}" \
        --extra-ldflags="${COMMON_FLAGS}" \
        --enable-static \
        --disable-shared \
        --disable-programs \
        --disable-doc \
        --disable-debug \
        --enable-pic \
        --enable-network \
        --enable-videotoolbox \
        --enable-audiotoolbox \
        --disable-avdevice \
        --disable-encoders \
        --disable-muxers \
        --enable-demuxers \
        --enable-decoders \
        --enable-parsers \
        --enable-protocols \
        --enable-hwaccel=h264_videotoolbox \
        --enable-hwaccel=hevc_videotoolbox \
        --enable-hwaccel=vp9_videotoolbox \
        --enable-hwaccel=av1_videotoolbox \
        --disable-postproc \
        --disable-bsfs \
        --enable-bsf=h264_mp4toannexb \
        --enable-bsf=hevc_mp4toannexb \
        --enable-bsf=aac_adtstoasc \
        --enable-bsf=vp9_superframe

    # Patch config.h: force-enable network structs that configure can't detect
    # during cross-compilation (iOS SDK absolutely has these).
    info "Patching config.h for iOS network support..."
    sed -i '' 's/#define HAVE_STRUCT_SOCKADDR_IN6 0/#define HAVE_STRUCT_SOCKADDR_IN6 1/' config.h
    sed -i '' 's/#define HAVE_STRUCT_SOCKADDR_SA_LEN 0/#define HAVE_STRUCT_SOCKADDR_SA_LEN 1/' config.h
    sed -i '' 's/#define HAVE_STRUCT_SOCKADDR_STORAGE 0/#define HAVE_STRUCT_SOCKADDR_STORAGE 1/' config.h
    sed -i '' 's/#define CONFIG_NETWORK 0/#define CONFIG_NETWORK 1/' config.h
    # Also patch config.asm if it exists
    if [ -f config.asm ]; then
        sed -i '' 's/%define HAVE_STRUCT_SOCKADDR_IN6 0/%define HAVE_STRUCT_SOCKADDR_IN6 1/' config.asm
        sed -i '' 's/%define HAVE_STRUCT_SOCKADDR_SA_LEN 0/%define HAVE_STRUCT_SOCKADDR_SA_LEN 1/' config.asm
        sed -i '' 's/%define HAVE_STRUCT_SOCKADDR_STORAGE 0/%define HAVE_STRUCT_SOCKADDR_STORAGE 1/' config.asm
        sed -i '' 's/%define CONFIG_NETWORK 0/%define CONFIG_NETWORK 1/' config.asm
    fi

    info "Building FFmpeg (${NJOBS} jobs)..."
    make -j"${NJOBS}"
    make install

    info "FFmpeg build complete."
}

# ── Step 2: Build freetype ────────────────────────────────────
build_freetype() {
    step "Building freetype ${FREETYPE_VERSION} for iOS arm64"

    cd "$BUILD_DIR"
    if [ ! -f "freetype-${FREETYPE_VERSION}.tar.xz" ]; then
        info "Downloading freetype..."
        curl -L -o "freetype-${FREETYPE_VERSION}.tar.xz" \
            "https://download.savannah.gnu.org/releases/freetype/freetype-${FREETYPE_VERSION}.tar.xz"
    fi
    if [ ! -d "freetype-${FREETYPE_VERSION}" ]; then
        tar xf "freetype-${FREETYPE_VERSION}.tar.xz"
    fi

    cd "freetype-${FREETYPE_VERSION}"

    if [ -f "${PREFIX}/lib/libfreetype.a" ]; then
        info "freetype already built, skipping."
        return
    fi

    rm -rf build-ios
    meson setup build-ios \
        --cross-file "${BUILD_DIR}/ios-arm64-cross.txt" \
        --prefix="${PREFIX}" \
        --default-library=static \
        -Dharfbuzz=disabled \
        -Dbrotli=disabled \
        -Dpng=disabled \
        -Dbzip2=disabled \
        -Dzlib=enabled

    ninja -C build-ios
    ninja -C build-ios install
    info "freetype build complete."
}

# ── Step 3: Build fribidi ─────────────────────────────────────
build_fribidi() {
    step "Building fribidi ${FRIBIDI_VERSION} for iOS arm64"

    cd "$BUILD_DIR"
    if [ ! -f "fribidi-${FRIBIDI_VERSION}.tar.xz" ]; then
        info "Downloading fribidi..."
        curl -L -o "fribidi-${FRIBIDI_VERSION}.tar.xz" \
            "https://github.com/fribidi/fribidi/releases/download/v${FRIBIDI_VERSION}/fribidi-${FRIBIDI_VERSION}.tar.xz"
    fi
    if [ ! -d "fribidi-${FRIBIDI_VERSION}" ]; then
        tar xf "fribidi-${FRIBIDI_VERSION}.tar.xz"
    fi

    cd "fribidi-${FRIBIDI_VERSION}"

    if [ -f "${PREFIX}/lib/libfribidi.a" ]; then
        info "fribidi already built, skipping."
        return
    fi

    rm -rf build-ios
    meson setup build-ios \
        --cross-file "${BUILD_DIR}/ios-arm64-cross.txt" \
        --prefix="${PREFIX}" \
        --default-library=static \
        -Dtests=false \
        -Ddocs=false

    ninja -C build-ios
    ninja -C build-ios install
    info "fribidi build complete."
}

# ── Step 4: Build harfbuzz ────────────────────────────────────
build_harfbuzz() {
    step "Building harfbuzz ${HARFBUZZ_VERSION} for iOS arm64"

    cd "$BUILD_DIR"
    if [ ! -f "harfbuzz-${HARFBUZZ_VERSION}.tar.xz" ]; then
        info "Downloading harfbuzz..."
        curl -L -o "harfbuzz-${HARFBUZZ_VERSION}.tar.xz" \
            "https://github.com/harfbuzz/harfbuzz/releases/download/${HARFBUZZ_VERSION}/harfbuzz-${HARFBUZZ_VERSION}.tar.xz"
    fi
    if [ ! -d "harfbuzz-${HARFBUZZ_VERSION}" ]; then
        tar xf "harfbuzz-${HARFBUZZ_VERSION}.tar.xz"
    fi

    cd "harfbuzz-${HARFBUZZ_VERSION}"

    if [ -f "${PREFIX}/lib/libharfbuzz.a" ]; then
        info "harfbuzz already built, skipping."
        return
    fi

    rm -rf build-ios
    PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig" \
    PKG_CONFIG_LIBDIR="${PREFIX}/lib/pkgconfig" \
    meson setup build-ios \
        --cross-file "${BUILD_DIR}/ios-arm64-cross.txt" \
        --prefix="${PREFIX}" \
        --default-library=static \
        -Dfreetype=enabled \
        -Dglib=disabled \
        -Dgobject=disabled \
        -Dcairo=disabled \
        -Dicu=disabled \
        -Dcoretext=enabled \
        -Dtests=disabled \
        -Ddocs=disabled

    ninja -C build-ios
    ninja -C build-ios install
    info "harfbuzz build complete."
}

# ── Step 5: Build libass ──────────────────────────────────────
build_libass() {
    step "Building libass ${LIBASS_VERSION} for iOS arm64"

    cd "$BUILD_DIR"
    if [ ! -f "libass-${LIBASS_VERSION}.tar.xz" ]; then
        info "Downloading libass..."
        curl -L -o "libass-${LIBASS_VERSION}.tar.xz" \
            "https://github.com/libass/libass/releases/download/${LIBASS_VERSION}/libass-${LIBASS_VERSION}.tar.xz"
    fi
    if [ ! -d "libass-${LIBASS_VERSION}" ]; then
        tar xf "libass-${LIBASS_VERSION}.tar.xz"
    fi

    cd "libass-${LIBASS_VERSION}"

    if [ -f "${PREFIX}/lib/libass.a" ]; then
        info "libass already built, skipping."
        return
    fi

    export PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig"
    export PKG_CONFIG_LIBDIR="${PREFIX}/lib/pkgconfig"

    ./configure \
        --host=aarch64-apple-darwin \
        --prefix="${PREFIX}" \
        --enable-static \
        --disable-shared \
        --disable-fontconfig \
        --disable-require-system-font-provider \
        --disable-asm \
        CC="${CC}" \
        CFLAGS="${COMMON_FLAGS} -O2" \
        LDFLAGS="${COMMON_FLAGS}" \
        PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig"

    make -j"${NJOBS}"
    make install
    info "libass build complete."
}

# ── Step 6: Build libplacebo ──────────────────────────────────
build_libplacebo() {
    step "Building libplacebo ${LIBPLACEBO_VERSION} for iOS arm64"

    cd "$BUILD_DIR"
    if [ ! -d "libplacebo" ]; then
        info "Cloning libplacebo ${LIBPLACEBO_VERSION}..."
        git clone --depth 1 --branch "v${LIBPLACEBO_VERSION}" \
            --recurse-submodules --shallow-submodules \
            https://code.videolan.org/videolan/libplacebo.git
    fi

    cd "libplacebo"

    if [ -f "${PREFIX}/lib/libplacebo.a" ]; then
        info "libplacebo already built, skipping."
        return
    fi

    rm -rf build-ios
    PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig" \
    PKG_CONFIG_LIBDIR="${PREFIX}/lib/pkgconfig" \
    meson setup build-ios \
        --cross-file "${BUILD_DIR}/ios-arm64-cross.txt" \
        --prefix="${PREFIX}" \
        --default-library=static \
        -Dvulkan=disabled \
        -Dd3d11=disabled \
        -Dopengl=enabled \
        -Dgl-proc-addr=enabled \
        -Ddemos=false \
        -Dtests=false \
        -Dlcms=disabled \
        -Dunwind=disabled

    ninja -C build-ios
    ninja -C build-ios install
    info "libplacebo build complete."
}

# ── Step 7: Build mpv ─────────────────────────────────────────
build_mpv() {
    step "Building mpv ${MPV_VERSION} for iOS arm64"

    cd "$BUILD_DIR"
    if [ ! -f "mpv-${MPV_VERSION}.tar.gz" ]; then
        info "Downloading mpv ${MPV_VERSION}..."
        curl -L -o "mpv-${MPV_VERSION}.tar.gz" \
            "https://github.com/mpv-player/mpv/archive/v${MPV_VERSION}.tar.gz"
    fi

    # Always extract fresh to avoid stale build dirs
    if [ ! -d "mpv-${MPV_VERSION}" ]; then
        info "Extracting mpv..."
        tar xf "mpv-${MPV_VERSION}.tar.gz"
    fi

    cd "mpv-${MPV_VERSION}"

    # Skip if already built
    if [ -f "${PREFIX}/lib/libmpv.a" ]; then
        info "mpv already built, skipping."
        return
    fi

    # Remove old build dir if exists
    rm -rf build-ios

    info "Configuring mpv with meson..."
    PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig" \
    PKG_CONFIG_LIBDIR="${PREFIX}/lib/pkgconfig" \
    meson setup build-ios \
        --cross-file "${BUILD_DIR}/ios-arm64-cross.txt" \
        --prefix="${PREFIX}" \
        --default-library=static \
        -Dlibmpv=true \
        -Dcplayer=false \
        -Dbuild-date=false \
        -Dgpl=true \
        -Dtests=false \
        -Dplain-gl=enabled \
        -Dgl=enabled \
        -Dios-gl=disabled \
        -Dlua=disabled \
        -Djavascript=disabled \
        -Dcocoa=disabled \
        -Dmacos-touchbar=disabled \
        -Dmacos-media-player=disabled \
        -Dmacos-cocoa-cb=disabled \
        -Dswift-build=disabled \
        -Dgl-cocoa=disabled \
        -Dmacos-cocoa-cb=disabled \
        -Dmacos-10-15-4-features=disabled \
        -Dmacos-11-features=disabled \
        -Dmacos-11-3-features=disabled \
        -Dmacos-12-features=disabled \
        -Daudiounit=enabled \
        -Dcoreaudio=disabled \
        -Davfoundation=disabled \
        -Dvulkan=disabled \
        -Dshaderc=disabled \
        -Dvideotoolbox-pl=disabled \
        -Dlcms2=disabled \
        -Dlibarchive=disabled \
        -Dlibbluray=disabled \
        -Duchardet=disabled \
        -Drubberband=disabled \
        -Dzimg=disabled \
        -Dvapoursynth=disabled \
        -Djpeg=disabled \
        -Dmanpage-build=disabled \
        -Dhtml-build=disabled

    info "Building mpv (${NJOBS} jobs)..."
    ninja -C build-ios

    info "Installing mpv..."
    ninja -C build-ios install

    info "mpv build complete."
}

# ── Step 3: Install to project ────────────────────────────────
install_libs() {
    step "Installing to ${OUTPUT_DIR}"

    rm -rf "${OUTPUT_DIR}"
    mkdir -p "${OUTPUT_DIR}/lib" "${OUTPUT_DIR}/include"

    # Copy static libraries
    cp "${PREFIX}/lib/"*.a "${OUTPUT_DIR}/lib/" 2>/dev/null || true

    # Copy headers
    cp -R "${PREFIX}/include/"* "${OUTPUT_DIR}/include/" 2>/dev/null || true

    # Copy pkg-config files (useful for debugging)
    mkdir -p "${OUTPUT_DIR}/lib/pkgconfig"
    cp "${PREFIX}/lib/pkgconfig/"*.pc "${OUTPUT_DIR}/lib/pkgconfig/" 2>/dev/null || true

    info "Installed libraries:"
    ls -lh "${OUTPUT_DIR}/lib/"*.a 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}'

    echo ""
    info "Done! Libraries are at: ${OUTPUT_DIR}"
    info "Next steps:"
    info "  1. Run 'xcodegen' in src-tauri/gen/apple/ to regenerate the Xcode project"
    info "  2. Run 'npm run tauri ios dev' to build and run on device/simulator"
}

# ── Main ──────────────────────────────────────────────────────
info "Building libmpv for iOS arm64"
info "  FFmpeg: ${FFMPEG_VERSION}"
info "  mpv:    ${MPV_VERSION}"
info "  SDK:    ${IOS_SDK}"
info "  Build:  ${BUILD_DIR}"
info "  Output: ${OUTPUT_DIR}"
echo ""

build_ffmpeg
build_freetype
build_fribidi
build_harfbuzz
build_libass
build_libplacebo
build_mpv
install_libs
