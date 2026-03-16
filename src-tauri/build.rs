fn main() {
    if cfg!(target_os = "macos") {
        // Tell the linker where to find libmpv (Homebrew on macOS ARM)
        println!("cargo:rustc-link-search=native=/opt/homebrew/lib");
        // CGL functions live in the OpenGL framework
        println!("cargo:rustc-link-lib=framework=OpenGL");
    }

    tauri_build::build()
}
