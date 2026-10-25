use crate::commands::ProviderState;
use crate::media_proxy::MediaProxyState;
use crate::online_commands::OnlineSourceState;
use crate::store_commands::StoreState;
use kuriume_provider::{AniList, Bangumi};
use std::sync::Arc;
#[cfg(desktop)]
use tauri::menu::Menu;
#[cfg(target_os = "macos")]
use tauri::menu::{PredefinedMenuItem, Submenu};
use tauri::Manager;

mod app_commands;
mod app_update;
mod commands;
mod diagnostics;
#[cfg(target_os = "macos")]
mod fullscreen_macos;
mod media_proxy;
mod online_commands;
mod store_commands;

/// macOS sends Cmd+C/V/X/A/Z (and Cmd+Q/H) to the WebView only through the
/// app menu's key equivalents, so text fields need an Edit menu there. Kept
/// to the app menu and 编辑, with macOS's own Chinese names. Windows and
/// Linux WebViews handle those keys themselves; no menu bar.
#[cfg(desktop)]
fn app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    #[cfg(target_os = "macos")]
    {
        // macOS titles the first menu with the app name whatever it is given.
        let application = Submenu::with_items(
            app,
            "Kuriume",
            true,
            &[
                &PredefinedMenuItem::about(app, Some("关于 Kuriume"), None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, Some("隐藏 Kuriume"))?,
                &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
                &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, Some("退出 Kuriume"))?,
            ],
        )?;
        let edit = Submenu::with_items(
            app,
            "编辑",
            true,
            &[
                &PredefinedMenuItem::undo(app, Some("撤销"))?,
                &PredefinedMenuItem::redo(app, Some("重做"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, Some("剪切"))?,
                &PredefinedMenuItem::copy(app, Some("拷贝"))?,
                &PredefinedMenuItem::paste(app, Some("粘贴"))?,
                &PredefinedMenuItem::select_all(app, Some("全选"))?,
            ],
        )?;
        Menu::with_items(app, &[&application, &edit])
    }
    #[cfg(not(target_os = "macos"))]
    {
        Menu::new(app)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::record(
        diagnostics::Event::AppStarted,
        diagnostics::Level::Info,
        diagnostics::Details::default(),
    );
    let mut catalog = ProviderState::new();
    catalog.register(Arc::new(AniList::new()));
    catalog.register(Arc::new(Bangumi::new()));

    let media_proxy = MediaProxyState::new();
    let protocol_media_proxy = media_proxy.clone();
    let builder = tauri::Builder::default().register_asynchronous_uri_scheme_protocol(
        "kuriume-media",
        move |context, request, responder| {
            if context.webview_label() != "main" {
                responder.respond(
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::FORBIDDEN)
                        .header("content-type", "text/plain; charset=utf-8")
                        .body(b"Media transport is limited to the main WebView".to_vec())
                        .unwrap_or_default(),
                );
                return;
            }
            protocol_media_proxy.respond(request, responder);
        },
    );

    #[cfg(desktop)]
    let builder = builder
        .menu(app_menu)
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_mobile::init());

    builder
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                fullscreen_macos::clear();
            }
            // Tao restores the macOS window style after fullscreen and makes
            // its container first responder. Hand keyboard input back to the
            // main WebView after native resize events, preserving DOM focus.
            #[cfg(target_os = "macos")]
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::Resized(_))
                && window.is_focused().unwrap_or(false)
            {
                if let Some(webview) = window.get_webview("main") {
                    let _ = webview.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .manage(catalog)
        .manage(StoreState::new())
        .manage(OnlineSourceState::new())
        .manage(media_proxy)
        .setup(|app| {
            #[cfg(all(
                debug_assertions,
                any(target_os = "macos", target_os = "ios", target_os = "android")
            ))]
            app.state::<MediaProxyState>()
                .set_dev_origin(app.config().build.dev_url.as_ref());
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                fullscreen_macos::install(&window)?;
            }
            let stored_rules = app
                .state::<StoreState>()
                .with_store(app.handle(), |store| {
                    store.source_rule_list().map_err(|error| error.to_string())
                })?;
            let online_sources = app.state::<OnlineSourceState>();
            for record in stored_rules {
                match serde_json::from_str::<kuriume_provider::Rule>(&record.rule_json) {
                    Ok(rule)
                        if !rule.id.starts_with("builtin:")
                            && crate::online_commands::validate_source_rule(&rule).is_ok() =>
                    {
                        online_sources.remove_rule(&rule.id);
                        online_sources.add_rule(rule);
                    }
                    Ok(_) => eprintln!("Skipped invalid source rule: {}", record.name),
                    Err(error) => {
                        eprintln!("Skipped unreadable source rule {}: {error}", record.name)
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::app_commands::open_external,
            crate::app_update::update_install,
            crate::app_update::update_restart,
            crate::diagnostics::diagnostics_write,
            crate::diagnostics::diagnostics_read,
            crate::diagnostics::diagnostics_clear,
            crate::commands::get_list,
            crate::commands::search,
            crate::commands::get_detail,
            crate::commands::get_episodes,
            crate::commands::get_calendar,
            crate::commands::get_characters,
            crate::commands::get_relations,
            crate::commands::catalog_counterpart,
            crate::commands::find_manga_counterpart,
            crate::online_commands::playback_source_list,
            crate::online_commands::playback_source_list_rules,
            crate::online_commands::playback_source_add_rule,
            crate::online_commands::playback_source_remove_rule,
            crate::online_commands::playback_source_search,
            crate::online_commands::playback_source_episodes,
            crate::online_commands::playback_source_resolve,
            crate::store_commands::get_settings,
            crate::store_commands::set_default_volume,
            crate::store_commands::set_default_speed,
            crate::store_commands::set_auto_next,
            crate::store_commands::set_display_language,
            crate::store_commands::set_catalog_source,
            crate::store_commands::media_ensure,
            crate::store_commands::external_identity_list,
            crate::store_commands::external_identity_upsert,
            crate::store_commands::external_identity_remove,
            crate::store_commands::library_add,
            crate::store_commands::library_remove,
            crate::store_commands::library_get,
            crate::store_commands::library_set_status,
            crate::store_commands::library_list,
            crate::store_commands::history_upsert,
            crate::store_commands::history_list,
            crate::store_commands::history_remove,
            crate::store_commands::history_clear,
            crate::store_commands::source_binding_get,
            crate::store_commands::source_binding_list,
            crate::store_commands::source_binding_upsert,
            crate::store_commands::source_binding_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
