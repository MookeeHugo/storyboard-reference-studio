/**
 * App shell: welcome screen, titlebar, the three-panel workspace + board,
 * global keyboard map, autosave, credits.
 */

import { useCallback, useEffect } from 'react'
import { useStore, currentProjectJson } from './store'
import { MediaBin } from './panels/MediaBin'
import { Viewer } from './panels/Viewer'
import { Inspector } from './panels/Inspector'
import { Board } from './panels/Board'
import { Toasts } from './panels/Toasts'
import { HelpOverlay } from './panels/Help'
import { Present } from './panels/Present'
import logoUrl from './assets/logo.png'
import { createLighthouseDemo } from './demo'

function CreditLink({ url, children }: { url: string; children: string }): JSX.Element {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault()
        void window.sbr.openExternal(url)
      }}
    >
      {children}
    </a>
  )
}

export function Credits(): JSX.Element {
  return (
    <div className="credits">
      本地优先、无需账号、无需 API 密钥；创作资料不上云。
      <br />
      BloomReel 团队出品 ·{' '}
      <CreditLink url="https://github.com/MookeeHugo">BloomReel 项目入口</CreditLink>
      <br />
      BloomReel 专有版；用于中文影视创作流程，第三方组件遵循各自许可。
    </div>
  )
}

function Welcome(): JSX.Element {
  const newProject = useStore((s) => s.newProject)
  const loadFromJson = useStore((s) => s.loadFromJson)
  const loadDemoProject = useStore((s) => s.loadDemoProject)
  const toast = useStore((s) => s.toast)
  const setHelpOpen = useStore((s) => s.setHelpOpen)

  const onNew = useCallback(async () => {
    const folder = await window.sbr.newProjectDialog()
    if (!folder) return
    const name = folder.split(/[/\\]/).pop()?.replace(/\.sbref$/, '') ?? '未命名分镜参考'
    newProject(folder, name)
    const json = currentProjectJson()
    if (json) await window.sbr.saveProject(folder, json)
    toast('已创建新的本地分镜参考项目。', 'success')
  }, [newProject, toast])

  const onOpen = useCallback(async () => {
    const folder = await window.sbr.openProjectDialog()
    if (!folder) return
    const { json, backupJson, backupNewer } = await window.sbr.loadProject(folder)
    if (!json && !backupJson) {
      toast('这个文件夹里没有找到 project.json。', 'error')
      return
    }
    if (backupNewer && backupJson && loadFromJson(folder, backupJson)) {
      toast('已从自动备份恢复未保存内容，请保存以保留。', 'success')
      return
    }
    if (json && loadFromJson(folder, json)) return
    if (backupJson && loadFromJson(folder, backupJson)) {
      toast('已从自动备份恢复项目。', 'success')
    }
  }, [loadFromJson, toast])

  const onDemo = useCallback(async () => {
    const demo = createLighthouseDemo()
    const root = await window.sbr.getProjectsDir()
    const sep = root?.includes('\\') ? '\\' : '/'
    const folder = root ? `${root}${sep}${demo.folderName}` : `browser-project://${demo.folderName}`
    loadDemoProject(folder, demo.doc, demo.stills)
    const json = currentProjectJson()
    if (json) await window.sbr.saveProject(folder, json)
    toast(`已加载「${demo.doc.name}」：${demo.doc.frames.length} 条镜头参考。`, 'success')
  }, [loadDemoProject, toast])

  return (
    <div className="welcome">
      <img
        src={logoUrl}
        alt="Storyboard Reference Studio"
        style={{ width: 280, height: 280, objectFit: 'contain', borderRadius: 16, marginBottom: -12 }}
      />
      <p>
        面向中文影视创作者的本地分镜参考、镜头图像资料库与视觉风格检索工作台。
        导演、摄影、美术和 AI 视频提示词协作，都可以围绕同一张参考卡整理。
      </p>
      <div className="actions">
        <button className="btn primary" onClick={onDemo}>加载雨夜灯塔 Demo</button>
        <button className="btn" onClick={onNew}>新建项目</button>
        <button className="btn" onClick={onOpen}>打开项目…</button>
        <button className="btn" onClick={() => setHelpOpen(true)}>快速上手</button>
      </div>
      <Credits />
    </div>
  )
}

