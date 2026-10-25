use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(mobile)]
mod mobile {
    use serde::{Deserialize, Serialize};
    use tauri::{plugin::PluginHandle, AppHandle, Manager, Runtime};

    pub struct Mobile<R: Runtime>(pub PluginHandle<R>);

    #[derive(Deserialize, Serialize)]
    #[serde(rename_all = "lowercase")]
    pub enum Action {
        Prepare,
        Pause,
        Levels,
        Volume,
        Brightness,
        Finish,
        Fullscreen,
        Leave,
    }

    #[derive(Deserialize, Serialize)]
    pub struct ControlRequest {
        action: Action,
        value: Option<f64>,
        session: Option<String>,
    }

    #[tauri::command]
    pub async fn control<R: Runtime>(
        app: AppHandle<R>,
        request: ControlRequest,
    ) -> Result<serde_json::Value, String> {
        if request
            .value
            .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
        {
            return Err("Invalid player level".into());
        }
        app.state::<Mobile<R>>()
            .0
            .run_mobile_plugin("control", request)
            .map_err(|error| error.to_string())
    }

    // Only the trusted Rust resolver can start a sniffer; no frontend permission.
    pub async fn sniff<R: Runtime>(
        app: AppHandle<R>,
        request: serde_json::Value,
    ) -> Result<Vec<String>, String> {
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<Mobile<R>>()
                .0
                .run_mobile_plugin("sniff", request)
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())?
    }

    /// The cache directory update packages are downloaded to (cleared of
    /// earlier ones). The installer's FileProvider only shares this one.
    #[cfg(target_os = "android")]
    pub async fn update_dir<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
        #[derive(Deserialize)]
        struct Dir {
            path: String,
        }
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<Mobile<R>>()
                .0
                .run_mobile_plugin::<Dir>("updateDir", serde_json::json!({}))
                .map(|dir| dir.path)
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())?
    }

    /// Opens the system installer for a downloaded package in `update_dir`.
    /// Trusted Rust callers only (the app verified the download).
    #[cfg(target_os = "android")]
    pub async fn install_package<R: Runtime>(
        app: AppHandle<R>,
        path: String,
    ) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<Mobile<R>>()
                .0
                .run_mobile_plugin::<serde_json::Value>(
                    "installPackage",
                    serde_json::json!({ "path": path }),
                )
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())?
    }

    // Trusted Rust callers only (the app validates the URL); no frontend permission.
    pub async fn open_url<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
        app.state::<Mobile<R>>()
            .0
            .run_mobile_plugin::<serde_json::Value>("openUrl", serde_json::json!({ "url": url }))
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "android")]
pub use mobile::{install_package, update_dir};
#[cfg(mobile)]
pub use mobile::{open_url, sniff};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_mobile);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = Builder::new("mobile");
    #[cfg(mobile)]
    let builder = builder
        .invoke_handler(tauri::generate_handler![mobile::control])
        .setup(|app, api| {
            use tauri::Manager;
            #[cfg(target_os = "android")]
            let handle = api.register_android_plugin("com.twac.kuriume.mobile", "MobilePlugin")?;
            #[cfg(target_os = "ios")]
            let handle = api.register_ios_plugin(init_plugin_mobile)?;
            app.manage(mobile::Mobile(handle));
            Ok(())
        });
    builder.build()
}
