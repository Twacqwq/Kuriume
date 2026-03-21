fn main() {
    #[cfg(target_os = "macos")]
    {
        // libmpv: respect MPV_LIB_DIR env for CI, fallback to Homebrew paths
        if let Ok(dir) = std::env::var("MPV_LIB_DIR") {
            println!("cargo:rustc-link-search=native={dir}");
        } else if std::path::Path::new("/opt/homebrew/lib").exists() {
            // Homebrew on Apple Silicon
            println!("cargo:rustc-link-search=native=/opt/homebrew/lib");
        } else if std::path::Path::new("/usr/local/lib").exists() {
            // Homebrew on Intel Mac
            println!("cargo:rustc-link-search=native=/usr/local/lib");
        }

        // macOS system frameworks
        println!("cargo:rustc-link-lib=framework=OpenGL");
        println!("cargo:rustc-link-lib=framework=IOKit");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
    }

    #[cfg(target_os = "linux")]
    {
        // pkg-config will locate libmpv on Linux
        if let Ok(dir) = std::env::var("MPV_LIB_DIR") {
            println!("cargo:rustc-link-search=native={dir}");
        }
    }

    #[cfg(target_os = "windows")]
    {
        // On Windows, MPV_LIB_DIR must point to the directory containing mpv.lib
        if let Ok(dir) = std::env::var("MPV_LIB_DIR") {
            println!("cargo:rustc-link-search=native={dir}");
        }
    }

    tauri_build::build()
}
