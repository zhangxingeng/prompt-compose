//! Prompt Compose — the native shell.
//!
//! Rust owns the filesystem (the Markdown snippet store, the app-local roster),
//! the semantic-match machinery, and local speech-to-text; the SvelteKit
//! frontend owns rendering and the variable grammar. Two command surfaces:
//! the Prompt Library's (`prompts::state`) and dictation's (`dictate::state`).

mod datadir;
mod dictate;
mod net;
mod prompts;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Self-update. The frontend drives the whole lifecycle (check, download,
        // install) through `src/lib/updater.svelte.ts`; there is no v2 `dialog`
        // option to hand it off to, and no Rust command surface of our own.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(prompts::state::PromptsState::new())
        .manage(dictate::state::DictateState::new())
        .invoke_handler(tauri::generate_handler![
            prompts::state::list_projects,
            prompts::state::add_project,
            prompts::state::set_project_color,
            prompts::state::remove_project,
            prompts::state::set_active_project,
            prompts::state::list_snippets,
            prompts::state::save_snippet,
            prompts::state::delete_snippet,
            prompts::state::match_snippets,
            prompts::state::touch_snippet,
            dictate::state::list_audio_devices,
            dictate::state::start_dictation,
            dictate::state::stop_dictation,
        ])
        .setup(move |app| {
            // Prompt Library: fetch the embedding model and index the active
            // project in the background, silently. Semantic match is an
            // improvement to ranking, never a prerequisite — lexical match works
            // instantly and unconditionally, so this blocks nothing and a
            // failure is logged rather than surfaced. There is no toggle and no
            // progress UI by design.
            prompts::state::spawn_background_index(&app.state::<prompts::state::PromptsState>());
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
