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
