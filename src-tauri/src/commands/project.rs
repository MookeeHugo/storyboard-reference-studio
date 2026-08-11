//! Native commands backing the renderer's window.sbr compatibility layer.

use ab_glyph::{FontArc, PxScale};
use base64::{engine::general_purpose, Engine as _};
use image::{imageops, DynamicImage, GenericImageView, Rgba, RgbaImage};
use image::codecs::jpeg::JpegEncoder;
use imageproc::drawing::{draw_filled_rect_mut, draw_hollow_rect_mut, draw_line_segment_mut, draw_text_mut, text_size};
use imageproc::rect::Rect;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri::{command, AppHandle, Manager};
use uuid::Uuid;

const MAX_PROJECT_JSON_BYTES: usize = 20 * 1024 * 1024;
const MAX_PROJECT_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_PROJECT_PNG_BYTES: usize = 25 * 1024 * 1024;

fn validate_project_root(root: &Path) -> Result<(), String> {
    if !root.is_absolute() {
        return Err("Project path must be absolute".to_string());
    }
    if root.components().any(|component| matches!(component, Component::ParentDir)) {
        return Err("Project path cannot contain parent traversal".to_string());
    }
    let is_sbref = root
        .file_name()
        .and_then(|name| Path::new(name).extension())
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("sbref"))
        .unwrap_or(false);
    if !is_sbref {
        return Err("Project root must be a .sbref folder".to_string());
    }
    Ok(())
}

fn project_root(folder: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(folder);
    validate_project_root(&root)?;
    Ok(root)
}

fn validate_project_owned_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Project file path must be absolute".to_string());
    }
    if path.components().any(|component| matches!(component, Component::ParentDir)) {
        return Err("Project file path cannot contain parent traversal".to_string());
    }
    let has_project_root = path.components().any(|component| match component {
        Component::Normal(part) => Path::new(part)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("sbref"))
            .unwrap_or(false),
        _ => false,
    });
    if !has_project_root {
        return Err("Only files inside a .sbref project are allowed".to_string());
    }
    Ok(())
}

fn safe_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let raw = Path::new(relative_path);
    if raw.is_absolute() {
        return Err("Project internal path must be relative".to_string());
    }
    let mut clean = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            _ => return Err("Project internal path cannot escape the project".to_string()),
        }
    }
    if clean.as_os_str().is_empty() {
        return Err("Project internal path cannot be empty".to_string());
    }
    Ok(clean)
}

fn project_path(folder: &str, relative_path: &str) -> Result<PathBuf, String> {
    Ok(project_root(folder)?.join(safe_relative_path(relative_path)?))
}

fn validate_json_size(json: &str) -> Result<(), String> {
    if json.len() > MAX_PROJECT_JSON_BYTES {
        return Err("Project JSON is too large to write safely".to_string());
    }
    Ok(())
}

fn read_project_text(path: &Path) -> Result<String, String> {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > MAX_PROJECT_JSON_BYTES as u64 {
            return Err("Project JSON is too large to read safely".to_string());
        }
    }
    fs::read_to_string(path).map_err(|e| format!("Failed to read project JSON: {}", e))
}

