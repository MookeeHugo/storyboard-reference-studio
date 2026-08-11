/**
 * Bottom reference board: searchable visual-reference cards with shot metadata,
 * prompt/export actions, and drag ordering.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, currentProjectJson } from '../store'
import { useAbsUrl } from '../lib/useMediaUrl'
import { ensureStill, generatePrompt, buildExportInputs, audioAbsPath } from '../lib/frameOps'
import { renderAnnotationsSvg } from '@shared/annotations'
import type { Frame } from '@shared/types'
import type { AnimaticOptions, PdfExportOptions } from '../../preload/index'

function frameSearchText(frame: Frame): string {
  const ref = frame.reference
  return [
    frame.label,
    frame.notes,
    frame.shot.sceneNo,
    frame.shot.shotNo,
    frame.shot.shotSize,
    frame.shot.cameraAngle,
    frame.shot.lens,
    frame.shot.movement,
    frame.shot.transition,
    frame.prompt?.text,
    ref?.scene,
    ref?.shotType,
    ref?.composition,
    ref?.lighting,
    ref?.color,
    ref?.mood,
    ref?.purpose,
    ref?.shotUsage,
    ref?.aiPromptNote,
    ...(ref?.tags ?? [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function frameFacetValues(frame: Frame): string[] {
  const ref = frame.reference
  return [
    ref?.shotType,
    ref?.scene,
    ref?.mood,
    ref?.color,
    ref?.composition,
    frame.shot.shotSize,
    frame.shot.cameraAngle,
    ...((ref?.tags ?? []).slice(0, 10))
  ]
    .filter((x): x is string => Boolean(x && x.trim()))
    .map((x) => x.trim())
}

function BoardCard({ frame, index }: { frame: Frame; index: number }): JSX.Element {
  const active = useStore((s) => s.selectedFrameId === frame.id)
  const still = useStore((s) => s.stills[frame.id])
  const selectFrame = useStore((s) => s.selectFrame)
  const removeFrame = useStore((s) => s.removeFrame)
  const reorderFrame = useStore((s) => s.reorderFrame)
  const folder = useStore((s) => s.projectFolder)
  const [dragOver, setDragOver] = useState(false)
  const url = useAbsUrl(still?.path ?? null)
  const ref = frame.reference

  const onRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (frame.prompt && frame.prompt.text) {
        if (!window.confirm('这张参考卡已有提示词，确定从参考板移除吗？')) return
      }
      removeFrame(frame.id)
      const json = currentProjectJson()
      if (json && folder) void window.sbr.saveProject(folder, json)
    },
    [frame, removeFrame, folder]
  )

  return (
    <div
      className={`board-card ${active ? 'active' : ''} ${dragOver ? 'drag-over' : ''}`}
      draggable
      onClick={() => selectFrame(frame.id)}
      onDragStart={(e) => e.dataTransfer.setData('text/frame-id', frame.id)}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const id = e.dataTransfer.getData('text/frame-id')
        if (id && id !== frame.id) {
          reorderFrame(id, index)
          const json = currentProjectJson()
          if (json && folder) void window.sbr.saveProject(folder, json)
        }
      }}
    >
      <button className="board-card-del" onClick={onRemove} title="移除参考卡">×</button>
      <div className="board-card-thumb-wrap">
        {url ? <img className="board-card-thumb" src={url} alt={frame.label} /> : <div className="board-card-thumb" />}
        {frame.annotations.length > 0 && still && (
          <div
            className="board-card-anno"
            dangerouslySetInnerHTML={{ __html: renderAnnotationsSvg(frame, still.width, still.height) }}
          />
        )}
        <span className="board-card-dur">{frame.durationS.toFixed(1)}s</span>
      </div>
      <div className="board-card-body">
        <div className="board-card-label" title={frame.label}>{frame.label || '未命名参考'}</div>
        <div className="board-card-ref" title={ref?.composition ?? frame.notes}>
          {ref?.shotType || frame.shot.shotSize || '镜头参考'} · {ref?.scene || frame.shot.sceneNo || '未分场'}
        </div>
        <div className="board-card-tags">
          {(ref?.tags ?? [frame.shot.cameraAngle, frame.shot.movement]).filter(Boolean).slice(0, 3).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <div className="board-card-meta">
          <span className="board-index">{String(index + 1).padStart(2, '0')}</span>
          <span className={`dot ${frame.prompt?.text ? 'has-prompt' : ''}`} title={frame.prompt?.text ? '已有提示词' : '暂无提示词'} />
          {ref?.mood && <span className="board-mood">{ref.mood}</span>}
        </div>
      </div>
    </div>
  )
}

export function Board(): JSX.Element {
  const rawFrames = useStore((s) => s.doc?.frames)
  const frames = useMemo(() => [...(rawFrames ?? [])].sort((a, b) => a.order - b.order), [rawFrames])
  const folder = useStore((s) => s.projectFolder)
  const projectName = useStore((s) => s.doc?.name ?? '分镜参考板')
  const scratchAudioFile = useStore((s) => s.doc?.settings.audioFile ?? null)
  const defaultProfile = useStore((s) => s.doc?.settings.defaultProfileId ?? 'midjourney')
  const promptingAll = useStore((s) => s.promptingAll)
  const setPromptingAll = useStore((s) => s.setPromptingAll)
  const setPresentOpen = useStore((s) => s.setPresentOpen)
  const toast = useStore((s) => s.toast)
  const [exporting, setExporting] = useState(false)
  const [exportMenu, setExportMenu] = useState(false)
  const [animaticOptions, setAnimaticOptions] = useState({
    burnLabel: true,
    burnShotNumber: true,
    fade: true,
    validateAudio: true
  })
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportMenu) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setExportMenu(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [exportMenu])

  const withPrompt = frames.filter((f) => f.prompt?.text).length
  const missing = frames.length - withPrompt

  const filters = useMemo(() => {
    const all = frames.flatMap(frameFacetValues)
    return Array.from(new Set(all)).slice(0, 24)
  }, [frames])

  const visibleFrames = useMemo(() => {
    const q = query.trim().toLowerCase()
    return frames.filter((frame) => {
      const text = frameSearchText(frame)
      const matchesQuery = !q || text.includes(q)
      const matchesFilter = !activeFilter || frameFacetValues(frame).includes(activeFilter)
      return matchesQuery && matchesFilter
    })
  }, [frames, query, activeFilter])

  const onPromptAll = useCallback(async () => {
    setPromptingAll(true)
    let done = 0
    let failed = 0
    for (const f of frames) {
      if (f.prompt?.text) continue
      const res = await generatePrompt(f.id, f.prompt?.profileId ?? defaultProfile, f.notes)
      if (res.ok) done++
      else {
        failed++
        toast(res.error ?? '提示词生成失败', 'error')
        break
      }
    }
    setPromptingAll(false)
    const json = currentProjectJson()
    if (json && folder) await window.sbr.saveProject(folder, json)
    if (done) toast(`已生成 ${done} 条提示词。`, 'success')
    if (!done && !failed) toast('所有参考卡都已有提示词。', 'info')
  }, [frames, defaultProfile, folder, setPromptingAll, toast])

  const runExport = useCallback(
    async (kind: 'board' | 'animatic' | 'pdf' | 'shotlist', pdfOptions?: PdfExportOptions) => {
      if (!folder || frames.length === 0) return
      setExportMenu(false)
      setExporting(true)
      try {
        for (const f of frames) await ensureStill(f.id)
        const inputs = await buildExportInputs()
        const exportsRoot = `${folder}${folder.includes('\\') ? '\\' : '/'}exports`
        const payload = { projectName, exportsRoot, frames: inputs, pdfOptions }
        if (kind === 'board') {
          const res = await window.sbr.exportBoard(payload)
          toast(res.ok ? '参考包已导出，并已打开所在文件夹。' : `导出失败：${res.error ?? ''}`, res.ok ? 'success' : 'error')
        } else if (kind === 'animatic') {
          const audioPath = audioAbsPath()
          const opts: AnimaticOptions = {
            burnLabel: animaticOptions.burnLabel,
            burnShotNumber: animaticOptions.burnShotNumber,
            fade: animaticOptions.fade,
            fadeDurationS: 0.22,
            validateAudio: animaticOptions.validateAudio && Boolean(audioPath),
            audioPath
          }
          const res = await window.sbr.exportAnimatic(payload, opts)
          const audioCheck = res.audioWaveformPath ? '，临时音轨波形已校验' : ''
          toast(res.ok ? `动态分镜 MP4 已导出${audioCheck}。` : `动态分镜导出失败：${res.error ?? ''}`, res.ok ? 'success' : 'error')
        } else if (kind === 'pdf') {
          const res = await window.sbr.exportPdf(payload)
          const version = pdfOptions?.template === 'art' ? '美术版' : '导演版'
          const theme = pdfOptions?.theme === 'dark' ? '（深色）' : ''
          toast(res.ok ? `PDF ${version}${theme}已导出。` : `PDF 导出失败：${res.error ?? ''}`, res.ok ? 'success' : 'error')
        } else {
          const res = await window.sbr.exportShotlist(payload)
          toast(res.ok ? '镜头清单 CSV 已导出。' : `CSV 导出失败：${res.error ?? ''}`, res.ok ? 'success' : 'error')
        }
      } finally {
        setExporting(false)
      }
    },
    [folder, frames, projectName, toast, animaticOptions]
  )

  const onExport = useCallback(() => runExport('board'), [runExport])

  return (
    <div className="board">
      <div className="board-bar">
        <span className="panel-title" style={{ margin: 0 }}>参考板</span>
        <span className="board-count">{visibleFrames.length}/{frames.length} 条参考 · {withPrompt} 条提示词 · {missing} 条待补</span>
        <input
          className="board-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="检索镜头类型、场景、情绪、色彩、构图、人物/地点标签…"
          aria-label="检索分镜参考"
        />
        <div className="board-filter-chips" aria-label="参考筛选标签">
          <button className={`filter-chip ${activeFilter === null ? 'active' : ''}`} onClick={() => setActiveFilter(null)}>全部</button>
          {filters.map((filter) => (
            <button
              key={filter}
              className={`filter-chip ${activeFilter === filter ? 'active' : ''}`}
              onClick={() => setActiveFilter(activeFilter === filter ? null : filter)}
            >
              {filter}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn small" onClick={() => setPresentOpen(true)} disabled={frames.length === 0} title="播放参考板 (P)">
          ▶ 播放
        </button>
        <button className="btn small" onClick={onPromptAll} disabled={promptingAll || missing === 0}>
          {promptingAll ? '生成中…' : '补全提示词'}
        </button>
        <button className="btn small primary" onClick={onExport} disabled={exporting || frames.length === 0}>
          {exporting ? '导出中…' : '导出参考包'}
        </button>
        <div className="export-menu-wrap" ref={menuRef}>
          <button className="btn small" onClick={() => setExportMenu((v) => !v)} disabled={exporting || frames.length === 0} title="更多导出格式">
            导出 ▾
          </button>
          {exportMenu && (
            <div className="export-menu">
              <button onClick={() => runExport('board')}>参考包</button>
              <div className="export-menu-section" onClick={(e) => e.stopPropagation()}>
                <div className="export-menu-heading">动态分镜 MP4 选项</div>
                <label className="export-check">
                  <input
                    type="checkbox"
                    checked={animaticOptions.fade}
                    onChange={(e) => setAnimaticOptions((prev) => ({ ...prev, fade: e.target.checked }))}
                  />
                  淡入淡出
                </label>
                <label className="export-check">
                  <input
                    type="checkbox"
                    checked={animaticOptions.burnShotNumber}
                    onChange={(e) => setAnimaticOptions((prev) => ({ ...prev, burnShotNumber: e.target.checked }))}
                  />
                  烧录镜头编号
                </label>
                <label className="export-check">
                  <input
                    type="checkbox"
                    checked={animaticOptions.burnLabel}
                    onChange={(e) => setAnimaticOptions((prev) => ({ ...prev, burnLabel: e.target.checked }))}
                  />
                  烧录参考标题
                </label>
                <label className={`export-check ${scratchAudioFile ? '' : 'disabled'}`}>
                  <input
                    type="checkbox"
                    checked={animaticOptions.validateAudio}
                    disabled={!scratchAudioFile}
                    onChange={(e) => setAnimaticOptions((prev) => ({ ...prev, validateAudio: e.target.checked }))}
                  />
                  临时音轨波形校验
                </label>
                <button onClick={() => runExport('animatic')}>导出动态分镜 MP4</button>
              </div>
              <button onClick={() => runExport('pdf', { template: 'director', theme: 'light' })}>PDF 导演版（浅色）</button>
              <button onClick={() => runExport('pdf', { template: 'director', theme: 'dark' })}>PDF 导演版（深色）</button>
              <button onClick={() => runExport('pdf', { template: 'art', theme: 'light' })}>PDF 美术版（浅色）</button>
              <button onClick={() => runExport('pdf', { template: 'art', theme: 'dark' })}>PDF 美术版（深色）</button>
              <button onClick={() => runExport('shotlist')}>镜头清单 CSV</button>
            </div>
          )}
        </div>
      </div>
      <div className="board-strip">
        {frames.length === 0 ? (
          <div className="board-empty">
            从素材里标记画面、导入图片，或加载「雨夜灯塔」Demo；参考卡会出现在这里。
          </div>
        ) : visibleFrames.length === 0 ? (
          <div className="board-empty">没有匹配的参考卡，请换一个镜头类型、场景或标签。</div>
        ) : (
          visibleFrames.map((f) => <BoardCard key={f.id} frame={f} index={frames.findIndex((x) => x.id === f.id)} />)
        )}
      </div>
    </div>
  )
}
