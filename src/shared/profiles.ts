/**
 * Generator profiles — data-driven prompt phrasing for the supported image
 * generators. Each profile carries:
 *   - phrasingGuide: fed to Claude's system prompt so the model returns a
 *     promptText already shaped for that generator.
 *   - formatPrompt: a pure OFFLINE fallback used by the template mode, which
 *     assembles a prompt from the user's dropdown selections + label/notes
 *     (no API needed).
 *
 * Pure module: no DOM / Electron / Node imports.
 */

import type { CropAspect } from './types'

/** Fields the offline template mode fills from user-editable dropdowns. */
export interface TemplateFields {
  label: string
  notes: string
  shotSize: string
  cameraAngle: string
  lighting: string
  mood: string
  /** The frame's target crop aspect (for --ar and similar). */
  aspect: CropAspect | null
}

export interface GeneratorProfile {
  id: string
  name: string
  /** One-line description shown in the UI. */
  blurb: string
  /** Guidance handed to Claude so promptText is phrased for this generator. */
  phrasingGuide: string
  /** Offline fallback: build a prompt string from template fields. */
  formatPrompt(fields: TemplateFields): string
}

/** Midjourney's --ar takes "W:H"; map our aspects (free → omit). */
function mjAspectArg(aspect: CropAspect | null): string {
  if (!aspect || aspect === 'free') return ''
  return ` --ar ${aspect.replace(':', ':')}`
}

/** Drop empty template parts and join with a separator. */
function joinParts(parts: (string | undefined)[], sep: string): string {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean).join(sep)
}

export const BUILTIN_PROFILES: GeneratorProfile[] = [
  {
    id: 'midjourney',
    name: 'Midjourney',
    blurb: '逗号短语，自动追加 --ar 与 --style raw。',
    phrasingGuide:
      'Phrase promptText for Midjourney v6: a single line of comma-separated visual phrases (no full sentences), ordered subject → action/blocking → environment → lighting → color/mood → lens & shot size → style keywords. Do NOT append any --ar or --style flags yourself; the app adds them. Keep it vivid and concrete.',
    formatPrompt: (f) =>
      joinParts(
        [
          f.label && f.label.toLowerCase(),
          f.notes,
          f.shotSize,
          f.cameraAngle,
          f.lighting,
          f.mood,
          'cinematic still, film grain, detailed'
        ],
        ', '
      ) + mjAspectArg(f.aspect) + ' --style raw'
  },
  {
    id: 'flux',
    name: 'Flux',
    blurb: '自然语言描述，镜头与光线优先。',
    phrasingGuide:
      'Phrase promptText for Flux: fluent natural-language sentences. Lead with the camera (shot size, angle, lens feel), then the subject and blocking, then environment, then lighting and color/mood. Flux rewards descriptive prose; avoid keyword salad and avoid trailing flags.',
    formatPrompt: (f) =>
      joinParts(
        [
          joinParts([f.shotSize, f.cameraAngle], ', '),
          f.label ? `of ${f.label.toLowerCase()}` : '',
          f.notes ? `— ${f.notes}` : '',
          f.lighting ? `Lit with ${f.lighting.toLowerCase()}.` : '',
          f.mood ? `${f.mood} mood.` : '',
          'Cinematic photograph.'
        ],
        ' '
      )
  },
  {
    id: 'gpt-image',
    name: 'GPT-Image',
    blurb: '适合图像模型的一段式详细指令。',
    phrasingGuide:
      'Phrase promptText for GPT-Image / DALL·E-style models: one detailed, instructive paragraph that describes the exact image to create. Be explicit and directive ("Create a … shot showing …"). Cover framing, subject and blocking, setting, lighting, and color/mood in complete sentences. No flags.',
    formatPrompt: (f) =>
      joinParts(
        [
          `Create a ${joinParts([f.shotSize, f.cameraAngle], ' ')} shot`,
          f.label ? `of ${f.label.toLowerCase()}` : 'of the scene',
          f.notes ? `. ${f.notes}` : '',
          f.lighting ? `. The scene is lit with ${f.lighting.toLowerCase()}` : '',
          f.mood ? `, with a ${f.mood.toLowerCase()} mood` : '',
          '. Render it as a cinematic film still.'
        ],
        ''
      )
  },
  {
    id: 'nano-banana',
    name: 'Nano Banana',
    blurb: '简洁场景描述，并强调匹配构图。',
    phrasingGuide:
      'Phrase promptText for Nano Banana (Gemini image): a concise scene description in 1-2 sentences, then a final clause beginning "Match this framing:" that names the shot size, camera angle, and lens feel precisely so the generator reproduces the reference composition. Keep it tight.',
    formatPrompt: (f) =>
      joinParts(
        [
          joinParts([f.label ? f.label.toLowerCase() : 'the scene', f.notes], ', '),
          f.lighting ? `${f.lighting}.` : '',
          f.mood ? `${f.mood} mood.` : '',
          `Match this framing: ${joinParts([f.shotSize, f.cameraAngle], ', ')}.`
        ],
        ' '
      )
  },
  {
    id: 'sdxl',
    name: 'SDXL',
    blurb: '标签式关键词，适合本地模型。',
    phrasingGuide:
      'Phrase promptText for SDXL: a comma-separated list of short tags (booru/keyword style), ordered subject, action, environment, lighting, color/mood, shot size, angle, lens, then quality tags. No full sentences, no flags, no negative prompt.',
    formatPrompt: (f) =>
      joinParts(
        [
          f.label && f.label.toLowerCase(),
          f.notes,
          f.shotSize,
          f.cameraAngle,
          f.lighting,
          f.mood,
          'cinematic, highly detailed, sharp focus, film still, 8k, masterpiece'
        ],
        ', '
      )
  },
  {
    id: 'generic',
    name: '通用',
    blurb: '干净的电影画面描述，不绑定具体模型。',
    phrasingGuide:
      'Phrase promptText as a clean, generator-agnostic cinematic description: 2-4 sentences covering shot size and angle, subject and blocking, environment, lighting, and color/mood. No flags, no tags, no tool-specific syntax.',
    formatPrompt: (f) =>
      joinParts(
        [
          joinParts([f.shotSize, f.cameraAngle], ', ') + '.',
          f.label ? `Subject: ${f.label.toLowerCase()}.` : '',
          f.notes ? `${f.notes}.` : '',
          f.lighting ? `Lighting: ${f.lighting.toLowerCase()}.` : '',
          f.mood ? `Mood: ${f.mood.toLowerCase()}.` : '',
          'Cinematic film still.'
        ],
        ' '
      )
  }
]

