fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    if target_os == "macos" {
        if let Ok(dir) = std::env::var("MPV_LIB_DIR") {
            println!("cargo:rustc-link-search=native={dir}");
        } else if std::path::Path::new("/opt/homebrew/lib").exists() {
            println!("cargo:rustc-link-search=native=/opt/homebrew/lib");
        } else if std::path::Path::new("/usr/local/lib").exists() {
            println!("cargo:rustc-link-search=native=/usr/local/lib");
        }

        println!("cargo:rustc-link-lib=framework=OpenGL");
        println!("cargo:rustc-link-lib=framework=IOKit");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
    } else if target_os == "ios" {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let target = std::env::var("TARGET").unwrap_or_default();
        let subdir = if target.contains("sim") { "ios-sim" } else { "ios" };
        let libs_dir = std::path::Path::new(&manifest_dir)
            .join("libs")
            .join(subdir)
            .join("lib");
        if libs_dir.exists() {
            println!(
                "cargo:rustc-link-search=native={}",
                libs_dir.display()
            );
        }

        // Static linking: must explicitly link all transitive deps of libmpv
        for lib in &[
            "avcodec", "avformat", "avfilter", "avutil",
            "swresample", "swscale", "placebo", "ass",
            "harfbuzz", "freetype", "fribidi",
        ] {
            println!("cargo:rustc-link-lib=static={lib}");
        }

        // System frameworks required by mpv + FFmpeg on iOS
        for fw in &[
            "VideoToolbox", "AudioToolbox", "CoreMedia",
            "CoreVideo", "CoreAudio", "AVFoundation",
            "OpenGLES", "CoreText", "CoreFoundation",
            "Security",
        ] {
            println!("cargo:rustc-link-lib=framework={fw}");
        }

        // System libs
        println!("cargo:rustc-link-lib=bz2");
        println!("cargo:rustc-link-lib=z");
        println!("cargo:rustc-link-lib=iconv");
        println!("cargo:rustc-link-lib=c++");
    }

    if target_os == "linux" {
        if let Ok(dir) = std::env::var("MPV_LIB_DIR") {
            println!("cargo:rustc-link-search=native={dir}");
        }
    }

    if target_os == "windows" {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let libs_dir = std::path::Path::new(&manifest_dir)
            .join("libs")
            .join("windows");

        if let Ok(dir) = std::env::var("MPV_LIB_DIR") {
            println!("cargo:rustc-link-search=native={dir}");
        } else if libs_dir.exists() {
            println!(
                "cargo:rustc-link-search=native={}",
                libs_dir.display()
            );
        }
    }

    tauri_build::build()
}
