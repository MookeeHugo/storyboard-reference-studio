/**
 * Tauri compatibility layer for the legacy Electron-style window.sbr API.
 * The React app can keep one integration surface while release builds call
 * native Tauri commands and browser smoke checks use a small local fallback.
 */

import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import type {
  AnimaticOptions,
  ExportBoardInput,
  ExtractRangeResult,
  ImportedAudio,
  ImportedMedia,
  RangeMode,
  SbrAPI
} from '../preload/index'
import type { DescribeResult } from '@shared/types'

const BROWSER_PROJECT_KEY = 'storyboard-reference.browser-project'

function isProbablyTauriError(error: unknown): boolean {
  return String(error).includes('window.__TAURI__') || String(error).includes('__TAURI_INTERNALS__')
}

function ensureSbref(path: string): string {
  return /\.sbref$/i.test(path) ? path : `${path}.sbref`
}

function asPath(result: string | string[] | null): string | null {
  if (Array.isArray(result)) return result[0] ?? null
  return result
}

function pathJoin(base: string, child: string): string {
  const sep = base.includes('\\') ? '\\' : '/'
  return base.endsWith(sep) ? `${base}${child}` : `${base}${sep}${child}`
}

async function readBytes(command: string, args: Record<string, unknown>): Promise<ArrayBuffer> {
  const data = await invoke<number[] | string>(command, args)
  if (typeof data === 'string') {
    const binary = atob(data)
    return Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer
  }
  return new Uint8Array(data).buffer
}

class TauriSbrBridge implements SbrAPI {
  private available = false

  async init(): Promise<void> {
    try {
      await invoke('get_app_data_dir')
      this.available = true
      console.info('Storyboard Reference Studio: Tauri native bridge ready')
    } catch (error) {
      this.available = false
      if (!isProbablyTauriError(error)) console.info('Storyboard Reference Studio: browser fallback mode')
    }
  }

  async newProjectDialog(): Promise<string | null> {
    if (!this.available) return `browser-project://${Date.now()}.sbref`
    const root = await this.getProjectsDir()
    const picked = await save({
      title: '新建分镜参考项目',
      defaultPath: root ? pathJoin(root, '未命名分镜参考.sbref') : '未命名分镜参考.sbref',
      filters: [{ name: 'Storyboard Reference Project', extensions: ['sbref'] }]
    })
    return picked ? ensureSbref(picked) : null
  }

  async openProjectDialog(): Promise<string | null> {
    if (!this.available) return null
    return asPath(await open({ title: '打开分镜参考项目文件夹', directory: true, multiple: false }))
  }

  async getProjectsDir(): Promise<string | null> {
    if (!this.available) return 'browser-projects'
    try {
      return await invoke<string>('get_projects_dir')
    } catch (error) {
      console.error('无法获取项目目录:', error)
      return null
    }
  }

