/**
 * Right panel: selected reference card details, shot metadata, visual-reference
 * breakdown, annotations, reframing, and AI prompt tooling.
 */

import { useCallback, useEffect, useState } from 'react'
import { useStore, currentProjectJson } from '../store'
import { useAbsUrl } from '../lib/useMediaUrl'
import { CropEditor } from './CropEditor'
import { ensureStill, generatePrompt, templatePrompt } from '../lib/frameOps'
import { BUILTIN_PROFILES, SHOT_SIZES, CAMERA_ANGLES, LIGHTING_STYLES, MOODS, MOVEMENTS, TRANSITIONS } from '@shared/profiles'
import { CROP_ASPECTS, fullCropSafe } from '../lib/inspectorHelpers'
import { ANNOTATION_COLORS } from '@shared/annotations'
import type { CropAspect } from '@shared/types'

export function Inspector(): JSX.Element {
  const frameId = useStore((s) => s.selectedFrameId)
  const frame = useStore((s) => s.frame(frameId))
  const doc = useStore((s) => s.doc)
  const folder = useStore((s) => s.projectFolder)
  const still = useStore((s) => (frameId ? s.stills[frameId] : undefined))
  const toast = useStore((s) => s.toast)

  const setFrameLabel = useStore((s) => s.setFrameLabel)
  const setFrameNotes = useStore((s) => s.setFrameNotes)
  const setFrameCrop = useStore((s) => s.setFrameCrop)
  const setFrameCropAspect = useStore((s) => s.setFrameCropAspect)
  const setFramePrompt = useStore((s) => s.setFramePrompt)
  const setDefaultProfile = useStore((s) => s.setDefaultProfile)
  const setFrameDuration = useStore((s) => s.setFrameDuration)
  const setFrameShot = useStore((s) => s.setFrameShot)
  const clearAnnotations = useStore((s) => s.clearAnnotations)
  const annotTool = useStore((s) => s.annotTool)
  const setAnnotTool = useStore((s) => s.setAnnotTool)
  const annotColor = useStore((s) => s.annotColor)
  const setAnnotColor = useStore((s) => s.setAnnotColor)

  const [profileId, setProfileId] = useState(doc?.settings.defaultProfileId ?? 'midjourney')
  const [promptText, setPromptText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [showTemplate, setShowTemplate] = useState(false)
  const [tpl, setTpl] = useState({ shotSize: SHOT_SIZES[4]!, cameraAngle: CAMERA_ANGLES[0]!, lighting: LIGHTING_STYLES[0]!, mood: MOODS[0]! })

  const stillUrl = useAbsUrl(still?.path ?? null)

  useEffect(() => {
    if (frameId && !still) void ensureStill(frameId)
  }, [frameId, still])

  useEffect(() => {
    if (!frame) return
    setProfileId(frame.prompt?.profileId ?? doc?.settings.defaultProfileId ?? 'midjourney')
    setPromptText(frame.prompt?.text ?? '')
    setError('')
  }, [frameId, frame, doc?.settings.defaultProfileId])

  const save = useCallback(async () => {
    const json = currentProjectJson()
    if (json && folder) await window.sbr.saveProject(folder, json)
  }, [folder])

  const onGenerate = useCallback(async () => {
    if (!frameId) return
    setGenerating(true)
    setError('')
    const res = await generatePrompt(frameId, profileId, frame?.notes ?? '')
    setGenerating(false)
    if (!res.ok) {
      setError(res.error ?? '生成失败。')
      setShowTemplate(true)
      return
    }
    const updated = useStore.getState().frame(frameId)
    setPromptText(updated?.prompt?.text ?? '')
    setDefaultProfile(profileId)
    await save()
    toast('提示词已生成。', 'success')
  }, [frameId, profileId, frame?.notes, setDefaultProfile, save, toast])

  const onApplyTemplate = useCallback(async () => {
    if (!frame || !frameId) return
    const text = templatePrompt(frame, profileId, tpl)
    setPromptText(text)
    setFramePrompt(frameId, text, profileId, 'template')
    await save()
  }, [frame, frameId, profileId, tpl, setFramePrompt, save])

  const onCopy = useCallback(async () => {
    await navigator.clipboard.writeText(promptText)
    toast('提示词已复制。', 'success')
  }, [promptText, toast])

  if (!frame) {
    return (
      <div className="inspector-col panel">
        <div className="inspector-empty">选择一张参考卡，查看镜头拆解、调整构图并整理 AI 提示词。</div>
      </div>
    )
  }

  const crop = frame.crop
  const onAspect = (aspect: CropAspect | null): void => {
    if (aspect === null) {
      setFrameCrop(frame.id, null)
    } else if (!crop) {
      setFrameCrop(frame.id, fullCropSafe(aspect, still?.width ?? 16, still?.height ?? 9))
    } else {
      setFrameCropAspect(frame.id, aspect)
    }
    void save()
  }

  return (
    <div className="inspector-col panel">
      <div className="inspector-still-wrap">
        {stillUrl ? <img className="inspector-still" src={stillUrl} alt="参考帧" /> : <div className="inspector-still" />}
        {crop && still && stillUrl && <CropEditor frameId={frame.id} crop={crop} imgW={still.width} imgH={still.height} />}
      </div>

      <div className="panel-section">
        <div className="field">
          <label>参考标题</label>
          <input
            type="text"
            value={frame.label}
            placeholder="例如：灯塔入口低机位建立镜头"
            onChange={(e) => setFrameLabel(frame.id, e.target.value)}
            onBlur={save}
          />
        </div>
        <div className="field">
          <label>分镜备注</label>
          <textarea value={frame.notes} onChange={(e) => setFrameNotes(frame.id, e.target.value)} onBlur={save} />
        </div>
        <div className="field">
          <label>时长（秒）</label>
          <input
            type="number"
            min={0.25}
            max={30}
            step={0.25}
            value={frame.durationS}
            onChange={(e) => setFrameDuration(frame.id, Number(e.target.value))}
            onBlur={save}
          />
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">镜头信息</div>
        <div className="field-row">
          <div className="field" style={{ flex: 1 }}>
            <label>场次</label>
            <input type="text" value={frame.shot.sceneNo} onChange={(e) => setFrameShot(frame.id, { sceneNo: e.target.value })} onBlur={save} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>镜号</label>
            <input type="text" value={frame.shot.shotNo} onChange={(e) => setFrameShot(frame.id, { shotNo: e.target.value })} onBlur={save} />
          </div>
        </div>
        <ShotSelect label="景别" options={SHOT_SIZES} value={frame.shot.shotSize} onChange={(v) => { setFrameShot(frame.id, { shotSize: v }); void save() }} />
        <ShotSelect label="机位 / 角度" options={CAMERA_ANGLES} value={frame.shot.cameraAngle} onChange={(v) => { setFrameShot(frame.id, { cameraAngle: v }); void save() }} />
        <div className="field">
          <label>镜头 / 焦段</label>
          <input type="text" value={frame.shot.lens} placeholder="例如 35mm / 长焦压缩 / 广角畸变" onChange={(e) => setFrameShot(frame.id, { lens: e.target.value })} onBlur={save} />
        </div>
        <ShotSelect label="镜头运动" options={MOVEMENTS} value={frame.shot.movement} onChange={(v) => { setFrameShot(frame.id, { movement: v }); void save() }} />
        <ShotSelect label="转场" options={TRANSITIONS} value={frame.shot.transition} onChange={(v) => { setFrameShot(frame.id, { transition: v }); void save() }} />
      </div>

      {frame.reference && (
        <div className="panel-section reference-detail">
          <div className="panel-title">参考拆解</div>
          <dl className="reference-grid">
            <dt>场景</dt><dd>{frame.reference.scene}</dd>
            <dt>镜头类型</dt><dd>{frame.reference.shotType}</dd>
            <dt>构图</dt><dd>{frame.reference.composition}</dd>
            <dt>光线</dt><dd>{frame.reference.lighting}</dd>
            <dt>色彩</dt><dd>{frame.reference.color}</dd>
            <dt>情绪</dt><dd>{frame.reference.mood}</dd>
            <dt>用途</dt><dd>{frame.reference.purpose}</dd>
            <dt>可用于</dt><dd>{frame.reference.shotUsage}</dd>
            <dt>AI 备注</dt><dd>{frame.reference.aiPromptNote}</dd>
          </dl>
          <div className="reference-tags">
            {frame.reference.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </div>
      )}

      <div className="panel-section">
        <div className="panel-title">画面标注</div>
        <div className="hint" style={{ marginBottom: 8 }}>
          标记镜头运动、人物动线或美术重点。选择工具后拖拽画箭头，或点击添加文字。
        </div>
        <div className="seg" style={{ marginBottom: 8 }}>
          <button className={annotTool === 'arrow' ? 'active' : ''} onClick={() => setAnnotTool(annotTool === 'arrow' ? 'none' : 'arrow')}>↗ 箭头</button>
          <button className={annotTool === 'text' ? 'active' : ''} onClick={() => setAnnotTool(annotTool === 'text' ? 'none' : 'text')}>T 文字</button>
        </div>
        <div className="anno-swatches">
          {ANNOTATION_COLORS.map((c) => (
            <button key={c} className={`anno-swatch ${annotColor === c ? 'sel' : ''}`} style={{ background: c }} onClick={() => setAnnotColor(c)} title={c} />
          ))}
          <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => { clearAnnotations(frame.id); void save() }} disabled={frame.annotations.length === 0}>清空</button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">构图裁切</div>
        <div className="seg">
          <button className={!crop ? 'active' : ''} onClick={() => onAspect(null)}>不裁切</button>
          {CROP_ASPECTS.map((a) => <button key={a} className={crop?.aspect === a ? 'active' : ''} onClick={() => onAspect(a)}>{a}</button>)}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          {crop ? '拖拽裁切框调整构图；导出时会按原始分辨率应用。' : '选择画幅比例后，可在画面上调整裁切框。'}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">AI 提示词</div>
        <div className="field">
          <label>生成器风格</label>
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            {BUILTIN_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button className="btn primary block" onClick={onGenerate} disabled={generating}>{generating ? '生成中…' : '✨ 生成提示词'}</button>
        {error && <div className="err-text" style={{ marginTop: 8 }}>{error}</div>}
        <textarea
          className="prompt-box"
          style={{ marginTop: 10 }}
          value={promptText}
          placeholder="可生成提示词、使用离线模板，或直接写给图像/视频模型的画面说明…"
          onChange={(e) => setPromptText(e.target.value)}
          onBlur={() => {
            if (frameId) setFramePrompt(frameId, promptText, profileId, frame.prompt?.model ?? 'edited')
            void save()
          }}
        />
        <div className="field-row" style={{ marginTop: 8 }}>
          <button className="btn small" onClick={onCopy} disabled={!promptText}>复制提示词</button>
          <button className="btn small" onClick={() => setShowTemplate((v) => !v)}>{showTemplate ? '收起模板' : '离线模板'}</button>
        </div>

        {showTemplate && (
          <div style={{ marginTop: 12 }}>
            <div className="hint" style={{ marginBottom: 8 }}>
              无需 API：填写景别、机位、光线和情绪，从参考卡元数据生成提示词草稿。
            </div>
            <TplSelect label="景别" options={SHOT_SIZES} value={tpl.shotSize} onChange={(v) => { setTpl({ ...tpl, shotSize: v }); if (frameId) { setFrameShot(frameId, { shotSize: v }); void save() } }} />
            <TplSelect label="机位 / 角度" options={CAMERA_ANGLES} value={tpl.cameraAngle} onChange={(v) => { setTpl({ ...tpl, cameraAngle: v }); if (frameId) { setFrameShot(frameId, { cameraAngle: v }); void save() } }} />
            <TplSelect label="光线" options={LIGHTING_STYLES} value={tpl.lighting} onChange={(v) => setTpl({ ...tpl, lighting: v })} />
            <TplSelect label="情绪" options={MOODS} value={tpl.mood} onChange={(v) => setTpl({ ...tpl, mood: v })} />
            <button className="btn block" onClick={onApplyTemplate}>生成离线提示词</button>
          </div>
        )}
      </div>
    </div>
  )
}

function TplSelect({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function ShotSelect({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
