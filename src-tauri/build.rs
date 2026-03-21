fn main() {
    #[cfg(target_os = "macos")]
    {
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
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(dir) = std::env::var("MPV_LIB_DIR") {
            println!("cargo:rustc-link-search=native={dir}");
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(dir) = std::env::var("MPV_LIB_DIR") {
            println!("cargo:rustc-link-search=native={dir}");
        }
    }

    tauri_build::build()
}
