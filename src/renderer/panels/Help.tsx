/** Help overlay: Chinese quick-start and workflow reference. */

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { Credits } from '../App'
import logoUrl from '../assets/logo.png'

const CARDS = [
  { emoji: '📥', title: '导入参考', body: '导入视频、图片或临时声音轨，也可以直接粘贴截图作为镜头参考。' },
  { emoji: '🎞️', title: '抽取画面', body: '在视频里拖动时间线，标记关键帧；也可以按切点、间隔或数量自动抽帧。' },
  { emoji: '✂️', title: '拆解构图', body: '选中参考卡后调整画幅、标注动线，并记录景别、机位、光线、色彩和情绪。' },
  { emoji: '🎬', title: '协作导出', body: '播放参考板做动态预览，并导出参考包、镜头清单、PDF 或动态分镜。' }
]

const TASKS = [
  { q: '如何加载内置案例？', a: '点击欢迎页的“加载雨夜灯塔 Demo”，会生成一套完整中文分镜参考板。' },
  { q: '如何从视频添加一帧？', a: '打开素材，拖到需要的时间点，点击“标记参考”或按 B。' },
  { q: '如何按镜头语言检索？', a: '在底部参考板搜索框输入景别、场景、情绪、色彩、构图、人物或地点标签。' },
  { q: '如何自动抽帧？', a: '点击“自动抽帧”，选择场景切点、每 N 秒或固定数量。' },
  { q: '如何裁切成目标画幅？', a: '选中参考卡，在“构图裁切”里选择 16:9、2.39:1、1:1 等比例并拖动裁切框。' },
  { q: '没有 API 密钥怎么办？', a: '工具本地优先，导入、整理、保存、筛选都不需要账号。提示词可以用“离线模板”生成草稿。' },
  { q: '导出参考包包含什么？', a: '每张参考的 still.png、prompt.txt，加上 prompts.json、contact-sheet.png 和 board.md。' },
  { q: '项目保存在哪里？', a: '项目是本地 .sbref 文件夹，包含 project.json、media、.frames 和 exports，不会上云。' }
]

const SHORTCUTS = [
  { k: 'Space', d: '播放 / 暂停素材或动态分镜' },
  { k: '← / →', d: '前后一帧或切换参考卡' },
  { k: 'I / O', d: '设置视频入点 / 出点' },
  { k: 'B', d: '标记当前参考帧' },
  { k: 'P', d: '播放参考板' },
  { k: 'A', d: '箭头标注工具' },
  { k: 'T', d: '文字标注工具' },
  { k: 'G', d: '显示 / 隐藏构图安全线' },
  { k: 'Ctrl / ⌘ + S', d: '保存当前项目' },
  { k: '?', d: '打开 / 关闭帮助' }
]

export function HelpOverlay(): JSX.Element | null {
  const open = useStore((s) => s.helpOpen)
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TASKS
    return TASKS.filter((t) => (t.q + ' ' + t.a).toLowerCase().includes(q))
  }, [query])

  if (!open) return null
  return (
    <div className="help-backdrop" onClick={() => setHelpOpen(false)}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <h2>帮助与快速上手</h2>
          <button className="btn small" onClick={() => setHelpOpen(false)}>关闭</button>
        </div>
        <div className="help-body">
          <div className="help-section-title">快速流程</div>
          <div className="help-cards">
            {CARDS.map((c) => (
              <div className="help-card" key={c.title}>
                <div className="help-card-emoji">{c.emoji}</div>
                <div className="help-card-title">{c.title}</div>
                <div className="help-card-body">{c.body}</div>
              </div>
            ))}
          </div>

          <div className="help-section-title">常见问题</div>
          <input className="help-search" placeholder="搜索：构图、标签、导出、提示词…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {filtered.length === 0 ? <div className="hint">没有匹配的问题。</div> : filtered.map((t) => (
            <div className="help-task" key={t.q}>
              <div className="help-task-q">{t.q}</div>
              <div className="help-task-a">{t.a}</div>
            </div>
          ))}

          <div className="help-section-title" style={{ marginTop: 24 }}>快捷键</div>
          {SHORTCUTS.map((s) => (
            <div className="help-kbd-row" key={s.k}>
              <div className="help-kbd-keys"><span className="help-kbd">{s.k}</span></div>
              <div className="help-kbd-desc">{s.d}</div>
            </div>
          ))}

          <div className="help-section-title" style={{ marginTop: 24 }}>关于</div>
          <div className="help-about">
            <img src={logoUrl} alt="Storyboard Reference Studio" className="help-about-logo" />
            <div>
              <div className="help-about-name">分镜参考工作室</div>
              <div className="help-about-tag">中文分镜参考、镜头图像资料库与视觉风格检索工作台。</div>
              <Credits />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