  async importMediaDialog(): Promise<string[]> {
    if (!this.available) return []
    const result = await open({
      title: '导入镜头参考素材',
      multiple: true,
      filters: [
        { name: '参考素材', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'm4v', 'webm', 'mp3', 'wav', 'm4a', 'aac'] }
      ]
    })
    if (!result) return []
    return Array.isArray(result) ? result : [result]
  }

  async saveProject(folder: string, json: string): Promise<boolean> {
    if (!this.available || folder.startsWith('browser-project://')) {
      localStorage.setItem(BROWSER_PROJECT_KEY, JSON.stringify({ folder, json }))
      return true
    }
    try {
      await invoke('save_project', { folder, json })
      return true
    } catch (error) {
      console.error('保存项目失败:', error)
      return false
    }
  }

  async saveBackup(folder: string, json: string): Promise<boolean> {
    if (!this.available || folder.startsWith('browser-project://')) return this.saveProject(folder, json)
    try {
      await invoke('save_backup', { folder, json })
      return true
    } catch (error) {
      console.error('保存自动备份失败:', error)
      return false
    }
  }

  async loadProject(folder: string): Promise<{ json: string | null; backupJson: string | null; backupNewer: boolean; folder: string }> {
    if (!this.available || folder.startsWith('browser-project://')) {
      const raw = localStorage.getItem(BROWSER_PROJECT_KEY)
      const parsed = raw ? JSON.parse(raw) as { json?: string } : {}
      return { json: parsed.json ?? null, backupJson: null, backupNewer: false, folder }
    }
    try {
      return await invoke('load_project', { folder })
    } catch (error) {
      console.error('打开项目失败:', error)
      return { json: null, backupJson: null, backupNewer: false, folder }
    }
  }

  async importMedia(folder: string, sourcePath: string): Promise<ImportedMedia> {
    return await invoke<ImportedMedia>('import_media', { folder, sourcePath })
  }

  async importAudio(folder: string, sourcePath: string): Promise<ImportedAudio> {
    return await invoke<ImportedAudio>('import_audio', { folder, sourcePath })
  }

  async pasteImage(folder: string, data: ArrayBuffer, index: number): Promise<ImportedMedia> {
    return await invoke<ImportedMedia>('paste_image', { folder, data: Array.from(new Uint8Array(data)), index })
  }

  async readProjectFile(folder: string, relativePath: string): Promise<ArrayBuffer> {
    if (relativePath.startsWith('data:')) return (await fetch(relativePath)).arrayBuffer()
    if (!this.available) return new ArrayBuffer(0)
    try {
      return await readBytes('read_project_file', { folder, relativePath })
    } catch (error) {
      console.error('读取项目文件失败:', error)
      return new ArrayBuffer(0)
    }
  }

  async writeProjectPng(folder: string, relativePath: string, base64: string): Promise<boolean> {
    if (!this.available) return false
    try {
      await invoke('write_project_png', { folder, relativePath, base64 })
      return true
    } catch (error) {
      console.error('写入 PNG 失败:', error)
      return false
    }
  }

  async showFolder(path: string): Promise<void> {
    if (!this.available) return
    try {
      await invoke('show_folder', { path })
    } catch {
      // Native command validates project-owned paths; failures are non-fatal UI hints.
    }
  }

  async openExternal(url: string): Promise<boolean> {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') return false
      window.open(parsed.toString(), '_blank', 'noopener,noreferrer')
      return true
    } catch {
      return false
    }
  }

  async extractFrame(mediaPath: string, timeS: number, outPng: string): Promise<{ ok: boolean; error?: string; path: string }> {
    return await invoke('extract_frame', { mediaPath, timeS, outPng })
  }

  async extractRange(mediaPath: string, startS: number, endS: number, mode: RangeMode, outDir: string): Promise<ExtractRangeResult> {
    return await invoke('extract_range', { mediaPath, startS, endS, mode, outDir })
  }

  async describeFrame(framePngPath: string, profileId: string, extraContext: string): Promise<DescribeResult> {
    return await invoke('describe_frame', { framePngPath, profileId, extraContext })
  }

  async exportBoard(input: ExportBoardInput): Promise<{ ok: boolean; error?: string; packagePath: string }> {
    return await invoke('export_board', { input })
  }

  async exportAnimatic(input: ExportBoardInput, opts: AnimaticOptions): Promise<{ ok: boolean; error?: string; videoPath: string; audioWaveformPath?: string | null }> {
    return await invoke('export_animatic', { input, opts })
  }

  async exportPdf(input: ExportBoardInput): Promise<{ ok: boolean; error?: string; pdfPath: string }> {
    return await invoke('export_pdf', { input })
  }

  async exportShotlist(input: ExportBoardInput): Promise<{ ok: boolean; error?: string; csvPath: string }> {
    return await invoke('export_shotlist', { input })
  }

  async mediaToolsStatus(): Promise<{
    ffmpegPath: string | null
    ffprobePath: string | null
    ffmpegError: string | null
    ffprobeError: string | null
  }> {
    return await invoke('media_tools_status')
  }

  async ensureDir(path: string): Promise<boolean> {
    if (!this.available) return true
    try {
      await invoke('ensure_dir', { path })
      return true
    } catch {
      return false
    }
  }

  async tempDir(): Promise<string> {
    if (!this.available) return 'browser-temp'
    try {
      return await invoke('temp_dir')
    } catch {
      return ''
    }
  }

  async versions(): Promise<{ app: string; electron: string; node: string }> {
    try {
      const info = await invoke<{ version: string }>('get_version')
      return { app: info.version, electron: 'Tauri', node: 'N/A' }
    } catch {
      return { app: '2.0.0', electron: 'Tauri', node: 'N/A' }
    }
  }

  onControlInvoke(): () => void {
    return () => {}
  }

  controlResult(): void {}
}

const sbrBridge = new TauriSbrBridge()
void sbrBridge.init()

if (typeof window !== 'undefined') {
  ;(window as unknown as { sbr: SbrAPI }).sbr = sbrBridge
}

export default sbrBridge