fn validate_existing_input_file(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.components().any(|component| matches!(component, Component::ParentDir)) {
        return Err("Media path must be absolute and cannot contain parent traversal".to_string());
    }
    let meta = fs::metadata(path).map_err(|_| "Media file does not exist".to_string())?;
    if !meta.is_file() {
        return Err("Media path must point to a file".to_string());
    }
    if meta.len() > MAX_PROJECT_FILE_BYTES {
        return Err("Media file is too large to import safely".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMedia {
    pub kind: String,
    pub source_file: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub duration_s: Option<f64>,
    pub fps: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAudio {
    pub source_file: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadProjectResult {
    pub json: Option<String>,
    pub backup_json: Option<String>,
    pub backup_newer: bool,
    pub folder: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtractFrameResult {
    pub ok: bool,
    pub error: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RangeMode {
    Interval { every_s: f64 },
    Scene { threshold: f64 },
    Count { n: usize },
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtractedRangeFrame {
    pub time: f64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtractRangeResult {
    pub ok: bool,
    pub error: Option<String>,
    pub frames: Vec<ExtractedRangeFrame>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DescribeErrorResult {
    pub ok: bool,
    pub error: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFrameInput {
    pub source_png: String,
    pub label: String,
    pub notes: String,
    pub prompt_text: String,
    pub profile_id: String,
    pub crop: serde_json::Value,
    pub source_width: u32,
    pub source_height: u32,
    pub time_s: f64,
    pub media_name: String,
    pub duration_s: Option<f64>,
    pub shot: Option<serde_json::Value>,
    pub reference: Option<serde_json::Value>,
    pub annotations: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportInput {
    pub project_name: String,
    pub exports_root: String,
    pub frames: Vec<ExportFrameInput>,
    pub pdf_options: Option<PdfExportOptions>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportOptions {
    pub template: Option<String>,
    pub theme: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimaticOptions {
    pub burn_label: Option<bool>,
    pub burn_shot_number: Option<bool>,
    pub fade: Option<bool>,
    pub fade_duration_s: Option<f64>,
    pub validate_audio: Option<bool>,
    pub audio_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBoardResult {
    pub ok: bool,
    pub error: Option<String>,
    pub package_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAnimaticResult {
    pub ok: bool,
    pub error: Option<String>,
    pub video_path: String,
    pub audio_waveform_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPdfResult {
    pub ok: bool,
    pub error: Option<String>,
    pub pdf_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportShotlistResult {
    pub ok: bool,
    pub error: Option<String>,
    pub csv_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaToolsStatus {
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub ffmpeg_error: Option<String>,
    pub ffprobe_error: Option<String>,
}

#[command]
pub fn get_app_data_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[command]
pub fn get_projects_dir(app: AppHandle) -> Result<String, String> {
    if let Ok(override_dir) = std::env::var("SBR_PROJECTS_DIR") {
        let dir = PathBuf::from(override_dir);
        fs::create_dir_all(&dir).map_err(|e| format!("无法创建项目目录：{}", e))?;
        return Ok(dir.to_string_lossy().to_string());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("projects");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建项目目录：{}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

#[command(rename_all = "camelCase")]
pub fn save_project(folder: String, json: String) -> Result<bool, String> {
    validate_json_size(&json)?;
    let root = project_root(&folder)?;
    ensure_project_dirs(&root)?;
    fs::write(root.join("project.json"), json).map_err(|e| format!("Failed to write project: {}", e))?;
    Ok(true)
}

#[command(rename_all = "camelCase")]
pub fn save_backup(folder: String, json: String) -> Result<bool, String> {
    validate_json_size(&json)?;
    let root = project_root(&folder)?;
    let backup = root.join(".autosave");
    fs::create_dir_all(&backup).map_err(|e| format!("无法创建自动备份目录：{}", e))?;
    fs::write(backup.join("project.json"), json).map_err(|e| format!("无法保存自动备份：{}", e))?;
    Ok(true)
}

#[command(rename_all = "camelCase")]
pub fn load_project(folder: String) -> Result<LoadProjectResult, String> {
    let root = project_root(&folder)?;
    let project_path = root.join("project.json");
    let backup_path = root.join(".autosave").join("project.json");
    let json = read_project_text(&project_path).ok();
    let backup_json = read_project_text(&backup_path).ok();
    let backup_newer = modified_ms(&backup_path) > modified_ms(&project_path);
    Ok(LoadProjectResult { json, backup_json, backup_newer, folder })
}

#[command(rename_all = "camelCase")]
pub fn import_media(folder: String, source_path: String) -> Result<ImportedMedia, String> {
    let source = PathBuf::from(&source_path);
    validate_existing_input_file(&source)?;
    let root = project_root(&folder)?;
    ensure_project_dirs(&root)?;
    let name = source.file_name().and_then(|s| s.to_str()).unwrap_or("reference").to_string();
    let dest_rel = format!("media/{}-{}", Uuid::new_v4(), safe_name(&name));
    let dest_abs = root.join(rel_to_path(&dest_rel));
    fs::copy(&source, &dest_abs).map_err(|e| format!("Failed to copy media file: {}", e))?;

    let kind = if is_video(&source) { "video" } else { "image" }.to_string();
    let (width, height, duration_s, fps) = if kind == "video" {
        probe_video(&dest_abs).unwrap_or((0, 0, None, None))
    } else {
        let (w, h) = image::image_dimensions(&dest_abs).unwrap_or((0, 0));
        (w, h, None, None)
    };

    Ok(ImportedMedia { kind, source_file: dest_rel, name, width, height, duration_s, fps })
}

#[command(rename_all = "camelCase")]
pub fn import_audio(folder: String, source_path: String) -> Result<ImportedAudio, String> {
    let source = PathBuf::from(&source_path);
    validate_existing_input_file(&source)?;
    let root = project_root(&folder)?;
    ensure_project_dirs(&root)?;
    let name = source.file_name().and_then(|s| s.to_str()).unwrap_or("scratch-audio").to_string();
    let dest_rel = format!("media/{}-{}", Uuid::new_v4(), safe_name(&name));
    fs::copy(&source, root.join(rel_to_path(&dest_rel))).map_err(|e| format!("Failed to copy audio file: {}", e))?;
    Ok(ImportedAudio { source_file: dest_rel, name })
}

#[command(rename_all = "camelCase")]
pub fn paste_image(folder: String, data: Vec<u8>, index: usize) -> Result<ImportedMedia, String> {
    if data.len() > MAX_PROJECT_PNG_BYTES {
        return Err("Pasted image is too large to write safely".to_string());
    }
    let root = project_root(&folder)?;
    ensure_project_dirs(&root)?;
    let name = format!("粘贴截图-{}.png", index);
    let dest_rel = format!("media/{}-paste-{}.png", Uuid::new_v4(), index);
    let dest_abs = root.join(rel_to_path(&dest_rel));
    fs::write(&dest_abs, data).map_err(|e| format!("无法写入截图：{}", e))?;
    let (width, height) = image::image_dimensions(&dest_abs).unwrap_or((0, 0));
    Ok(ImportedMedia { kind: "image".to_string(), source_file: dest_rel, name, width, height, duration_s: None, fps: None })
}

#[command(rename_all = "camelCase")]
pub fn read_project_file(folder: String, relative_path: String) -> Result<Vec<u8>, String> {
    let path = project_path(&folder, &relative_path)?;
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > MAX_PROJECT_FILE_BYTES {
            return Err("Project file is too large to read safely".to_string());
        }
    }
    fs::read(&path).map_err(|e| format!("Failed to read project file {:?}: {}", path, e))
}

#[command(rename_all = "camelCase")]
pub fn write_project_png(folder: String, relative_path: String, base64: String) -> Result<bool, String> {
    let bytes = general_purpose::STANDARD.decode(base64).map_err(|e| format!("Invalid PNG base64: {}", e))?;
    if bytes.len() > MAX_PROJECT_PNG_BYTES {
        return Err("PNG is too large to write safely".to_string());
    }
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Err("Only PNG images may be written".to_string());
    }
    let path = project_path(&folder, &relative_path)?;
    ensure_parent(&path)?;
    fs::write(path, bytes).map_err(|e| format!("Failed to write PNG: {}", e))?;
    Ok(true)
}

#[command(rename_all = "camelCase")]
pub fn ensure_dir(path: String) -> Result<bool, String> {
    let path = PathBuf::from(path);
    validate_project_owned_path(&path)?;
    fs::create_dir_all(path).map_err(|e| format!("Failed to create directory: {}", e))?;
    Ok(true)
}

#[command]
pub fn temp_dir() -> Result<String, String> {
    Ok(std::env::temp_dir().to_string_lossy().to_string())
}

#[command(rename_all = "camelCase")]
pub fn show_folder(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    validate_project_owned_path(&path)?;
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command(rename_all = "camelCase")]
pub fn extract_frame(media_path: String, time_s: f64, out_png: String) -> ExtractFrameResult {
    let out = PathBuf::from(&out_png);
    if let Err(e) = validate_project_owned_path(&out) {
        return ExtractFrameResult { ok: false, error: Some(e), path: out_png };
    }
    if let Err(e) = ensure_parent(&out) {
        return ExtractFrameResult { ok: false, error: Some(e), path: out_png };
    }

    let source = PathBuf::from(&media_path);
    if let Err(e) = validate_project_owned_path(&source) {
        return ExtractFrameResult { ok: false, error: Some(e), path: out_png };
    }
    if !source.exists() {
        return ExtractFrameResult { ok: false, error: Some("源素材不存在".to_string()), path: out_png };
    }

    let result = if is_video(&source) {
        let ffmpeg = match resolve_ffmpeg() {
            Ok(path) => path,
            Err(error) => return ExtractFrameResult { ok: false, error: Some(error), path: out_png },
        };
        Command::new(ffmpeg)
            .args(["-y", "-loglevel", "error", "-ss", &format!("{:.3}", time_s), "-i"])
            .arg(&source)
            .args(["-frames:v", "1"])
            .arg(&out)
            .output()
            .map_err(|e| format!("无法启动 ffmpeg：{}", e))
            .and_then(|o| if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stderr).to_string()) })
    } else {
        image::open(&source)
            .map_err(|e| format!("无法读取图片：{}", e))
            .and_then(|img| img.save(&out).map_err(|e| format!("无法写入参考帧：{}", e)))
    };

    match result {
        Ok(()) => ExtractFrameResult { ok: true, error: None, path: out_png },
        Err(error) => ExtractFrameResult { ok: false, error: Some(error), path: out_png },
    }
}

#[command(rename_all = "camelCase")]
pub fn extract_range(media_path: String, start_s: f64, end_s: f64, mode: RangeMode, out_dir: String) -> ExtractRangeResult {
    let out_root = PathBuf::from(&out_dir);
    if let Err(e) = validate_project_owned_path(&out_root) {
        return ExtractRangeResult { ok: false, error: Some(e), frames: vec![] };
    }
    if let Err(e) = fs::create_dir_all(&out_root) {
        return ExtractRangeResult { ok: false, error: Some(format!("无法创建抽帧目录：{}", e)), frames: vec![] };
    }
    let end = if end_s > start_s { end_s } else { start_s + 1.0 };
    let times = match mode {
        RangeMode::Interval { every_s } => {
            let step = every_s.max(0.2);
            let mut t = start_s;
            let mut out = Vec::new();
            while t <= end + 0.001 && out.len() < 120 {
                out.push(t);
                t += step;
            }
            out
        }
        RangeMode::Count { n } => {
            let n = n.clamp(1, 120);
            if n == 1 { vec![start_s] } else { (0..n).map(|i| start_s + (end - start_s) * (i as f64) / ((n - 1) as f64)).collect() }
        }
        RangeMode::Scene { threshold: _ } => vec![start_s, start_s + (end - start_s) * 0.5, end],
    };

    let mut frames = Vec::new();
    for (i, time) in times.into_iter().enumerate() {
        let path = out_root.join(format!("range-{}-{:03}.png", Uuid::new_v4(), i + 1));
        let path_string = path.to_string_lossy().to_string();
        let result = extract_frame(media_path.clone(), time, path_string.clone());
        if result.ok {
            frames.push(ExtractedRangeFrame { time, path: path_string });
        }
    }

    if frames.is_empty() {
        ExtractRangeResult { ok: false, error: Some("没有抽取到可用画面".to_string()), frames }
    } else {
        ExtractRangeResult { ok: true, error: None, frames }
    }
}

#[command(rename_all = "camelCase")]
pub fn describe_frame(_frame_png_path: String, _profile_id: String, _extra_context: String) -> DescribeErrorResult {
    DescribeErrorResult {
        ok: false,
        error: "当前 Tauri 版本保持本地优先，未接入在线视觉分析。请使用右侧“离线模板”整理 AI 图像/视频提示词。".to_string(),
    }
}

#[command(rename_all = "camelCase")]
pub fn export_board(input: ExportInput) -> ExportBoardResult {
    match export_board_inner(&input) {
        Ok(path) => ExportBoardResult { ok: true, error: None, package_path: path },
        Err(error) => ExportBoardResult { ok: false, error: Some(error), package_path: String::new() },
    }
}

#[command(rename_all = "camelCase")]
pub fn export_shotlist(input: ExportInput) -> ExportShotlistResult {
    let root = PathBuf::from(&input.exports_root);
    if let Err(e) = validate_project_owned_path(&root) {
        return ExportShotlistResult { ok: false, error: Some(e), csv_path: String::new() };
    }
    if let Err(e) = fs::create_dir_all(&root) {
        return ExportShotlistResult { ok: false, error: Some(e.to_string()), csv_path: String::new() };
    }
    let path = root.join(format!("shotlist-{}.csv", export_stamp()));
    let mut csv = String::from("序号,场次,镜号,标题,景别,机位,镜头,运动,转场,时长,源素材,备注,提示词\n");
    for (i, frame) in input.frames.iter().enumerate() {
        let shot = frame.shot.as_ref();
        let get = |key: &str| shot.and_then(|s| s.get(key)).and_then(|v| v.as_str()).unwrap_or("");
        csv.push_str(&[
            (i + 1).to_string(),
            get("sceneNo").to_string(),
            get("shotNo").to_string(),
            frame.label.clone(),
            get("shotSize").to_string(),
            get("cameraAngle").to_string(),
            get("lens").to_string(),
            get("movement").to_string(),
            get("transition").to_string(),
            frame.duration_s.unwrap_or(2.0).to_string(),
            frame.media_name.clone(),
            frame.notes.clone(),
            frame.prompt_text.clone(),
        ].iter().map(|v| csv_escape(v)).collect::<Vec<_>>().join(","));
        csv.push('\n');
    }
    match fs::write(&path, csv.as_bytes()) {
        Ok(()) => ExportShotlistResult { ok: true, error: None, csv_path: path.to_string_lossy().to_string() },
        Err(e) => ExportShotlistResult { ok: false, error: Some(e.to_string()), csv_path: String::new() },
    }
}

#[command(rename_all = "camelCase")]
pub fn export_pdf(input: ExportInput) -> ExportPdfResult {
    let root = PathBuf::from(&input.exports_root);
    if let Err(e) = validate_project_owned_path(&root) {
        return ExportPdfResult { ok: false, error: Some(e), pdf_path: String::new() };
    }
    if let Err(e) = fs::create_dir_all(&root) {
        return ExportPdfResult { ok: false, error: Some(e.to_string()), pdf_path: String::new() };
    }
    let pdf_options = PdfRenderOptions::from_input(&input);
    let path = root.join(format!("storyboard-reference-{}-{}.pdf", pdf_options.file_suffix(), export_stamp()));
    if input.frames.is_empty() {
        return ExportPdfResult { ok: false, error: Some("没有可导出的参考卡".to_string()), pdf_path: path.to_string_lossy().to_string() };
    }

    match export_pdf_inner(&input, &root, &path) {
        Ok(()) => ExportPdfResult { ok: true, error: None, pdf_path: path.to_string_lossy().to_string() },
        Err(e) => ExportPdfResult { ok: false, error: Some(e), pdf_path: path.to_string_lossy().to_string() },
    }
}

#[command(rename_all = "camelCase")]
pub fn export_animatic(input: ExportInput, opts: AnimaticOptions) -> ExportAnimaticResult {
    let root = PathBuf::from(&input.exports_root);
    if let Err(e) = validate_project_owned_path(&root) {
        return ExportAnimaticResult { ok: false, error: Some(e), video_path: String::new(), audio_waveform_path: None };
    }
    if let Err(e) = fs::create_dir_all(&root) {
        return ExportAnimaticResult { ok: false, error: Some(e.to_string()), video_path: String::new(), audio_waveform_path: None };
    }
    let stamp = export_stamp();
    let path = root.join(format!("animatic-{}.mp4", stamp));
    if input.frames.is_empty() {
        return ExportAnimaticResult { ok: false, error: Some("没有可导出的参考卡".to_string()), video_path: path.to_string_lossy().to_string(), audio_waveform_path: None };
    }

    match export_animatic_inner(&input, &opts, &root, &path, &stamp) {
        Ok(audio_waveform_path) => ExportAnimaticResult {
            ok: true,
            error: None,
            video_path: path.to_string_lossy().to_string(),
            audio_waveform_path: audio_waveform_path.map(|p| p.to_string_lossy().to_string()),
        },
        Err(e) => ExportAnimaticResult {
            ok: false,
            error: Some(e),
            video_path: path.to_string_lossy().to_string(),
            audio_waveform_path: None,
        },
    }
}

#[command]
pub fn media_tools_status() -> MediaToolsStatus {
    let ffmpeg = resolve_ffmpeg();
    let ffprobe = resolve_media_tool("ffprobe", "SBR_FFPROBE");
    MediaToolsStatus {
        ffmpeg_path: ffmpeg.as_ref().ok().map(|p| p.to_string_lossy().to_string()),
        ffprobe_path: ffprobe.as_ref().ok().map(|p| p.to_string_lossy().to_string()),
        ffmpeg_error: ffmpeg.err(),
        ffprobe_error: ffprobe.err(),
    }
}

fn export_animatic_inner(
    input: &ExportInput,
    opts: &AnimaticOptions,
    root: &Path,
    video_path: &Path,
    stamp: &str,
) -> Result<Option<PathBuf>, String> {
    let ffmpeg = resolve_ffmpeg()?;
    let work = root.join(format!(".animatic-{}", stamp));
    fs::create_dir_all(&work).map_err(|e| format!("无法创建动态分镜临时目录：{}", e))?;
    let audio_path = opts.audio_path.as_ref().filter(|p| !p.trim().is_empty());
    let audio_waveform_path = if let Some(audio) = audio_path.filter(|_| opts.validate_audio.unwrap_or(true)) {
        Some(validate_audio_track(audio, root, stamp, &ffmpeg)?)
    } else {
        None
    };

    let mut segments = Vec::new();
    for (i, frame) in input.frames.iter().enumerate() {
        let source = materialize_export_source(frame, &work, i)?;
        let seg = work.join(format!("seg-{:04}.mp4", i + 1));
        let duration = frame.duration_s.unwrap_or(2.0).clamp(0.25, 30.0);
        let fade_s = if opts.fade.unwrap_or(false) {
            opts.fade_duration_s.unwrap_or(0.18).clamp(0.03, (duration / 2.0).min(1.0))
        } else {
            0.0
        };

        let mut filters = Vec::new();
        if let Some(crop) = crop_filter_value(&frame.crop, frame.source_width, frame.source_height) {
            filters.push(crop);
        }
        filters.push("scale=1920:1080:force_original_aspect_ratio=decrease".to_string());
        filters.push("pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black".to_string());
        filters.push("setsar=1".to_string());
        if opts.burn_shot_number.unwrap_or(false) {
            filters.push(format!(
                "drawtext=text='{}':x=40:y=36:fontsize=34:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=12",
                escape_drawtext(&shot_index_label(frame, i))
            ));
        }
        if opts.burn_label.unwrap_or(false) && !frame.label.trim().is_empty() {
            filters.push(format!(
                "drawtext=text='{}':x=40:y=1008:fontsize=36:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=12",
                escape_drawtext(&frame.label)
            ));
        }
        if fade_s > 0.0 {
            filters.push(format!("fade=t=in:st=0:d={:.3}", fade_s));
            filters.push(format!("fade=t=out:st={:.3}:d={:.3}", (duration - fade_s).max(0.0), fade_s));
        }
        filters.push("format=yuv420p".to_string());

        let output = Command::new(&ffmpeg)
            .args(["-y", "-loglevel", "error", "-loop", "1"])
            .arg("-i")
            .arg(&source)
            .args(["-t", &format!("{:.3}", duration), "-vf", &filters.join(","), "-r", "24", "-an", "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart"])
            .arg(&seg)
            .output()
            .map_err(|e| format!("无法启动 ffmpeg 生成动态分镜片段：{}", e))?;

        if !output.status.success() {
            return Err(format!("动态分镜片段编码失败：{}", String::from_utf8_lossy(&output.stderr)));
        }
        segments.push(seg);
    }

    let list_path = work.join("segments.txt");
    let list = segments
        .iter()
        .map(|p| format!("file '{}'", ffmpeg_list_path(p)))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&list_path, format!("{}\n", list)).map_err(|e| format!("无法写入动态分镜片段清单：{}", e))?;

    let mut cmd = Command::new(&ffmpeg);
    cmd.args(["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i"]);
    cmd.arg(&list_path);
    if let Some(audio) = audio_path {
        cmd.arg("-i").arg(audio);
        cmd.args(["-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest"]);
    } else {
        cmd.args(["-c", "copy"]);
    }
    cmd.arg(video_path);

    let output = cmd.output().map_err(|e| format!("无法启动 ffmpeg 合成动态分镜：{}", e))?;
    if !output.status.success() {
        return Err(format!("动态分镜合成失败：{}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(audio_waveform_path)
}

fn export_board_inner(input: &ExportInput) -> Result<String, String> {
    let exports_root = PathBuf::from(&input.exports_root);
    validate_project_owned_path(&exports_root)?;
    let package = exports_root.join(format!("board-{}", export_stamp()));
    fs::create_dir_all(&package).map_err(|e| format!("无法创建导出目录：{}", e))?;

    for (i, frame) in input.frames.iter().enumerate() {
        let dir = package.join(format!("{:02}_{}", i + 1, safe_name(&frame.label)));
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        copy_or_decode_source(&frame.source_png, &dir.join("still.png"))?;
        fs::write(dir.join("prompt.txt"), frame.prompt_text.as_bytes()).map_err(|e| e.to_string())?;
    }

    let prompts = serde_json::to_string_pretty(&input).map_err(|e| e.to_string())?;
    fs::write(package.join("prompts.json"), prompts).map_err(|e| e.to_string())?;

    let mut md = format!("# {}\n\n本地分镜参考包，共 {} 条参考。\n\n", input.project_name, input.frames.len());
    for (i, frame) in input.frames.iter().enumerate() {
        md.push_str(&format!("## {:02}. {}\n\n- 源素材：{}\n- 备注：{}\n- 提示词：{}\n\n![still]({:02}_{}/still.png)\n\n", i + 1, frame.label, frame.media_name, frame.notes, frame.prompt_text, i + 1, safe_name(&frame.label)));
    }
    fs::write(package.join("board.md"), md).map_err(|e| e.to_string())?;

    write_contact_sheet(&package, input.frames.len())?;
    Ok(package.to_string_lossy().to_string())
}

fn write_contact_sheet(package: &Path, frame_count: usize) -> Result<(), String> {
    let thumb_w = 320u32;
    let thumb_h = 180u32;
    let cols = 3u32;
    let rows = ((frame_count.max(1) as f32) / cols as f32).ceil() as u32;
    let mut canvas = image::RgbaImage::from_pixel(cols * thumb_w, rows * thumb_h, image::Rgba([8, 10, 14, 255]));
    let mut folders: Vec<PathBuf> = fs::read_dir(package).map_err(|e| e.to_string())?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    folders.sort();
    for (i, dir) in folders.iter().enumerate() {
        if let Ok(img) = image::open(dir.join("still.png")) {
            let thumb = img.thumbnail(thumb_w, thumb_h).to_rgba8();
            let x = (i as u32 % cols) * thumb_w;
            let y = (i as u32 / cols) * thumb_h;
            image::imageops::overlay(&mut canvas, &thumb, x.into(), y.into());
        }
    }
    canvas.save(package.join("contact-sheet.png")).map_err(|e| e.to_string())
}

fn materialize_export_source(frame: &ExportFrameInput, work_dir: &Path, index: usize) -> Result<PathBuf, String> {
    let source = frame.source_png.trim();
    if source.starts_with("data:") {
        let dest = work_dir.join(format!("source-{:04}.png", index + 1));
        copy_or_decode_source(source, &dest)?;
        return Ok(dest);
    }
    let path = PathBuf::from(source);
    validate_project_owned_path(&path)?;
    if path.exists() {
        Ok(path)
    } else {
        Err(format!("参考帧不存在：{}", source))
    }
}

fn crop_filter_value(crop: &serde_json::Value, source_w: u32, source_h: u32) -> Option<String> {
    let obj = crop.as_object()?;
    let x = obj.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(0.0, 1.0);
    let y = obj.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(0.0, 1.0);
    let w = obj.get("w").and_then(|v| v.as_f64()).unwrap_or(1.0).clamp(0.0, 1.0);
    let h = obj.get("h").and_then(|v| v.as_f64()).unwrap_or(1.0).clamp(0.0, 1.0);
    if source_w == 0 || source_h == 0 || (x == 0.0 && y == 0.0 && w == 1.0 && h == 1.0) {
        return None;
    }
    let cw = ((w * source_w as f64).round() as u32).max(2) / 2 * 2;
    let ch = ((h * source_h as f64).round() as u32).max(2) / 2 * 2;
    let cx = (x * source_w as f64).round().max(0.0) as u32;
    let cy = (y * source_h as f64).round().max(0.0) as u32;
    Some(format!("crop={}:{}:{}:{}", cw.max(2), ch.max(2), cx, cy))
}

fn escape_drawtext(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "’")
        .replace('%', "\\%")
        .chars()
        .filter(|c| !c.is_control())
        .collect()
}

fn ffmpeg_list_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").replace('\'', "'\\''")
}

fn shot_index_label(frame: &ExportFrameInput, index: usize) -> String {
    let shot = frame.shot.as_ref();
    let scene_no = json_str(shot, "sceneNo").unwrap_or_default();
    let shot_no = json_str(shot, "shotNo").unwrap_or_default();
    if !scene_no.is_empty() || !shot_no.is_empty() {
        return join_slash(&[scene_no.as_str(), shot_no.as_str()]).replace(" / ", "-");
    }
    format!("{:02}", index + 1)
}

fn validate_audio_track(audio: &str, root: &Path, stamp: &str, ffmpeg: &Path) -> Result<PathBuf, String> {
    let audio_path = PathBuf::from(audio);
    validate_project_owned_path(&audio_path)?;
    if !audio_path.exists() {
        return Err(format!("临时声音轨不存在：{}", audio));
    }
    let duration = probe_audio_duration(&audio_path).ok_or_else(|| "临时声音轨没有可识别的音频流".to_string())?;
    if duration < 0.1 {
        return Err(format!("临时声音轨时长过短：{:.2}s", duration));
    }
    let waveform = root.join(format!("animatic-{}-audio-waveform.png", stamp));
    let output = Command::new(ffmpeg)
        .args(["-y", "-loglevel", "error", "-i"])
        .arg(&audio_path)
        .args(["-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=1280x240:colors=0xE9B95C", "-frames:v", "1"])
        .arg(&waveform)
        .output()
        .map_err(|e| format!("无法生成临时声音轨波形：{}", e))?;
    if !output.status.success() {
        return Err(format!("临时声音轨波形校验失败：{}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(waveform)
}

fn probe_audio_duration(path: &Path) -> Option<f64> {
    if let Some(ffprobe) = resolve_ffprobe() {
        let output = Command::new(ffprobe)
            .args(["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format"])
            .arg(path)
            .output()
            .ok()?;
        if output.status.success() {
            let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
            let has_audio = json.get("streams")?.as_array()?.iter().any(|stream| stream.get("codec_type").and_then(|v| v.as_str()) == Some("audio"));
            if has_audio {
                return json.get("format").and_then(|f| f.get("duration")).and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok());
            }
        }
    }
    None
}
fn copy_or_decode_source(source: &str, dest: &Path) -> Result<(), String> {
    ensure_parent(dest)?;
    if source.starts_with("data:") {
        let bytes = decode_data_url(source)?;
        match image::load_from_memory(&bytes) {
            Ok(img) => img.save(dest).map_err(|e| format!("无法写入参考图 PNG：{}", e)),
            Err(_) => write_placeholder_png(dest),
        }
    } else {
        fs::copy(source, dest).map(|_| ()).map_err(|e| e.to_string())
    }
}

fn decode_data_url(source: &str) -> Result<Vec<u8>, String> {
    let (meta, data) = source
        .strip_prefix("data:")
        .and_then(|s| s.split_once(','))
        .ok_or_else(|| "data URL 格式无效".to_string())?;
    if meta.ends_with(";base64") || meta.contains(";base64;") {
        return general_purpose::STANDARD.decode(data).map_err(|e| format!("data URL base64 无效：{}", e));
    }
    percent_decode(data)
}

fn percent_decode(data: &str) -> Result<Vec<u8>, String> {
    let bytes = data.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|e| e.to_string())?;
            let value = u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?;
            out.push(value);
            i += 3;
        } else {
            out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
            i += 1;
        }
    }
    Ok(out)
}

fn write_placeholder_png(dest: &Path) -> Result<(), String> {
    let width = 1600u32;
    let height = 900u32;
    let mut img = image::RgbaImage::from_pixel(width, height, image::Rgba([7, 17, 29, 255]));
    for y in 0..height {
        for x in 0..width {
            let glow = (((x as f32 / width as f32) * 80.0) + ((1.0 - y as f32 / height as f32) * 40.0)) as u8;
            img.put_pixel(x, y, image::Rgba([7, 17 + glow / 3, 29 + glow / 2, 255]));
        }
    }
    img.save(dest).map_err(|e| format!("无法写入占位参考图：{}", e))
}

fn ensure_project_dirs(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("无法创建项目文件夹：{}", e))?;
    for child in ["media", ".frames", ".autosave", "exports"] {
        fs::create_dir_all(root.join(child)).map_err(|e| format!("无法创建 {}：{}", child, e))?;
    }
    Ok(())
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建父目录：{}", e))?;
    }
    Ok(())
}

fn rel_to_path(path: &str) -> PathBuf {
    path.replace('\\', "/").split('/').filter(|s| !s.is_empty()).collect()
}

fn modified_ms(path: &Path) -> u128 {
    fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|e| u128::MAX - e.as_millis()).unwrap_or(0)
}

fn safe_name(name: &str) -> String {
    let mut out: String = name.chars().map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() { '_' } else { c }).collect();
    out = out.trim().trim_matches('.').to_string();
    if out.is_empty() { "reference".to_string() } else { out.chars().take(80).collect() }
}

fn is_video(path: &Path) -> bool {
    matches!(path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("mp4" | "mov" | "m4v" | "webm" | "avi" | "mkv"))
}

fn resolve_ffmpeg() -> Result<PathBuf, String> {
    resolve_media_tool("ffmpeg", "SBR_FFMPEG")
}

fn resolve_ffprobe() -> Option<PathBuf> {
    resolve_media_tool("ffprobe", "SBR_FFPROBE").ok()
}

fn resolve_media_tool(tool: &str, env_key: &str) -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var(env_key) {
        let path = PathBuf::from(value.trim_matches('"'));
        if command_works(&path) {
            return Ok(path);
        }
        return Err(format!("{} 指向的 {} 不可用：{}", env_key, tool, path.to_string_lossy()));
    }

    for candidate in media_tool_candidates(tool) {
        if candidate.exists() && command_works(&candidate) {
            return Ok(candidate);
        }
    }

    let bare = PathBuf::from(tool);
    if command_works(&bare) {
        return Ok(bare);
    }

    Err(format!("找不到 {}。请设置 {}，或运行 npm run prepare:ffmpeg 生成打包用 sidecar。", tool, env_key))
}

fn command_works(path: &Path) -> bool {
    Command::new(path).arg("-version").output().map(|o| o.status.success()).unwrap_or(false)
}

fn media_tool_candidates(tool: &str) -> Vec<PathBuf> {
    let exe = if cfg!(windows) { format!("{}.exe", tool) } else { tool.to_string() };
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            bases.push(parent.to_path_buf());
            if let Some(grand) = parent.parent() { bases.push(grand.to_path_buf()); }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut current = Some(cwd.as_path());
        let mut hops = 0;
        while let Some(path) = current {
            bases.push(path.to_path_buf());
            current = path.parent();
            hops += 1;
            if hops > 5 { break; }
        }
    }

    let mut out = Vec::new();
    for base in bases {
        out.push(base.join("bin").join(&exe));
        out.push(base.join("resources").join("bin").join(&exe));
        out.push(base.join("_up_").join("bin").join(&exe));
        out.push(base.join("src-tauri").join("bin").join(&exe));
        if tool == "ffmpeg" {
            out.push(base.join("node_modules").join("ffmpeg-static").join(&exe));
        } else {
            out.push(base.join("node_modules").join("ffprobe-static").join("bin").join("win32").join("x64").join(&exe));
            out.push(base.join("node_modules").join("ffprobe-static").join("bin").join("darwin").join("x64").join(&exe));
            out.push(base.join("node_modules").join("ffprobe-static").join("bin").join("linux").join("x64").join(&exe));
        }
    }

    if cfg!(windows) {
        out.push(PathBuf::from(format!("C:/ProgramData/chocolatey/bin/{}", exe)));
        if let Ok(user) = std::env::var("USERPROFILE") {
            out.push(PathBuf::from(user).join("scoop").join("shims").join(&exe));
        }
        out.push(PathBuf::from(format!("C:/ffmpeg/bin/{}", exe)));
    } else {
        out.push(PathBuf::from(format!("/opt/homebrew/bin/{}", tool)));
        out.push(PathBuf::from(format!("/usr/local/bin/{}", tool)));
        out.push(PathBuf::from(format!("/usr/bin/{}", tool)));
    }
    out
}

fn probe_video(path: &Path) -> Option<(u32, u32, Option<f64>, Option<f64>)> {
    if let Some(ffprobe) = resolve_ffprobe() {
        if let Some(probed) = probe_video_with_ffprobe(&ffprobe, path) {
            return Some(probed);
        }
    }
    resolve_ffmpeg().ok().and_then(|ffmpeg| probe_video_with_ffmpeg(&ffmpeg, path))
}

fn probe_video_with_ffprobe(ffprobe: &Path, path: &Path) -> Option<(u32, u32, Option<f64>, Option<f64>)> {
    let output = Command::new(ffprobe)
        .args(["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format"])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() { return None; }
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    let stream = json.get("streams")?.as_array()?.iter().find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("video"))?;
    let width = stream.get("width")?.as_u64()? as u32;
    let height = stream.get("height")?.as_u64()? as u32;
    let fps = stream.get("r_frame_rate").and_then(|v| v.as_str()).and_then(parse_ratio);
    let duration = json.get("format").and_then(|f| f.get("duration")).and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok());
    Some((width, height, duration, fps))
}

fn probe_video_with_ffmpeg(ffmpeg: &Path, path: &Path) -> Option<(u32, u32, Option<f64>, Option<f64>)> {
    let output = Command::new(ffmpeg).arg("-i").arg(path).output().ok()?;
    let text = format!("{}{}", String::from_utf8_lossy(&output.stderr), String::from_utf8_lossy(&output.stdout));
    let (width, height) = parse_video_dimensions(&text)?;
    let duration = parse_ffmpeg_duration(&text);
    let fps = parse_ffmpeg_fps(&text);
    Some((width, height, duration, fps))
}

fn parse_video_dimensions(text: &str) -> Option<(u32, u32)> {
    for token in text.split(|c: char| c.is_whitespace() || c == ',' || c == '[' || c == ']') {
        let clean = token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != 'x');
        if let Some((w, h)) = clean.split_once('x') {
            let width = w.parse::<u32>().ok()?;
            let height = h.parse::<u32>().ok()?;
            if (16..=20000).contains(&width) && (16..=20000).contains(&height) {
                return Some((width, height));
            }
        }
    }
    None
}

fn parse_ffmpeg_duration(text: &str) -> Option<f64> {
    let start = text.find("Duration:")? + "Duration:".len();
    let value = text[start..].split(',').next()?.trim();
    let parts = value.split(':').collect::<Vec<_>>();
    if parts.len() != 3 { return None; }
    let h = parts[0].parse::<f64>().ok()?;
    let m = parts[1].parse::<f64>().ok()?;
    let s = parts[2].parse::<f64>().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

fn parse_ffmpeg_fps(text: &str) -> Option<f64> {
    for line in text.lines() {
        if let Some(idx) = line.find(" fps") {
            let prefix = &line[..idx];
            if let Some(raw) = prefix.split_whitespace().last() {
                if let Ok(value) = raw.parse::<f64>() {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn parse_ratio(value: &str) -> Option<f64> {
    let (a, b) = value.split_once('/')?;
    let num = a.parse::<f64>().ok()?;
    let den = b.parse::<f64>().ok()?;
    if den == 0.0 { None } else { Some(num / den) }
}

fn export_stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

fn csv_escape(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

const PDF_PAGE_W_PT: f32 = 842.0;
const PDF_PAGE_H_PT: f32 = 595.0;
const PDF_PAGE_W: u32 = 1684;
const PDF_PAGE_H: u32 = 1190;

#[derive(Clone, Copy, PartialEq)]
enum PdfTemplate {
    Director,
    Art,
}

#[derive(Clone, Copy, PartialEq)]
enum PdfTheme {
    Light,
    Dark,
}

#[derive(Clone, Copy)]
struct PdfRenderOptions {
    template: PdfTemplate,
    theme: PdfTheme,
}

#[derive(Clone, Copy)]
struct PdfPalette {
    page_bg: Rgba<u8>,
    header_bg: Rgba<u8>,
    header_accent: Rgba<u8>,
    header_text: Rgba<u8>,
    header_muted: Rgba<u8>,
    card_bg: Rgba<u8>,
    card_border: Rgba<u8>,
    card_rule: Rgba<u8>,
    index_bg: Rgba<u8>,
    index_text: Rgba<u8>,
    title_text: Rgba<u8>,
    body_text: Rgba<u8>,
    muted_text: Rgba<u8>,
    prompt_bg: Rgba<u8>,
    prompt_text: Rgba<u8>,
}

impl PdfRenderOptions {
    fn from_input(input: &ExportInput) -> Self {
        let template = match input.pdf_options.as_ref().and_then(|o| o.template.as_deref()) {
            Some("art") => PdfTemplate::Art,
            _ => PdfTemplate::Director,
        };
        let theme = match input.pdf_options.as_ref().and_then(|o| o.theme.as_deref()) {
            Some("dark") => PdfTheme::Dark,
            _ => PdfTheme::Light,
        };
        Self { template, theme }
    }

    fn file_suffix(&self) -> &'static str {
        match (self.template, self.theme) {
            (PdfTemplate::Director, PdfTheme::Light) => "director-light",
            (PdfTemplate::Director, PdfTheme::Dark) => "director-dark",
            (PdfTemplate::Art, PdfTheme::Light) => "art-light",
            (PdfTemplate::Art, PdfTheme::Dark) => "art-dark",
        }
    }

    fn template_label(&self) -> &'static str {
        match self.template {
            PdfTemplate::Director => "导演版",
            PdfTemplate::Art => "美术版",
        }
    }

    fn theme_label(&self) -> &'static str {
        match self.theme {
            PdfTheme::Light => "浅色",
            PdfTheme::Dark => "深色",
        }
    }

    fn palette(&self) -> PdfPalette {
        match self.theme {
            PdfTheme::Light => PdfPalette {
                page_bg: Rgba([238, 238, 232, 255]),
                header_bg: Rgba([22, 27, 36, 255]),
                header_accent: Rgba([232, 190, 98, 255]),
                header_text: Rgba([255, 255, 255, 255]),
                header_muted: Rgba([202, 213, 225, 255]),
                card_bg: Rgba([250, 248, 242, 255]),
                card_border: Rgba([190, 182, 168, 255]),
                card_rule: Rgba([215, 204, 184, 255]),
                index_bg: Rgba([31, 41, 55, 255]),
                index_text: Rgba([255, 255, 255, 255]),
                title_text: Rgba([26, 31, 40, 255]),
                body_text: Rgba([55, 65, 81, 255]),
                muted_text: Rgba([88, 96, 108, 255]),
                prompt_bg: Rgba([240, 236, 226, 255]),
                prompt_text: Rgba([45, 55, 72, 255]),
            },
            PdfTheme::Dark => PdfPalette {
                page_bg: Rgba([9, 13, 20, 255]),
                header_bg: Rgba([3, 8, 15, 255]),
                header_accent: Rgba([236, 185, 92, 255]),
                header_text: Rgba([248, 250, 252, 255]),
                header_muted: Rgba([148, 163, 184, 255]),
                card_bg: Rgba([17, 24, 34, 255]),
                card_border: Rgba([71, 85, 105, 255]),
                card_rule: Rgba([51, 65, 85, 255]),
                index_bg: Rgba([236, 185, 92, 255]),
                index_text: Rgba([11, 18, 26, 255]),
                title_text: Rgba([241, 245, 249, 255]),
                body_text: Rgba([203, 213, 225, 255]),
                muted_text: Rgba([148, 163, 184, 255]),
                prompt_bg: Rgba([25, 35, 48, 255]),
                prompt_text: Rgba([226, 232, 240, 255]),
            },
        }
    }
}

struct PdfPageImage {
    width: u32,
    height: u32,
    jpeg: Vec<u8>,
}

fn export_pdf_inner(input: &ExportInput, root: &Path, pdf_path: &Path) -> Result<(), String> {
    let font = load_pdf_font()?;
    let work = root.join(format!(".pdf-{}", Uuid::new_v4()));
    fs::create_dir_all(&work).map_err(|e| format!("无法创建 PDF 临时目录：{}", e))?;
    let options = PdfRenderOptions::from_input(input);

    let board_pages = ((input.frames.len() + 5) / 6).max(1);
    let total_pages = board_pages + 2;
    let mut pages = Vec::with_capacity(total_pages);
    pages.push(render_pdf_cover_page(input, 1, total_pages, &work, &font, options)?);
    pages.push(render_pdf_index_page(input, 2, total_pages, &font, options)?);
    for (board_page_index, chunk) in input.frames.chunks(6).enumerate() {
        pages.push(render_storyboard_pdf_page(input, chunk, board_page_index, board_pages, board_page_index + 3, total_pages, &work, &font, options)?);
    }
    let bytes = image_pages_to_pdf(&pages)?;
    fs::write(pdf_path, bytes).map_err(|e| format!("无法写入 PDF：{}", e))?;
    let _ = fs::remove_dir_all(&work);
    Ok(())
}

fn load_pdf_font() -> Result<FontArc, String> {
    if let Ok(path) = std::env::var("SBR_PDF_FONT") {
        if let Ok(bytes) = fs::read(path.trim_matches('"')) {
            if let Ok(font) = FontArc::try_from_vec(bytes) {
                return Ok(font);
            }
        }
    }

    let candidates = [
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simsun.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ];
    for candidate in candidates {
        if let Ok(bytes) = fs::read(candidate) {
            if let Ok(font) = FontArc::try_from_vec(bytes) {
                return Ok(font);
            }
        }
    }
    Err("找不到可用中文字体，无法生成图文 PDF。可设置 SBR_PDF_FONT 指向 SimHei、Microsoft YaHei 或 Noto Sans CJK 字体。".to_string())
}

fn render_pdf_cover_page(
    input: &ExportInput,
    page_no: usize,
    total_pages: usize,
    work: &Path,
    font: &FontArc,
    options: PdfRenderOptions,
) -> Result<PdfPageImage, String> {
    let palette = options.palette();
    let mut page = RgbaImage::from_pixel(PDF_PAGE_W, PDF_PAGE_H, palette.page_bg);

    draw_filled_rect_mut(&mut page, Rect::at(0, 0).of_size(PDF_PAGE_W, PDF_PAGE_H), palette.page_bg);
    draw_filled_rect_mut(&mut page, Rect::at(0, 0).of_size(PDF_PAGE_W, 238), palette.header_bg);
    draw_filled_rect_mut(&mut page, Rect::at(0, 226).of_size(PDF_PAGE_W, 8), palette.header_accent);
    draw_text_mut(&mut page, palette.header_accent, 58, 42, PxScale::from(24.0), font, "Storyboard Reference Studio");
    draw_text_mut(&mut page, palette.header_text, 56, 88, PxScale::from(58.0), font, trim_chars(&input.project_name, 26).as_str());
    draw_text_mut(
        &mut page,
        palette.header_muted,
        60,
        166,
        PxScale::from(24.0),
        font,
        &format!("中文分镜参考 / 镜头图像资料库 / 视觉风格检索工作台 · {} · {}版", options.template_label(), options.theme_label()),
    );
    draw_text_mut(&mut page, palette.header_accent, 1374, 54, PxScale::from(48.0), font, "SRS");
    draw_text_mut(&mut page, palette.header_muted, 1378, 116, PxScale::from(18.0), font, "BloomReel Team");

    if let Some(first) = input.frames.first() {
        let hero = render_pdf_thumb(first, work, 0, 720, 405)?;
        imageops::overlay(&mut page, &hero, 886, 304);
        draw_hollow_rect_mut(&mut page, Rect::at(886, 304).of_size(720, 405), palette.card_border);
        draw_text_mut(&mut page, palette.muted_text, 886, 724, PxScale::from(18.0), font, "封面参考帧：首张镜头图像");
    }

    let scene_index = compact_scene_index(&input.frames);
    draw_wrapped_text(
        &mut page,
        font,
        "本 PDF 面向导演、摄影、美术、AI 视觉开发与片场沟通，包含封面、目录、2x3 图文分镜页、打印出血参考和片场签批栏。",
        64,
        306,
        720,
        25.0,
        palette.body_text,
        3,
    );
    draw_pdf_stat_box(&mut page, font, "参考卡", &input.frames.len().to_string(), 64, 444, &palette);
    draw_pdf_stat_box(&mut page, font, "分镜页", &(((input.frames.len() + 5) / 6).max(1)).to_string(), 292, 444, &palette);
    draw_pdf_stat_box(&mut page, font, "场次索引", &trim_chars(&scene_index, 22), 520, 444, &palette);

    draw_filled_rect_mut(&mut page, Rect::at(64, 604).of_size(720, 170), palette.card_bg);
    draw_hollow_rect_mut(&mut page, Rect::at(64, 604).of_size(720, 170), palette.card_border);
    draw_text_mut(&mut page, palette.title_text, 92, 632, PxScale::from(24.0), font, "交付说明");
    draw_wrapped_text(
        &mut page,
        font,
        "导演版聚焦场次用途、运动/转场与调度意图；美术版聚焦构图、光线、色彩/情绪和视觉开发用途。深色版适合屏幕审阅，浅色版适合打印批注。",
        92,
        674,
        660,
        20.0,
        palette.body_text,
        4,
    );

    draw_pdf_approval_bar(&mut page, font, PDF_PAGE_H - 148, &palette, options);
    draw_pdf_bleed_marks(&mut page, font, &palette);
    draw_pdf_footer(&mut page, font, page_no, total_pages, "封面页 / Cover", &palette);
    encode_pdf_page(page)
}

fn render_pdf_index_page(
    input: &ExportInput,
    page_no: usize,
    total_pages: usize,
    font: &FontArc,
    options: PdfRenderOptions,
) -> Result<PdfPageImage, String> {
    let palette = options.palette();
    let mut page = RgbaImage::from_pixel(PDF_PAGE_W, PDF_PAGE_H, palette.page_bg);
    draw_pdf_bleed_marks(&mut page, font, &palette);
    draw_filled_rect_mut(&mut page, Rect::at(0, 0).of_size(PDF_PAGE_W, 138), palette.header_bg);
    draw_text_mut(&mut page, palette.header_accent, 52, 20, PxScale::from(20.0), font, "Storyboard Reference Studio");
    draw_text_mut(&mut page, palette.header_text, 50, 52, PxScale::from(40.0), font, "目录 / 场次索引");
    draw_text_mut(
        &mut page,
        palette.header_muted,
        52,
        103,
        PxScale::from(21.0),
        font,
        &format!("{} · {}版 · {} 条参考 · 分镜页从第 3 页开始", options.template_label(), options.theme_label(), input.frames.len()),
    );

    let x = 58u32;
    let y0 = 178u32;
    let row_h = 46u32;
    let table_w = PDF_PAGE_W - x * 2;
    draw_filled_rect_mut(&mut page, Rect::at(x as i32, y0 as i32).of_size(table_w, 44), palette.index_bg);
    draw_text_mut(&mut page, palette.index_text, (x + 18) as i32, (y0 + 12) as i32, PxScale::from(17.0), font, "序号");
    draw_text_mut(&mut page, palette.index_text, (x + 120) as i32, (y0 + 12) as i32, PxScale::from(17.0), font, "场次/镜号");
    draw_text_mut(&mut page, palette.index_text, (x + 318) as i32, (y0 + 12) as i32, PxScale::from(17.0), font, "镜头标题");
    draw_text_mut(&mut page, palette.index_text, (x + 820) as i32, (y0 + 12) as i32, PxScale::from(17.0), font, "镜头/用途");
    draw_text_mut(&mut page, palette.index_text, (x + 1410) as i32, (y0 + 12) as i32, PxScale::from(17.0), font, "页码");

    let max_rows = 18usize;
    for (i, frame) in input.frames.iter().take(max_rows).enumerate() {
        let row_y = y0 + 44 + i as u32 * row_h;
        let bg = if i % 2 == 0 { palette.card_bg } else { palette.prompt_bg };
        draw_filled_rect_mut(&mut page, Rect::at(x as i32, row_y as i32).of_size(table_w, row_h), bg);
        draw_hollow_rect_mut(&mut page, Rect::at(x as i32, row_y as i32).of_size(table_w, row_h), palette.card_border);
        let shot = frame.shot.as_ref();
        let reference = frame.reference.as_ref();
        let scene_no = json_str(shot, "sceneNo").unwrap_or_else(|| json_str(reference, "scene").unwrap_or_else(|| "未分场".to_string()));
        let shot_no = json_str(shot, "shotNo").unwrap_or_default();
        let shot_ref = join_slash(&[scene_no.as_str(), shot_no.as_str()]);
        let shot_type = json_str(reference, "shotType").or_else(|| json_str(shot, "shotSize")).unwrap_or_else(|| "镜头参考".to_string());
        let usage = json_str(reference, "shotUsage").unwrap_or_else(|| note_field(&frame.notes, "可用于").unwrap_or_default());
        let target_page = 3 + (i / 6);
        draw_text_mut(&mut page, palette.body_text, (x + 20) as i32, (row_y + 13) as i32, PxScale::from(16.0), font, &format!("{:02}", i + 1));
        draw_text_mut(&mut page, palette.body_text, (x + 120) as i32, (row_y + 13) as i32, PxScale::from(16.0), font, trim_chars(&shot_ref, 18).as_str());
        draw_text_mut(&mut page, palette.title_text, (x + 318) as i32, (row_y + 13) as i32, PxScale::from(16.0), font, trim_chars(&frame.label, 34).as_str());
        draw_text_mut(&mut page, palette.body_text, (x + 820) as i32, (row_y + 13) as i32, PxScale::from(16.0), font, trim_chars(&join_slash(&[shot_type.as_str(), usage.as_str()]), 46).as_str());
        draw_text_mut(&mut page, palette.body_text, (x + 1420) as i32, (row_y + 13) as i32, PxScale::from(16.0), font, &target_page.to_string());
    }
    if input.frames.len() > max_rows {
        draw_text_mut(
            &mut page,
            palette.muted_text,
            x as i32,
            (y0 + 44 + max_rows as u32 * row_h + 24) as i32,
            PxScale::from(18.0),
            font,
            &format!("其余 {} 条参考继续按每页 6 条排入后续图文分镜页。", input.frames.len() - max_rows),
        );
    }

    draw_pdf_approval_bar(&mut page, font, PDF_PAGE_H - 148, &palette, options);
    draw_pdf_footer(&mut page, font, page_no, total_pages, "目录页 / Index", &palette);
    encode_pdf_page(page)
}

fn render_storyboard_pdf_page(
    input: &ExportInput,
    frames: &[ExportFrameInput],
    board_page_index: usize,
    board_page_count: usize,
    pdf_page_no: usize,
    pdf_total_pages: usize,
    work: &Path,
    font: &FontArc,
    options: PdfRenderOptions,
) -> Result<PdfPageImage, String> {
    let palette = options.palette();
    let scene_index = compact_scene_index(frames);
    let mut page = RgbaImage::from_pixel(PDF_PAGE_W, PDF_PAGE_H, palette.page_bg);
    draw_pdf_bleed_marks(&mut page, font, &palette);
    draw_filled_rect_mut(&mut page, Rect::at(0, 0).of_size(PDF_PAGE_W, 138), palette.header_bg);
    draw_text_mut(&mut page, palette.header_accent, 52, 20, PxScale::from(20.0), font, "Storyboard Reference Studio");
    draw_text_mut(&mut page, palette.header_text, 50, 52, PxScale::from(40.0), font, trim_chars(&input.project_name, 30).as_str());
    draw_text_mut(
        &mut page,
        palette.header_muted,
        52,
        103,
        PxScale::from(21.0),
        font,
        &format!("{} · {}版 · 场次/镜号索引：{} · 第 {}/{} 页 · 共 {} 条参考", options.template_label(), options.theme_label(), scene_index, pdf_page_no, pdf_total_pages, input.frames.len()),
    );
    draw_text_mut(&mut page, palette.header_accent, 1330, 32, PxScale::from(34.0), font, "SRS");
    draw_text_mut(
        &mut page,
        palette.header_muted,
        1332,
        80,
        PxScale::from(18.0),
        font,
        "中文分镜参考 / 镜头图像资料库",
    );

    let margin = 46u32;
    let gap = 24u32;
    let top = 162u32;
    let bottom_zone = 98u32;
    let cell_w = (PDF_PAGE_W - margin * 2 - gap) / 2;
    let cell_h = (PDF_PAGE_H - top - bottom_zone - gap * 2) / 3;

    for (i, frame) in frames.iter().enumerate() {
        let col = (i % 2) as u32;
        let row = (i / 2) as u32;
        let x = margin + col * (cell_w + gap);
        let y = top + row * (cell_h + gap);
        draw_pdf_card(&mut page, frame, board_page_index * 6 + i, x, y, cell_w, cell_h, work, font, options)?;
    }

    draw_pdf_approval_bar(&mut page, font, PDF_PAGE_H - 84, &palette, options);
    draw_text_mut(
        &mut page,
        palette.muted_text,
        52,
        (PDF_PAGE_H - 32) as i32,
        PxScale::from(18.0),
        font,
        &format!("Storyboard Reference Studio - {} - 分镜页 {}/{} - PDF 第 {}/{} 页 - 场次索引：{}", options.template_label(), board_page_index + 1, board_page_count, pdf_page_no, pdf_total_pages, scene_index),
    );

    encode_pdf_page(page)
}

#[allow(clippy::too_many_arguments)]
fn draw_pdf_card(
    page: &mut RgbaImage,
    frame: &ExportFrameInput,
    index: usize,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    work: &Path,
    font: &FontArc,
    options: PdfRenderOptions,
) -> Result<(), String> {
    let palette = options.palette();
    draw_filled_rect_mut(page, Rect::at(x as i32, y as i32).of_size(w, h), palette.card_bg);
    draw_hollow_rect_mut(page, Rect::at(x as i32, y as i32).of_size(w, h), palette.card_border);
    draw_line_segment_mut(page, (x as f32, (y + 44) as f32), ((x + w) as f32, (y + 44) as f32), palette.card_rule);

    let shot = frame.shot.as_ref();
    let reference = frame.reference.as_ref();
    let scene_no = json_str(shot, "sceneNo").unwrap_or_default();
    let shot_no = json_str(shot, "shotNo").unwrap_or_default();
    let index_label = if !scene_no.is_empty() || !shot_no.is_empty() {
        trim_chars(&format!("{}{}", scene_no, if shot_no.is_empty() { String::new() } else { format!("-{}", shot_no) }), 8)
    } else {
        format!("{:02}", index + 1)
    };

    draw_filled_rect_mut(page, Rect::at((x + 14) as i32, (y + 10) as i32).of_size(78, 26), palette.index_bg);
    draw_text_mut(page, palette.index_text, (x + 22) as i32, (y + 13) as i32, PxScale::from(16.0), font, &index_label);
    draw_text_mut(page, palette.title_text, (x + 104) as i32, (y + 12) as i32, PxScale::from(21.0), font, trim_chars(&frame.label, 30).as_str());

    let thumb_w = (w as f32 * 0.40) as u32;
    let thumb_h = ((thumb_w as f32) * 9.0 / 16.0) as u32;
    let thumb_x = x + 18;
    let thumb_y = y + 62;
    let thumb = render_pdf_thumb(frame, work, index, thumb_w, thumb_h)?;
    imageops::overlay(page, &thumb, thumb_x.into(), thumb_y.into());
    draw_hollow_rect_mut(page, Rect::at(thumb_x as i32, thumb_y as i32).of_size(thumb_w, thumb_h), palette.card_border);

    let text_x = thumb_x + thumb_w + 18;
    let text_w = x + w - text_x - 18;
    let mut cursor_y = y + 62;
    let scene = json_str(reference, "scene").or_else(|| json_str(shot, "sceneNo")).unwrap_or_else(|| "未分场".to_string());
    let shot_type = json_str(reference, "shotType").or_else(|| json_str(shot, "shotSize")).unwrap_or_else(|| "镜头参考".to_string());
    let lens = json_str(shot, "lens").unwrap_or_default();
    let movement = json_str(shot, "movement").unwrap_or_default();
    let transition = json_str(shot, "transition").unwrap_or_default();
    let lighting = json_str(reference, "lighting").unwrap_or_else(|| note_field(&frame.notes, "光线").unwrap_or_default());
    let color = json_str(reference, "color").unwrap_or_else(|| note_field(&frame.notes, "色彩").unwrap_or_default());
    let mood = json_str(reference, "mood").unwrap_or_else(|| note_field(&frame.notes, "情绪").unwrap_or_default());
    let composition = json_str(reference, "composition").unwrap_or_else(|| note_field(&frame.notes, "构图").unwrap_or_default());
    let purpose = json_str(reference, "purpose").unwrap_or_else(|| note_field(&frame.notes, "用途").unwrap_or_default());
    let usage = json_str(reference, "shotUsage").unwrap_or_else(|| note_field(&frame.notes, "可用于").unwrap_or_default());
    let prompt_note = json_str(reference, "aiPromptNote").unwrap_or_else(|| note_field(&frame.notes, "AI 提示词备注").unwrap_or_default());

    cursor_y = draw_wrapped_text(page, font, &format!("{} / {}", scene, shot_type), text_x, cursor_y, text_w, 17.5, palette.body_text, 2);
    let meta = [&shot_no, &lens, &movement].into_iter().filter(|s| !s.trim().is_empty()).map(|s| s.as_str()).collect::<Vec<_>>().join(" / ");
    if !meta.is_empty() {
        cursor_y = draw_wrapped_text(page, font, &meta, text_x, cursor_y + 4, text_w, 15.5, palette.muted_text, 1);
    }
    cursor_y += 8;

    if options.template == PdfTemplate::Director {
        cursor_y = draw_label_value(page, font, "场次用途", &usage, text_x, cursor_y, text_w, 1, &palette);
        cursor_y = draw_label_value(page, font, "运动/转场", &join_slash(&[movement.as_str(), transition.as_str()]), text_x, cursor_y, text_w, 1, &palette);
        cursor_y = draw_label_value(page, font, "构图调度", &composition, text_x, cursor_y, text_w, 2, &palette);
        let _ = draw_label_value(page, font, "导演意图", &purpose, text_x, cursor_y, text_w, 2, &palette);
    } else {
        cursor_y = draw_label_value(page, font, "构图", &composition, text_x, cursor_y, text_w, 2, &palette);
        cursor_y = draw_label_value(page, font, "光线", &lighting, text_x, cursor_y, text_w, 1, &palette);
        cursor_y = draw_label_value(page, font, "色彩/情绪", &join_slash(&[color.as_str(), mood.as_str()]), text_x, cursor_y, text_w, 1, &palette);
        let _ = draw_label_value(page, font, "美术用途", &purpose, text_x, cursor_y, text_w, 2, &palette);
    }

    let prompt_y = y + h.saturating_sub(72);
    let prompt_w = w - 36;
    let prompt = if !frame.prompt_text.trim().is_empty() { frame.prompt_text.as_str() } else { prompt_note.as_str() };
    draw_filled_rect_mut(page, Rect::at((x + 18) as i32, prompt_y as i32).of_size(prompt_w, 54), palette.prompt_bg);
    let prompt_title = if options.template == PdfTemplate::Director { "导演版 AI 动态分镜提示词" } else { "美术版 AI 图像/视频提示词" };
    draw_wrapped_text(page, font, &format!("{}：{}", prompt_title, prompt), x + 30, prompt_y + 10, prompt_w - 24, 15.5, palette.prompt_text, 2);
    Ok(())
}

fn draw_pdf_bleed_marks(page: &mut RgbaImage, font: &FontArc, palette: &PdfPalette) {
    let bleed = 24.0f32;
    let safe = 52.0f32;
    let w = PDF_PAGE_W as f32;
    let h = PDF_PAGE_H as f32;
    let mark = palette.header_accent;
    let rule = palette.card_border;

    draw_line_segment_mut(page, (bleed, 0.0), (bleed, 34.0), mark);
    draw_line_segment_mut(page, (0.0, bleed), (34.0, bleed), mark);
    draw_line_segment_mut(page, (w - bleed, 0.0), (w - bleed, 34.0), mark);
    draw_line_segment_mut(page, (w - 34.0, bleed), (w, bleed), mark);
    draw_line_segment_mut(page, (bleed, h - 34.0), (bleed, h), mark);
    draw_line_segment_mut(page, (0.0, h - bleed), (34.0, h - bleed), mark);
    draw_line_segment_mut(page, (w - bleed, h - 34.0), (w - bleed, h), mark);
    draw_line_segment_mut(page, (w - 34.0, h - bleed), (w, h - bleed), mark);

    draw_hollow_rect_mut(
        page,
        Rect::at(safe as i32, safe as i32).of_size((w - safe * 2.0) as u32, (h - safe * 2.0) as u32),
        rule,
    );
    draw_text_mut(page, palette.muted_text, 58, (PDF_PAGE_H - 58) as i32, PxScale::from(14.0), font, "3mm 出血线 / 安全框参考");
}

fn draw_pdf_stat_box(page: &mut RgbaImage, font: &FontArc, label: &str, value: &str, x: u32, y: u32, palette: &PdfPalette) {
    draw_filled_rect_mut(page, Rect::at(x as i32, y as i32).of_size(192, 104), palette.card_bg);
    draw_hollow_rect_mut(page, Rect::at(x as i32, y as i32).of_size(192, 104), palette.card_border);
    draw_text_mut(page, palette.muted_text, (x + 18) as i32, (y + 18) as i32, PxScale::from(17.0), font, label);
    draw_wrapped_text(page, font, value, x + 18, y + 48, 154, 24.0, palette.title_text, 2);
}

fn draw_pdf_approval_bar(page: &mut RgbaImage, font: &FontArc, y: u32, palette: &PdfPalette, options: PdfRenderOptions) {
    let x = 52u32;
    let h = 54u32;
    let w = PDF_PAGE_W - x * 2;
    draw_filled_rect_mut(page, Rect::at(x as i32, y as i32).of_size(w, h), palette.card_bg);
    draw_hollow_rect_mut(page, Rect::at(x as i32, y as i32).of_size(w, h), palette.card_border);
    draw_text_mut(page, palette.title_text, (x + 18) as i32, (y + 16) as i32, PxScale::from(17.0), font, "片场签批栏");
    draw_text_mut(
        page,
        palette.muted_text,
        (x + 126) as i32,
        (y + 17) as i32,
        PxScale::from(15.0),
        font,
        &format!("{} · {}版 · 打印后签字确认", options.template_label(), options.theme_label()),
    );

    let labels = ["导演", "摄影指导", "美术指导", "制片", "日期"];
    let mut box_x = x + 430;
    for label in labels {
        draw_text_mut(page, palette.muted_text, box_x as i32, (y + 17) as i32, PxScale::from(15.0), font, label);
        draw_line_segment_mut(page, ((box_x + 72) as f32, (y + 36) as f32), ((box_x + 205) as f32, (y + 36) as f32), palette.card_border);
        box_x += 218;
    }
}

fn draw_pdf_footer(page: &mut RgbaImage, font: &FontArc, page_no: usize, total_pages: usize, label: &str, palette: &PdfPalette) {
    draw_text_mut(
        page,
        palette.muted_text,
        52,
        (PDF_PAGE_H - 32) as i32,
        PxScale::from(18.0),
        font,
        &format!("Storyboard Reference Studio - {} - 第 {}/{} 页", label, page_no, total_pages),
    );
}

fn encode_pdf_page(page: RgbaImage) -> Result<PdfPageImage, String> {
    let mut jpeg = Vec::new();
    let rgb = DynamicImage::ImageRgba8(page).to_rgb8();
    let dyn_img = DynamicImage::ImageRgb8(rgb);
    let mut encoder = JpegEncoder::new_with_quality(&mut jpeg, 92);
    encoder.encode_image(&dyn_img).map_err(|e| format!("PDF 页面 JPEG 编码失败：{}", e))?;
    Ok(PdfPageImage { width: PDF_PAGE_W, height: PDF_PAGE_H, jpeg })
}

fn draw_label_value(
    page: &mut RgbaImage,
    font: &FontArc,
    label: &str,
    value: &str,
    x: u32,
    y: u32,
    max_w: u32,
    max_lines: usize,
    palette: &PdfPalette,
) -> u32 {
    if value.trim().is_empty() {
        return y;
    }
    draw_text_mut(page, palette.title_text, x as i32, y as i32, PxScale::from(15.5), font, &format!("{}：", label));
    let label_w = text_size(PxScale::from(15.5), font, &format!("{}：", label)).0 + 4;
    draw_wrapped_text(page, font, value, x + label_w, y, max_w.saturating_sub(label_w), 15.5, palette.body_text, max_lines)
}

#[allow(clippy::too_many_arguments)]
fn draw_wrapped_text(
    page: &mut RgbaImage,
    font: &FontArc,
    text: &str,
    x: u32,
    y: u32,
    max_w: u32,
    size: f32,
    color: Rgba<u8>,
    max_lines: usize,
) -> u32 {
    if max_lines == 0 || max_w == 0 {
        return y;
    }
    let scale = PxScale::from(size);
    let line_h = (size * 1.32).ceil() as u32;
    let mut out_y = y;
    let mut lines = 0usize;
    let mut line = String::new();
    let normalized = text.replace('\n', " ");
    for ch in normalized.chars() {
        let candidate = format!("{}{}", line, ch);
        if text_size(scale, font, candidate.trim()).0 > max_w && !line.trim().is_empty() {
            draw_text_mut(page, color, x as i32, out_y as i32, scale, font, line.trim());
            out_y += line_h;
            lines += 1;
            if lines >= max_lines { return out_y; }
            line.clear();
            if !ch.is_whitespace() { line.push(ch); }
        } else {
            line = candidate;
        }
    }
    if !line.trim().is_empty() && lines < max_lines {
        draw_text_mut(page, color, x as i32, out_y as i32, scale, font, line.trim());
        out_y += line_h;
    }
    out_y
}

fn render_pdf_thumb(frame: &ExportFrameInput, work: &Path, index: usize, target_w: u32, target_h: u32) -> Result<RgbaImage, String> {
    let source = materialize_export_source(frame, work, index)?;
    let img = image::open(&source).unwrap_or_else(|_| DynamicImage::ImageRgba8(placeholder_image(1600, 900)));
    let cropped = crop_dynamic_image(img, &frame.crop, frame.source_width, frame.source_height);
    Ok(resize_cover(&cropped, target_w, target_h))
}

fn crop_dynamic_image(img: DynamicImage, crop: &serde_json::Value, source_w: u32, source_h: u32) -> DynamicImage {
    let Some(obj) = crop.as_object() else { return img; };
    let (iw, ih) = img.dimensions();
    let base_w = if source_w > 0 { source_w } else { iw };
    let base_h = if source_h > 0 { source_h } else { ih };
    let x = obj.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(0.0, 1.0);
    let y = obj.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(0.0, 1.0);
    let w = obj.get("w").and_then(|v| v.as_f64()).unwrap_or(1.0).clamp(0.01, 1.0);
    let h = obj.get("h").and_then(|v| v.as_f64()).unwrap_or(1.0).clamp(0.01, 1.0);
    let sx = iw as f64 / base_w.max(1) as f64;
    let sy = ih as f64 / base_h.max(1) as f64;
    let cx = ((x * base_w as f64) * sx).round().clamp(0.0, (iw.saturating_sub(1)) as f64) as u32;
    let cy = ((y * base_h as f64) * sy).round().clamp(0.0, (ih.saturating_sub(1)) as f64) as u32;
    let cw = ((w * base_w as f64) * sx).round().max(1.0) as u32;
    let ch = ((h * base_h as f64) * sy).round().max(1.0) as u32;
    img.crop_imm(cx, cy, cw.min(iw - cx), ch.min(ih - cy))
}

fn resize_cover(img: &DynamicImage, target_w: u32, target_h: u32) -> RgbaImage {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    if w == 0 || h == 0 || target_w == 0 || target_h == 0 {
        return placeholder_image(target_w.max(1), target_h.max(1));
    }
    let scale = (target_w as f32 / w as f32).max(target_h as f32 / h as f32);
    let new_w = ((w as f32 * scale).ceil() as u32).max(target_w);
    let new_h = ((h as f32 * scale).ceil() as u32).max(target_h);
    let resized = imageops::resize(&rgba, new_w, new_h, imageops::FilterType::Lanczos3);
    let ox = (new_w - target_w) / 2;
    let oy = (new_h - target_h) / 2;
    imageops::crop_imm(&resized, ox, oy, target_w, target_h).to_image()
}

fn placeholder_image(width: u32, height: u32) -> RgbaImage {
    let mut img = RgbaImage::from_pixel(width, height, Rgba([10, 17, 27, 255]));
    for y in 0..height {
        for x in 0..width {
            let glow = (((x as f32 / width.max(1) as f32) * 70.0) + ((1.0 - y as f32 / height.max(1) as f32) * 48.0)) as u8;
            img.put_pixel(x, y, Rgba([10, 17 + glow / 3, 27 + glow / 2, 255]));
        }
    }
    img
}

fn join_slash(parts: &[&str]) -> String {
    parts.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" / ")
}

fn compact_scene_index(frames: &[ExportFrameInput]) -> String {
    let mut out: Vec<String> = Vec::new();
    for frame in frames {
        let shot = frame.shot.as_ref();
        let reference = frame.reference.as_ref();
        let scene_no = json_str(shot, "sceneNo").unwrap_or_default();
        let shot_no = json_str(shot, "shotNo").unwrap_or_default();
        let value = if !scene_no.is_empty() || !shot_no.is_empty() {
            join_slash(&[scene_no.as_str(), shot_no.as_str()]).replace(" / ", "-")
        } else {
            json_str(reference, "scene").unwrap_or_default()
        };
        if !value.trim().is_empty() && !out.iter().any(|x| x == &value) {
            out.push(value);
        }
        if out.len() >= 6 {
            break;
        }
    }
    if out.is_empty() { "未分场".to_string() } else { out.join(" / ") }
}

fn json_str(value: Option<&serde_json::Value>, key: &str) -> Option<String> {
    value
        .and_then(|v| v.get(key))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

fn note_field(notes: &str, label: &str) -> Option<String> {
    let needle = format!("{}：", label);
    notes.lines().find_map(|line| line.trim().strip_prefix(&needle).map(|v| v.trim().to_string())).filter(|v| !v.is_empty())
}

fn trim_chars(value: &str, max: usize) -> String {
    let mut out = value.chars().take(max).collect::<String>();
    if value.chars().count() > max {
        out.push_str("...");
    }
    out
}

fn image_pages_to_pdf(pages: &[PdfPageImage]) -> Result<Vec<u8>, String> {
    let page_count = pages.len();
    let object_count = 2 + page_count * 3;
    let mut objects = vec![Vec::<u8>::new(); object_count + 1];
    let kids = (0..page_count).map(|i| format!("{} 0 R", 3 + i * 3)).collect::<Vec<_>>().join(" ");
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>".to_vec();
    objects[2] = format!("<< /Type /Pages /Kids [{}] /Count {} >>", kids, page_count).into_bytes();

    for (i, page) in pages.iter().enumerate() {
        let page_obj = 3 + i * 3;
        let image_obj = page_obj + 1;
        let content_obj = page_obj + 2;
        let content = format!("q\n{} 0 0 {} 0 0 cm\n/Im{} Do\nQ\n", PDF_PAGE_W_PT, PDF_PAGE_H_PT, i);
        objects[page_obj] = format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /XObject << /Im{} {} 0 R >> >> /Contents {} 0 R >>",
            PDF_PAGE_W_PT, PDF_PAGE_H_PT, i, image_obj, content_obj
        ).into_bytes();
        let mut image_stream = format!(
            "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
            page.width, page.height, page.jpeg.len()
        ).into_bytes();
        image_stream.extend_from_slice(&page.jpeg);
        image_stream.extend_from_slice(b"\nendstream");
        objects[image_obj] = image_stream;
        objects[content_obj] = format!("<< /Length {} >>\nstream\n{}endstream", content.len(), content).into_bytes();
    }

    let mut pdf = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = vec![0usize; object_count + 1];
    for id in 1..=object_count {
        offsets[id] = pdf.len();
        pdf.extend_from_slice(format!("{} 0 obj\n", id).as_bytes());
        pdf.extend_from_slice(&objects[id]);
        pdf.extend_from_slice(b"\nendobj\n");
    }
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", object_count + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{:010} 00000 n \n", offset).as_bytes());
    }
    pdf.extend_from_slice(format!("trailer << /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", object_count + 1, xref).as_bytes());
    Ok(pdf)
}


#[cfg(test)]
mod tests {
    use super::*;

    fn command_available(name: &str) -> bool {
        Command::new(name).arg("-version").output().map(|o| o.status.success()).unwrap_or(false)
    }

    #[test]
    fn export_pdf_writes_storyboard_grid() {
        if load_pdf_font().is_err() {
            eprintln!("PDF font not available; skipping PDF grid export test");
            return;
        }

        let root = std::env::temp_dir().join(format!("sbr-pdf-test-{}.sbref", Uuid::new_v4()));
        let exports = root.join("exports");
        fs::create_dir_all(&exports).unwrap();

        let mut frames = Vec::new();
        for i in 0..6u32 {
            let png = root.join(format!("pdf-frame-{}.png", i + 1));
            let mut img = RgbaImage::from_pixel(640, 360, Rgba([12, 20, 32, 255]));
            for y in 0..360u32 {
                for x in 0..640u32 {
                    img.put_pixel(x, y, Rgba([
                        ((x + i * 21) % 255) as u8,
                        ((y * 2 + i * 31) % 255) as u8,
                        ((x / 2 + y / 3 + i * 43) % 255) as u8,
                        255,
                    ]));
                }
            }
            img.save(&png).unwrap();

            frames.push(ExportFrameInput {
                source_png: png.to_string_lossy().to_string(),
                label: format!("雨夜灯塔测试镜头 {}", i + 1),
                notes: "构图：前景遮挡与纵深引导线\n光线：灯塔扫光与雨夜反光\n色彩：冷蓝海雾与暖黄灯芯\n情绪：悬疑、孤独、压迫\n用途：PDF 图文页验收\nAI 提示词备注：cinematic lighthouse storm reference".to_string(),
                prompt_text: "雨夜灯塔分镜参考，湿润玻璃，扫光，冷蓝与暖黄对比，电影感构图。".to_string(),
                profile_id: "generic".to_string(),
                crop: serde_json::json!({ "aspect": "16:9", "x": 0, "y": 0, "w": 1, "h": 1 }),
                source_width: 640,
                source_height: 360,
                time_s: i as f64,
                media_name: "pdf-test.png".to_string(),
                duration_s: Some(2.0),
                shot: Some(serde_json::json!({
                    "sceneNo": "S01",
                    "shotNo": format!("{:03}", i + 1),
                    "shotSize": "中景",
                    "cameraAngle": "平视",
                    "lens": "35mm",
                    "movement": "缓慢推近",
                    "transition": "切"
                })),
                reference: Some(serde_json::json!({
                    "scene": "灯塔楼梯井",
                    "shotType": "中景 / 图文验收",
                    "composition": "螺旋楼梯形成几何压迫，人物剪影靠右",
                    "lighting": "灯塔扫光、手电硬光、雨夜环境反射",
                    "color": "冷蓝、墨绿、暖黄",
                    "mood": "紧张、孤独、危险",
                    "purpose": "验证 2x3 PDF 图文分镜页",
                    "shotUsage": "自动化测试 / PDF 导出",
                    "tags": ["PDF", "分镜", "灯塔", "雨夜"],
                    "aiPromptNote": "lighthouse storyboard PDF card visual prompt"
                })),
                annotations: None,
            });
        }

        let out = export_pdf(ExportInput {
            project_name: "雨夜灯塔 PDF 验收".to_string(),
            exports_root: exports.to_string_lossy().to_string(),
            frames,
            pdf_options: Some(PdfExportOptions { template: Some("art".to_string()), theme: Some("dark".to_string()) }),
        });
        assert!(out.ok, "PDF export failed: {:?}", out.error);
        let path = PathBuf::from(&out.pdf_path);
        assert!(path.exists());
        assert!(fs::metadata(&path).unwrap().len() > 100_000);
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.starts_with(b"%PDF-1.4"));
        let content = String::from_utf8_lossy(&bytes);
        assert!(content.contains("/XObject"));
        assert!(content.contains("/DCTDecode"));
    }

    #[test]
    fn export_animatic_writes_real_mp4() {
        if !command_available("ffmpeg") || !command_available("ffprobe") {
            eprintln!("ffmpeg/ffprobe not available; skipping animatic export test");
            return;
        }

        let root = std::env::temp_dir().join(format!("sbr-animatic-test-{}.sbref", Uuid::new_v4()));
        let exports = root.join("exports");
        fs::create_dir_all(&exports).unwrap();

        let red = root.join("red.png");
        let blue = root.join("blue.png");
        image::RgbaImage::from_pixel(640, 360, image::Rgba([180, 24, 32, 255])).save(&red).unwrap();
        image::RgbaImage::from_pixel(640, 360, image::Rgba([24, 64, 190, 255])).save(&blue).unwrap();

        let input = ExportInput {
            project_name: "测试动态分镜".to_string(),
            exports_root: exports.to_string_lossy().to_string(),
            pdf_options: None,
            frames: vec![
                ExportFrameInput {
                    source_png: red.to_string_lossy().to_string(),
                    label: "红色测试帧".to_string(),
                    notes: String::new(),
                    prompt_text: String::new(),
                    profile_id: "generic".to_string(),
                    crop: serde_json::json!(null),
                    source_width: 640,
                    source_height: 360,
                    time_s: 0.0,
                    media_name: "red.png".to_string(),
                    duration_s: Some(0.5),
                    shot: None,
                    reference: None,
                    annotations: None,
                },
                ExportFrameInput {
                    source_png: blue.to_string_lossy().to_string(),
                    label: "蓝色测试帧".to_string(),
                    notes: String::new(),
                    prompt_text: String::new(),
                    profile_id: "generic".to_string(),
                    crop: serde_json::json!({ "aspect": "16:9", "x": 0, "y": 0, "w": 1, "h": 1 }),
                    source_width: 640,
                    source_height: 360,
                    time_s: 0.5,
                    media_name: "blue.png".to_string(),
                    duration_s: Some(0.75),
                    shot: None,
                    reference: None,
                    annotations: None,
                },
            ],
        };

        let out = export_animatic(input, AnimaticOptions {
            burn_label: Some(false),
            burn_shot_number: Some(true),
            fade: Some(true),
            fade_duration_s: Some(0.12),
            validate_audio: Some(false),
            audio_path: None,
        });
        assert!(out.ok, "animatic export failed: {:?}", out.error);
        assert!(PathBuf::from(&out.video_path).exists());

        let probe = Command::new("ffprobe")
            .args(["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format"])
            .arg(&out.video_path)
            .output()
            .unwrap();
        assert!(probe.status.success(), "ffprobe failed: {}", String::from_utf8_lossy(&probe.stderr));
        let json: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
        let stream = json["streams"].as_array().unwrap().iter().find(|s| s["codec_type"] == "video").unwrap();
        assert_eq!(stream["width"].as_u64(), Some(1920));
        assert_eq!(stream["height"].as_u64(), Some(1080));
        let duration = json["format"]["duration"].as_str().unwrap().parse::<f64>().unwrap();
        assert!(duration > 1.0 && duration < 1.8, "unexpected duration: {}", duration);
    }
}
