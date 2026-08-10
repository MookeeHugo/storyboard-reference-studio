/**
 * Center panel: source viewer. Videos can be scrubbed, marked, and auto-boarded;
 * images can be sent directly to the reference board.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, currentProjectJson } from '../store'
import { useMediaUrl } from '../lib/useMediaUrl'
import { FrameStage } from './FrameStage'
import type { MediaItem } from '@shared/types'
import type { RangeMode } from '../../preload/index'

function fmt(t: number): string {
  if (!isFinite(t)) return '0:00.0'
  const m = Math.floor(t / 60)
  const s = (t % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

function ImageViewer({ media }: { media: MediaItem }): JSX.Element {
  const url = useMediaUrl(media)
  const addFrame = useStore((s) => s.addFrame)
  const toast = useStore((s) => s.toast)
  const folder = useStore((s) => s.projectFolder)
  const onAdd = useCallback(async () => {
    addFrame(media.id, 0, media.name.replace(/\.[^.]+$/, '').slice(0, 40))
    const json = currentProjectJson()
    if (json && folder) await window.sbr.saveProject(folder, json)
    toast('已把图片加入参考板。', 'success')
  }, [media, addFrame, toast, folder])
  return (
    <div className="viewer">
      <div className="viewer-stage">{url ? <img src={url} alt={media.name} /> : null}</div>
      <div className="transport">
        <span className="time">{media.width}×{media.height}</span>
        <div style={{ flex: 1 }} />
        <button className="btn small primary" onClick={onAdd}>＋ 加入参考板</button>
      </div>
    </div>
  )
}

function VideoViewer({ media }: { media: MediaItem }): JSX.Element {
  const url = useMediaUrl(media)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(media.durationS ?? 0)
  const [playing, setPlaying] = useState(false)
  const [inS, setInS] = useState(0)
  const [outS, setOutS] = useState(media.durationS ?? 0)
  const [autoOpen, setAutoOpen] = useState(false)
  const fps = media.fps && media.fps > 1 ? media.fps : 24

  const addFrame = useStore((s) => s.addFrame)
  const toast = useStore((s) => s.toast)
  const folder = useStore((s) => s.projectFolder)

  useEffect(() => {
    setInS(0)
    setOutS(media.durationS ?? 0)
    setTime(0)
  }, [media.id, media.durationS])

  const step = useCallback((frames: number) => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    setPlaying(false)
    v.currentTime = Math.max(0, Math.min(duration || v.duration || 0, v.currentTime + frames / fps))
  }, [duration, fps])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      void v.play()
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }, [])

  const bookmark = useCallback(async () => {
    const t = videoRef.current?.currentTime ?? time
    addFrame(media.id, t, `参考帧 @ ${fmt(t)}`)
    const json = currentProjectJson()
    if (json && folder) await window.sbr.saveProject(folder, json)
    toast(`已标记参考帧：${fmt(t)}`, 'success')
  }, [media.id, time, addFrame, toast, folder])

  useEffect(() => {
    const win = window as unknown as Record<string, unknown>
    win.__sbrTransport = {
      togglePlay,
      step,
      bookmark,
      setIn: () => setInS(videoRef.current?.currentTime ?? time),
      setOut: () => setOutS(videoRef.current?.currentTime ?? time)
    }
    return () => {
      delete win.__sbrTransport
    }
  }, [togglePlay, step, bookmark, time])

  const dur = duration || media.durationS || 1
  const scrubRef = useRef<HTMLDivElement>(null)

  const seekFromClientX = useCallback((clientX: number) => {
    const el = scrubRef.current
    const v = videoRef.current
    if (!el || !v) return
    const rect = el.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    v.currentTime = frac * dur
  }, [dur])

  const dragHandle = useCallback(
    (which: 'in' | 'out') => (e: React.MouseEvent) => {
      e.stopPropagation()
      const el = scrubRef.current
      if (!el) return
      const onMove = (ev: MouseEvent): void => {
        const rect = el.getBoundingClientRect()
        const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
        const t = frac * dur
        if (which === 'in') setInS(Math.min(t, outS))
        else setOutS(Math.max(t, inS))
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [dur, inS, outS]
  )

  return (
    <div className="viewer">
      <div className="viewer-stage">
        {url ? (
          <video
            ref={videoRef}
            src={url}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration
              setDuration(d)
              if (!media.durationS) setOutS(d)
            }}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onEnded={() => setPlaying(false)}
          />
        ) : null}
      </div>
      <div className="transport">
        <button className="btn small" title="上一帧（←）" onClick={() => step(-1)}>◀|</button>
        <button className="btn small" onClick={togglePlay} title="播放/暂停（空格）">
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="btn small" title="下一帧（→）" onClick={() => step(1)}>|▶</button>
        <span className="time">{fmt(time)} / {fmt(dur)} · {Math.round(fps)}fps</span>
        <div className="scrub" ref={scrubRef} onMouseDown={(e) => seekFromClientX(e.clientX)}>
          <div className="scrub-track" />
          <div className="scrub-inout" style={{ left: `${(inS / dur) * 100}%`, width: `${((outS - inS) / dur) * 100}%` }} />
          <div className="scrub-fill" style={{ width: `${(time / dur) * 100}%` }} />
          <div className="scrub-playhead" style={{ left: `${(time / dur) * 100}%` }} />
          <div className="scrub-handle in" style={{ left: `${(inS / dur) * 100}%` }} onMouseDown={dragHandle('in')} title="入点（I）" />
          <div className="scrub-handle out" style={{ left: `${(outS / dur) * 100}%` }} onMouseDown={dragHandle('out')} title="出点（O）" />
        </div>
        <button className="btn small" onClick={() => setInS(time)} title="设置入点（I）">入点</button>
        <button className="btn small" onClick={() => setOutS(time)} title="设置出点（O）">出点</button>
        <button className="btn small primary" onClick={bookmark} title="标记当前帧（B）">📌 标记参考</button>
        <button className="btn small" onClick={() => setAutoOpen(true)} title="按段落自动抽取参考帧">▦ 自动抽帧</button>
      </div>
      {autoOpen && <AutoBoardModal media={media} inS={inS} outS={outS} onClose={() => setAutoOpen(false)} />}
    </div>
  )
}

function AutoBoardModal({ media, inS, outS, onClose }: { media: MediaItem; inS: number; outS: number; onClose: () => void }): JSX.Element {
  const [mode, setMode] = useState<'scene' | 'interval' | 'count'>('scene')
  const [threshold, setThreshold] = useState(0.35)
  const [everyS, setEveryS] = useState(2)
  const [count, setCount] = useState(6)
  const [running, setRunning] = useState(false)
  const folder = useStore((s) => s.projectFolder)
  const toast = useStore((s) => s.toast)
  const addFrame = useStore((s) => s.addFrame)
  const setStill = useStore((s) => s.setStill)

  const run = useCallback(async () => {
    const abs = useStore.getState().mediaAbsPath(media.id)
    if (!abs || !folder) return
    setRunning(true)
    try {
      const outDir = `${folder}${folder.includes('\\') ? '\\' : '/'}.frames`
      await window.sbr.ensureDir(outDir)
      const rangeMode: RangeMode =
        mode === 'scene'
          ? { kind: 'scene', threshold }
          : mode === 'interval'
            ? { kind: 'interval', everyS }
            : { kind: 'count', n: count }
      const res = await window.sbr.extractRange(abs, inS, outS, rangeMode, outDir)
      if (!res.ok) {
        toast(`自动抽帧失败：${res.error ?? '没有抽到画面'}`, 'error')
        setRunning(false)
        return
      }
      for (const { time, path } of res.frames) {
        const frame = addFrame(media.id, time, `参考帧 @ ${fmt(time)}`)
        setStill(frame.id, { path, width: media.width, height: media.height })
      }
      const json = currentProjectJson()
      if (json) await window.sbr.saveProject(folder, json)
      toast(`已添加 ${res.frames.length} 条参考到参考板。`, 'success')
      onClose()
    } finally {
      setRunning(false)
    }
  }, [media, folder, mode, threshold, everyS, count, inS, outS, addFrame, setStill, toast, onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>自动抽取段落</h2>
        <div className="modal-sub">
          从 {fmt(inS)} 到 {fmt(outS)} 抽取参考帧，并加入底部参考板。
        </div>
        <div className="seg" style={{ marginBottom: 14 }}>
          <button className={mode === 'scene' ? 'active' : ''} onClick={() => setMode('scene')}>场景切点</button>
          <button className={mode === 'interval' ? 'active' : ''} onClick={() => setMode('interval')}>每 N 秒</button>
          <button className={mode === 'count' ? 'active' : ''} onClick={() => setMode('count')}>固定数量</button>
        </div>
        {mode === 'scene' && (
          <div className="field">
            <label>灵敏度：数值越低，识别到的切点越多（{threshold.toFixed(2)}）</label>
            <input type="range" min={0.1} max={0.6} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          </div>
        )}
        {mode === 'interval' && (
          <div className="field">
            <label>每隔 N 秒抽取</label>
            <input type="number" min={0.2} step={0.2} value={everyS} onChange={(e) => setEveryS(Number(e.target.value))} />
          </div>
        )}
        {mode === 'count' && (
          <div className="field">
            <label>均匀抽取数量</label>
            <input type="number" min={1} step={1} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={running}>取消</button>
          <button className="btn primary" onClick={run} disabled={running}>{running ? '抽取中…' : '开始抽取'}</button>
        </div>
      </div>
    </div>
  )
}

export function Viewer(): JSX.Element {
  const selectedMediaId = useStore((s) => s.selectedMediaId)
  const media = useStore((s) => s.media(selectedMediaId))
  const viewMode = useStore((s) => s.viewMode)
  const selectedFrameId = useStore((s) => s.selectedFrameId)
  const selectedFrame = useStore((s) => s.frame(selectedFrameId))

  if (viewMode === 'frame' && selectedFrame) return <FrameStage frame={selectedFrame} />

  if (!media) {
    return (
      <div className="viewer">
        <div className="viewer-stage">
          <div className="viewer-empty">
            <div style={{ fontSize: 34 }}>🎬</div>
            从左侧素材栏选择视频或图片，开始抽取镜头参考。
          </div>
        </div>
      </div>
    )
  }
  return media.kind === 'video' ? <VideoViewer media={media} /> : <ImageViewer media={media} />
}
