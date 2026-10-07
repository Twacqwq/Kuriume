use crate::commands::ProviderState;
use crate::media_proxy::MediaProxyState;
use crate::online_commands::OnlineSourceState;
use crate::store_commands::StoreState;
use kuriume_provider::AniList;
use std::sync::Arc;
#[cfg(desktop)]
use tauri::menu::Menu;
use tauri::Manager;

mod commands;
#[cfg(target_os = "macos")]
mod fullscreen_macos;
mod media_proxy;
mod online_commands;
mod store_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut catalog = ProviderState::new();
    catalog.register(Arc::new(AniList::new()));

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
    let builder = builder.menu(Menu::new);

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
            crate::commands::get_list,
            crate::commands::search,
            crate::commands::get_detail,
            crate::commands::get_episodes,
            crate::commands::get_calendar,
            crate::commands::get_characters,
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