function useAutosave(): void {
  const hasDoc = useStore((s) => s.doc !== null)
  const folder = useStore((s) => s.projectFolder)
  useEffect(() => {
    if (!hasDoc || !folder) return
    const interval = setInterval(() => {
      const json = currentProjectJson()
      if (json) void window.sbr.saveBackup(folder, json)
    }, 60_000)
    return () => clearInterval(interval)
  }, [hasDoc, folder])
}

interface Transport {
  togglePlay(): void
  step(frames: number): void
  bookmark(): void
  setIn(): void
  setOut(): void
}

function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if (!s.doc) return
      const inField =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLSelectElement
      const transport = (window as unknown as { __sbrTransport?: Transport }).__sbrTransport
      const meta = e.metaKey || e.ctrlKey

      if (meta && e.key === 's') {
        e.preventDefault()
        const json = currentProjectJson()
        if (json && s.projectFolder) void window.sbr.saveProject(s.projectFolder, json).then(() => s.markSaved())
        return
      }
      if (e.key === '?') {
        s.setHelpOpen(!s.helpOpen)
        return
      }
      if (e.key === 'Escape' && s.helpOpen) {
        s.setHelpOpen(false)
        return
      }
      // Present mode owns the keyboard while it's open (it captures keys).
      if (s.presentOpen) return
      if (inField) return

      if (e.key === 'p' || e.key === 'P') {
        if (s.doc && s.orderedFrames().length > 0) s.setPresentOpen(true)
        return
      }
      if (e.key === 'a' || e.key === 'A') {
        s.setAnnotTool(s.annotTool === 'arrow' ? 'none' : 'arrow')
        return
      }
      if (e.key === 't' || e.key === 'T') {
        s.setAnnotTool(s.annotTool === 'text' ? 'none' : 'text')
        return
      }
      if (e.key === 'g' || e.key === 'G') {
        s.setGuidesOn(!s.guidesOn)
        return
      }

      if (e.key === ' ') {
        e.preventDefault()
        transport?.togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        transport?.step(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        transport?.step(1)
      } else if (e.key === 'i' || e.key === 'I') {
        transport?.setIn()
      } else if (e.key === 'o' || e.key === 'O') {
        transport?.setOut()
      } else if (e.key === 'b' || e.key === 'B') {
        transport?.bookmark()
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        // A selected annotation deletes first (leaves the frame in place).
        if (s.selectedAnnotationId && s.selectedFrameId) {
          s.removeAnnotation(s.selectedFrameId, s.selectedAnnotationId)
          s.selectAnnotation(null)
          const json = currentProjectJson()
          if (json && s.projectFolder) void window.sbr.saveProject(s.projectFolder, json)
          return
        }
        if (s.selectedFrameId) {
          const frame = s.frame(s.selectedFrameId)
          if (frame?.prompt?.text && !window.confirm('这张参考卡已有提示词，确定移除吗？')) return
          s.removeFrame(s.selectedFrameId)
          const json = currentProjectJson()
          if (json && s.projectFolder) void window.sbr.saveProject(s.projectFolder, json)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const dirty = useStore((s) => s.dirty)
  const folder = useStore((s) => s.projectFolder)
  const markSaved = useStore((s) => s.markSaved)

  useAutosave()
  useKeyboard()

  const onSave = useCallback(async () => {
    const json = currentProjectJson()
    if (json && folder) {
      await window.sbr.saveProject(folder, json)
      markSaved()
    }
  }, [folder, markSaved])

  if (!doc) {
    return (
      <div className="app">
        <div className="titlebar">
          <span className="app-name">分镜参考工作室</span>
        </div>
        <Welcome />
        <Toasts />
        <HelpOverlay />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="titlebar">
        <span className="app-name">分镜参考工作室</span>
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
          {doc.name}
          {dirty ? ' •' : ''}
        </span>
        <div className="spacer" />
        <button className="btn small" onClick={onSave}>保存</button>
        <button className="btn small" onClick={() => useStore.getState().setHelpOpen(true)}>帮助</button>
      </div>
      <div className="workspace">
        <MediaBin />
        <Viewer />
        <Inspector />
        <Board />
      </div>
      <Toasts />
      <HelpOverlay />
      <Present />
    </div>
  )
}
