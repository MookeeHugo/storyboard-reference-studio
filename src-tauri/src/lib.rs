// Library entry point for Storyboard Reference Studio
pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::project::get_app_data_dir,
            commands::project::get_projects_dir,
            commands::project::save_project,
            commands::project::save_backup,
            commands::project::load_project,
            commands::project::import_media,
            commands::project::import_audio,
            commands::project::paste_image,
            commands::project::read_project_file,
            commands::project::write_project_png,
            commands::project::ensure_dir,
            commands::project::temp_dir,
            commands::project::show_folder,
            commands::project::extract_frame,
            commands::project::extract_range,
            commands::project::describe_frame,
            commands::project::export_board,
            commands::project::export_animatic,
            commands::project::export_pdf,
            commands::project::export_shotlist,
            commands::project::media_tools_status,
            commands::version::get_version,
            commands::mcp::start_mcp_server,
            commands::mcp::stop_mcp_server,
            commands::mcp::get_mcp_status,
        ])
        .setup(|app| {
            println!("Starting Storyboard Reference Studio v{}", app.package_info().version);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