export const PROFILE_MAP: Record<string, GeneratorProfile> = Object.fromEntries(
  BUILTIN_PROFILES.map((p) => [p.id, p])
)

export const DEFAULT_PROFILE_ID = 'midjourney'

export function getProfile(id: string): GeneratorProfile {
  return PROFILE_MAP[id] ?? PROFILE_MAP[DEFAULT_PROFILE_ID]!
}

/* Dropdown option lists for the offline template controls. */
export const SHOT_SIZES = [
  '大远景',
  '远景',
  '全景',
  '中远景',
  '中景',
  '中近景',
  '近景',
  '特写',
  '大特写'
]

export const CAMERA_ANGLES = [
  '平视',
  '低机位',
  '高机位',
  '俯拍 / 顶拍',
  '倾斜构图',
  '过肩',
  '主观视角',
  '背影跟拍'
]

export const LIGHTING_STYLES = [
  '柔和日光',
  '黄金时刻',
  '硬质阳光',
  '阴天漫射光',
  '蓝调时刻',
  '夜外景',
  '暖色室内实景灯',
  '冷色室内顶光',
  '霓虹 / 实景光源',
  '低调明暗对比',
  '高调柔光',
  '雨夜逆光',
  '灯塔扫光'
]

export const MOVEMENTS = [
  '固定机位',
  '左摇',
  '右摇',
  '上摇',
  '下摇',
  '轨道推进',
  '轨道后退',
  '缓慢推近',
  '缓慢拉远',
  '横移跟拍',
  '右向跟移',
  '升降上升',
  '升降下降',
  '手持',
  '快速甩镜',
  '变焦推近',
  '变焦拉远',
  '航拍俯冲'
]

export const TRANSITIONS = [
  '切',
  '匹配剪辑',
  '叠化',
  '淡入',
  '淡出',
  '甩镜转场',
  '强切',
  'J Cut',
  'L Cut'
]

export const MOODS = [
  '中性',
  '紧张',
  '温暖',
  '忧郁',
  '梦感',
  '粗粝',
  '浪漫',
  '不祥',
  '动势强',
  '静谧',
  '孤独',
  '压迫',
  '神秘'
]
