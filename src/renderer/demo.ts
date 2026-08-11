import type { CropAspect, Frame, MediaItem, Project, ReferenceMeta } from '@shared/types'

interface DemoStill {
  path: string
  width: number
  height: number
}

interface DemoSpec {
  id: string
  title: string
  visual: 'road' | 'pickup' | 'mirror' | 'door' | 'stairwell' | 'flashlight' | 'lantern' | 'glass' | 'sea' | 'console'
  reference: ReferenceMeta
  shot: Frame['shot']
  cropAspect: CropAspect | null
  prompt: string
}

export interface LighthouseDemo {
  folderName: string
  doc: Project
  stills: Record<string, DemoStill>
}

const WIDTH = 1600
const HEIGHT = 900

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function visualSvg(spec: DemoSpec): string {
  const base = `
    <defs>
      <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#07111d"/>
        <stop offset="52%" stop-color="#10283b"/>
        <stop offset="100%" stop-color="#05070a"/>
      </linearGradient>
      <radialGradient id="lamp" cx="62%" cy="32%" r="42%">
        <stop offset="0%" stop-color="#ffd891" stop-opacity="0.95"/>
        <stop offset="42%" stop-color="#d99b45" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#d99b45" stop-opacity="0"/>
      </radialGradient>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="2" stitchTiles="stitch"/>
        <feColorMatrix type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="table" tableValues="0 0.16"/></feComponentTransfer>
      </filter>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#lamp)"/>
  `

  const rain = Array.from({ length: 44 }, (_, i) => {
    const x = (i * 73) % WIDTH
    const y = (i * 41) % HEIGHT
    return `<path d="M${x} ${y} l-42 92" stroke="#9ed7ff" stroke-opacity="${i % 3 === 0 ? 0.38 : 0.18}" stroke-width="2"/>`
  }).join('')

  const title = `
    <g font-family="Microsoft YaHei, PingFang SC, Arial" fill="#e8f4ff">
      <text x="64" y="92" font-size="40" font-weight="700">${spec.title}</text>
      <text x="64" y="138" font-size="24" fill="#9fb5c8">${spec.reference.scene} · ${spec.reference.shotType}</text>
    </g>
  `

  const lighthouse = `
    <g>
      <polygon points="1150,820 1288,820 1256,302 1188,302" fill="#d7d2c5"/>
      <rect x="1168" y="250" width="108" height="58" fill="#293849"/>
      <rect x="1148" y="218" width="148" height="42" rx="12" fill="#c9b98c"/>
      <path d="M1194 260 L680 448" stroke="#ffd891" stroke-width="34" stroke-opacity="0.28"/>
      <path d="M1260 260 L1540 196" stroke="#ffd891" stroke-width="28" stroke-opacity="0.2"/>
    </g>
  `

  const motifs: Record<DemoSpec['visual'], string> = {
    road: `
      <path d="M0 782 C360 690 640 620 1030 606 C1250 598 1430 632 1600 690 L1600 900 L0 900 Z" fill="#111318"/>
      <path d="M280 900 C500 760 690 675 918 613" stroke="#b2c3c9" stroke-opacity="0.4" stroke-width="8" fill="none"/>
      <path d="M420 900 C640 760 790 688 980 620" stroke="#f7c96d" stroke-opacity="0.72" stroke-width="5" stroke-dasharray="40 42" fill="none"/>
      <ellipse cx="585" cy="706" rx="190" ry="34" fill="#f8c15a" opacity="0.28"/>
      ${lighthouse}`,
    pickup: `
      <rect x="0" y="540" width="1600" height="360" fill="#06080c"/>
      <path d="M120 185 L1480 150 L1330 586 L260 618 Z" fill="#182736" stroke="#4e687d" stroke-width="8"/>
      <rect x="350" y="610" width="900" height="96" rx="28" fill="#12151a"/>
      <circle cx="1112" cy="681" r="82" fill="#06080c" stroke="#4b5562" stroke-width="16"/>
      <path d="M1090 310 C1010 398 1018 518 1118 596" stroke="#ffe1a1" stroke-opacity="0.4" stroke-width="24" fill="none"/>
      ${lighthouse}`,
    mirror: `
      <rect x="0" y="0" width="1600" height="900" fill="#05080d"/>
      <rect x="420" y="238" width="760" height="300" rx="70" fill="#0f202e" stroke="#73889a" stroke-width="18"/>
      <clipPath id="clip"><rect x="446" y="264" width="708" height="248" rx="54"/></clipPath>
      <g clip-path="url(#clip)"><rect x="430" y="250" width="740" height="270" fill="url(#sky)"/>${lighthouse}<path d="M0 500 L1600 420" stroke="#91b0c9" stroke-opacity="0.3" stroke-width="20"/></g>
      <path d="M650 590 C740 650 870 650 964 590" stroke="#10151b" stroke-width="34" fill="none"/>
      <rect x="260" y="668" width="1080" height="158" rx="36" fill="#10141a"/>`,
    door: `
      <rect x="0" y="660" width="1600" height="240" fill="#0a0c10"/>
      <path d="M0 700 C260 610 450 595 690 650 C1010 724 1240 692 1600 602 L1600 900 L0 900 Z" fill="#0e1d28"/>
      <rect x="914" y="244" width="180" height="420" fill="#d1c7b2"/>
      <rect x="952" y="320" width="106" height="344" rx="52" fill="#121820"/>
      <path d="M1005 332 L434 566" stroke="#ffd891" stroke-opacity="0.34" stroke-width="30"/>
      ${lighthouse}`,
    stairwell: `
      <rect x="0" y="0" width="1600" height="900" fill="#090b10"/>
      <circle cx="800" cy="456" r="356" fill="none" stroke="#384250" stroke-width="92"/>
      <circle cx="800" cy="456" r="206" fill="none" stroke="#756a55" stroke-width="74"/>
      <path d="M800 100 L800 812 M445 456 L1155 456 M548 204 L1052 708 M1052 204 L548 708" stroke="#9a8f77" stroke-width="28" stroke-opacity="0.72"/>
      <circle cx="800" cy="456" r="92" fill="#111821"/>
      <path d="M820 438 L1160 258" stroke="#ffd891" stroke-opacity="0.32" stroke-width="38"/>`,
    flashlight: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#07090d"/>
      <path d="M210 900 L760 238 L1025 238 L560 900 Z" fill="#222126"/>
      <path d="M700 448 L1340 312" stroke="#e4f3ff" stroke-opacity="0.18" stroke-width="84"/>
      <circle cx="674" cy="456" r="58" fill="#f1d9a2"/>
      <path d="M1020 238 L1128 900" stroke="#5c6673" stroke-width="28"/>
      <path d="M770 238 L650 900" stroke="#4a5460" stroke-width="20"/>`,
    lantern: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#07111d"/>
      <rect x="520" y="160" width="560" height="500" rx="38" fill="#152330" stroke="#9b8e6c" stroke-width="16"/>
      <circle cx="800" cy="410" r="154" fill="#ffca6a" opacity="0.92"/>
      <circle cx="800" cy="410" r="238" fill="none" stroke="#ffca6a" stroke-opacity="0.24" stroke-width="78"/>
      <path d="M524 410 L80 270 M1076 410 L1520 270" stroke="#ffca6a" stroke-opacity="0.26" stroke-width="72"/>
      <path d="M390 760 C560 685 1020 685 1210 760" stroke="#2c3642" stroke-width="44" fill="none"/>`,
    glass: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#08111a"/>
      <rect x="240" y="120" width="1120" height="620" rx="42" fill="#0f2230" stroke="#496174" stroke-width="18"/>
      <path d="M260 518 C430 450 612 484 782 542 C968 606 1160 606 1340 504 L1340 740 L260 740 Z" fill="#0b2b42"/>
      <path d="M260 518 C440 466 610 486 800 552 C1008 624 1184 594 1340 510" stroke="#c8edff" stroke-width="16" stroke-opacity="0.52" fill="none"/>
      <path d="M456 150 L360 720 M808 128 L790 738 M1168 146 L1240 720" stroke="#a9c5d8" stroke-opacity="0.28" stroke-width="10"/>
      <circle cx="1020" cy="350" r="58" fill="#ffd891" opacity="0.4"/>`,
    sea: `
      <rect x="0" y="430" width="1600" height="470" fill="#071b2d"/>
      <path d="M0 538 C210 488 320 604 530 548 C780 480 940 620 1160 536 C1340 466 1470 518 1600 488" stroke="#c5eeff" stroke-width="18" stroke-opacity="0.5" fill="none"/>
      <path d="M0 642 C240 586 388 702 626 650 C880 594 1040 704 1288 646 C1434 612 1526 606 1600 618" stroke="#8fc7e6" stroke-width="11" stroke-opacity="0.32" fill="none"/>
      <path d="M1012 120 L150 500" stroke="#ffd891" stroke-opacity="0.36" stroke-width="52"/>
      ${lighthouse}`,
    console: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#090d13"/>
      <rect x="320" y="210" width="960" height="470" rx="30" fill="#19202b" stroke="#5d6874" stroke-width="14"/>
      <circle cx="590" cy="436" r="72" fill="#131922" stroke="#d4a44f" stroke-width="12"/>
      <circle cx="800" cy="436" r="48" fill="#31475c"/>
      <circle cx="1010" cy="436" r="72" fill="#131922" stroke="#d4a44f" stroke-width="12"/>
      <path d="M456 678 L384 820 M1144 678 L1216 820" stroke="#313a44" stroke-width="44"/>
      <rect x="520" y="282" width="560" height="74" rx="16" fill="#24394a"/>
      <path d="M560 320 L1040 320" stroke="#9ecbf0" stroke-width="10" stroke-dasharray="24 18"/>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${base}${motifs[spec.visual]}${rain}${title}<rect width="${WIDTH}" height="${HEIGHT}" filter="url(#grain)" opacity="0.36"/></svg>`
}

const specs: DemoSpec[] = [
  {
    id: 'road',
    title: '外景沿海公路：远处灯塔扫光',
    visual: 'road',
    cropAspect: '2.39:1',
    shot: { sceneNo: 'S01', shotNo: '001', shotSize: '大远景', cameraAngle: '低机位', lens: '24mm', movement: '横移跟拍', transition: '切' },
    reference: {
      scene: '外景沿海公路',
      shotType: '大远景 / 建立镜头',
      composition: '海岸线斜切画面，公路形成纵深引导线，灯塔放在右三分之一',
      lighting: '雨夜车灯反射 + 远处灯塔扫光',
      color: '冷蓝海雾、黑色柏油、少量钠灯橙',
      mood: '孤独、危险、目的地召唤',
      purpose: '开场建立空间关系，给导演和美术确定海岸、公路、灯塔三者距离',
      shotUsage: '第 1 场 / 第 1 镜，片头车辆抵达前的环境建立',
      tags: ['沿海公路', '雨夜', '灯塔', '建立镜头', '车灯反射', '外景'],
      aiPromptNote: '强调 wet asphalt reflections, distant lighthouse beam, coastal storm, anamorphic wide frame'
    },
    prompt: '雨夜沿海公路大远景，低机位贴近湿漉漉柏油，皮卡车灯在路面拉出长反光，远处灯塔扫光切开海雾，冷蓝黑色调中有少量钠灯橙，2.39:1 宽银幕电影感。'
  },
  {
    id: 'pickup',
    title: '皮卡车内：挡风玻璃雨痕压住人物',
    visual: 'pickup',
    cropAspect: '16:9',
    shot: { sceneNo: 'S01', shotNo: '006', shotSize: '中近景', cameraAngle: '平视', lens: '35mm', movement: '手持', transition: '切' },
    reference: {
      scene: '皮卡车内',
      shotType: '中近景 / 车内压迫镜头',
      composition: '挡风玻璃做前景层，人物被方向盘和车窗框分割',
      lighting: '仪表盘冷光、雨刷间歇遮挡、灯塔扫光短暂划过脸部',
      color: '青灰、暗绿、仪表盘蓝',
      mood: '焦虑、犹豫、被困住',
      purpose: '给摄影确定车内反光层次，也给演员调度留出视线方向',
      shotUsage: '第 1 场 / 第 6 镜，主角第一次看见灯塔异常闪烁',
      tags: ['车内', '人物', '雨刷', '挡风玻璃', '反光', '主角'],
      aiPromptNote: '可加入 rain streaks on windshield, dashboard glow, face half lit by lighthouse sweep'
    },
    prompt: '皮卡车内中近景，主角坐在驾驶位，挡风玻璃上雨痕和雨刷形成前景遮挡，仪表盘蓝光照亮下半张脸，灯塔扫光一闪而过，车窗外是模糊的黑色海岸。'
  },
  {
    id: 'mirror',
    title: '后视镜：灯塔被框在小画面里',
    visual: 'mirror',
    cropAspect: '16:9',
    shot: { sceneNo: 'S01', shotNo: '008', shotSize: '特写', cameraAngle: '主观视角', lens: '70mm', movement: '固定机位', transition: '匹配剪辑' },
    reference: {
      scene: '皮卡车内',
      shotType: '特写 / 框中框',
      composition: '后视镜形成画中画，灯塔位于镜面中心偏右，车内暗部包围',
      lighting: '镜面里灯塔强光，车内仅保留轮廓',
      color: '深黑车内、冷蓝雨幕、暖白灯塔',
      mood: '不安、被追踪、预兆',
      purpose: '给剪辑和摄影建立“回望灯塔”的视觉母题',
      shotUsage: '第 1 场 / 第 8 镜，主角停车前回头确认光源',
      tags: ['后视镜', '框中框', '灯塔', '主观视角', '悬疑'],
      aiPromptNote: '关键词 rear-view mirror composition, lighthouse framed inside mirror, dark car interior'
    },
    prompt: '后视镜特写，黑暗车内只见一块湿润镜面，镜中远处灯塔被框成小画面，暖白扫光穿过冷蓝雨幕，画面形成强烈框中框构图。'
  },
  {
    id: 'door',
    title: '灯塔入口：门缝里溢出暖光',
    visual: 'door',
    cropAspect: '2.39:1',
    shot: { sceneNo: 'S02', shotNo: '014', shotSize: '全景', cameraAngle: '低机位', lens: '28mm', movement: '缓慢推近', transition: '切' },
    reference: {
      scene: '灯塔外部入口',
      shotType: '全景 / 门口调度',
      composition: '人物可放在画面左下形成尺度对比，塔身垂直线压迫画面',
      lighting: '门缝暖光、背后冷雨、顶部扫光偶发闪烁',
      color: '冷蓝石墙、暖黄门缝、暗红铁锈',
      mood: '未知、临界点、进入禁区',
      purpose: '给美术确定入口材质：湿石墙、锈铁门、盐雾痕迹',
      shotUsage: '第 2 场 / 第 14 镜，主角推门进入灯塔',
      tags: ['灯塔入口', '湿石墙', '门缝光', '美术参考', '推近'],
      aiPromptNote: 'wet stone lighthouse entrance, warm light leaking through heavy door, storm rain'
    },
    prompt: '灯塔入口全景，低机位仰看湿石墙和锈铁门，门缝里漏出窄窄暖光，背后是冷蓝雨夜和海雾，人物可以缩小放在左下角形成压迫比例。'
  },
  {
    id: 'stairwell',
    title: '楼梯井俯拍：螺旋结构像陷阱',
    visual: 'stairwell',
    cropAspect: '1:1',
    shot: { sceneNo: 'S02', shotNo: '021', shotSize: '大远景', cameraAngle: '俯拍 / 顶拍', lens: '18mm', movement: '升降下降', transition: '叠化' },
    reference: {
      scene: '灯塔楼梯井',
      shotType: '顶拍 / 几何构图',
      composition: '螺旋楼梯围绕中心黑洞，人物可作为小尺度点位',
      lighting: '顶端冷光向下衰减，手电光形成局部暖点',
      color: '铁锈棕、冷灰石壁、黑色中心',
      mood: '眩晕、压迫、不可逆',
      purpose: '给导演设计人物上楼节奏，也给摄影确定顶拍机位价值',
      shotUsage: '第 2 场 / 第 21 镜，主角进入楼梯井后的空间揭示',
      tags: ['楼梯井', '俯拍', '螺旋', '几何构图', '空间压迫'],
      aiPromptNote: 'spiral lighthouse stairwell top-down, vertigo composition, small human scale'
    },
    prompt: '灯塔楼梯井顶拍，螺旋铁梯围绕中心黑洞下坠，墙面潮湿有铁锈，冷光从顶端衰减，手电光在某一级台阶形成小小暖点，压迫的几何构图。'
  },
  {
    id: 'flashlight',
    title: '楼梯转折：手电光切开黑暗',
    visual: 'flashlight',
    cropAspect: '16:9',
    shot: { sceneNo: 'S02', shotNo: '025', shotSize: '近景', cameraAngle: '倾斜构图', lens: '40mm', movement: '手持', transition: '强切' },
    reference: {
      scene: '灯塔楼梯井',
      shotType: '近景 / 手持悬疑',
      composition: '扶手与墙面形成斜线，人物只露手和半张脸',
      lighting: '手电硬光束，背景几乎全黑',
      color: '黑蓝阴影、手电冷白、铁锈暗红',
      mood: '紧张、搜索、危险接近',
      purpose: '给摄影和灯光设计移动光源的遮挡、扫过和曝光策略',
      shotUsage: '第 2 场 / 第 25 镜，发现墙上旧海图前的搜索段落',
      tags: ['手电', '手持', '楼梯', '倾斜构图', '悬疑节奏'],
      aiPromptNote: 'handheld flashlight beam, dutch angle, rusty lighthouse stair landing, partial face'
    },
    prompt: '楼梯转折近景，手持倾斜构图，手电硬光束斜切黑暗，扶手和墙面形成压迫斜线，人物只露出手、雨衣袖口和半张脸，背景吞没在黑蓝阴影里。'
  },
  {
    id: 'lantern',
    title: '灯室：巨大菲涅尔透镜像太阳',
    visual: 'lantern',
    cropAspect: '16:9',
    shot: { sceneNo: 'S03', shotNo: '033', shotSize: '中景', cameraAngle: '低机位', lens: '32mm', movement: '缓慢推近', transition: '切' },
    reference: {
      scene: '灯室',
      shotType: '中景 / 核心道具展示',
      composition: '菲涅尔透镜占据画面中心，人物绕边缘形成剪影',
      lighting: '灯泡暖光爆发，边缘玻璃产生环形眩光',
      color: '金黄、煤黑、玻璃青',
      mood: '神秘、仪式感、危险美感',
      purpose: '给美术和 VFX 确定核心道具尺度、玻璃折射和眩光风格',
      shotUsage: '第 3 场 / 第 33 镜，主角第一次看见灯室内部',
      tags: ['灯室', '菲涅尔透镜', '核心道具', '剪影', '眩光'],
      aiPromptNote: 'giant Fresnel lens, warm glowing lighthouse lamp, silhouetted figure, volumetric haze'
    },
    prompt: '灯室中景，低机位对准巨大的菲涅尔透镜，暖金色灯泡像小太阳一样爆发，人物绕在画面边缘成剪影，玻璃青色折射和环形眩光充满空间。'
  },
  {
    id: 'glass',
    title: '灯室玻璃：海浪贴在窗外',
    visual: 'glass',
    cropAspect: '16:9',
    shot: { sceneNo: 'S03', shotNo: '037', shotSize: '过肩', cameraAngle: '平视', lens: '50mm', movement: '固定机位', transition: 'L Cut' },
    reference: {
      scene: '灯室',
      shotType: '过肩 / 窗外威胁',
      composition: '人物肩部做暗前景，窗框切分外部海浪',
      lighting: '室内暖边光，窗外冷色浪花闪光',
      color: '暖金边缘、冷青海水、黑色剪影',
      mood: '对峙、脆弱、风暴逼近',
      purpose: '给导演和美术协调灯室内外空间，以及窗框作为构图元素',
      shotUsage: '第 3 场 / 第 37 镜，主角从灯室看见海面异常',
      tags: ['过肩', '窗框', '海浪', '灯室', '内外反差'],
      aiPromptNote: 'over-the-shoulder inside lighthouse lantern room, storm waves outside window, warm rim light'
    },
    prompt: '灯室过肩镜头，人物肩部在暗前景，窗框把外部暴雨海浪切成几块，室内暖金边缘光擦过人物轮廓，窗外是冷青色浪花和黑海。'
  },
  {
    id: 'sea',
    title: '开阔海面：扫光寻找失踪船只',
    visual: 'sea',
    cropAspect: '2.39:1',
    shot: { sceneNo: 'S04', shotNo: '045', shotSize: '大远景', cameraAngle: '高机位', lens: '35mm', movement: '左摇', transition: '切' },
    reference: {
      scene: '开阔海面',
      shotType: '大远景 / 情绪转场',
      composition: '海平线压低，扫光从右向左横切，留出大面积负空间',
      lighting: '灯塔强扫光、浪尖冷反光、云层低亮度',
      color: '深蓝、墨绿、冷白浪花',
      mood: '空旷、搜寻、失控',
      purpose: '给剪辑做场景换气，也给声音设计留出海风与低频空间',
      shotUsage: '第 4 场 / 第 45 镜，灯塔扫海寻找无线电信号来源',
      tags: ['开阔海面', '负空间', '扫光', '浪花', '情绪转场'],
      aiPromptNote: 'wide storm sea, lighthouse beam scanning across waves, negative space, cinematic transition shot'
    },
    prompt: '开阔海面大远景，海平线压低，巨大负空间里只有灯塔扫光从右向左切过浪尖，深蓝墨绿海面、冷白浪花、低云压顶，宽银幕孤独感。'
  },
  {
    id: 'console',
    title: '破晓控制台：旧无线电重新亮起',
    visual: 'console',
    cropAspect: '4:3',
    shot: { sceneNo: 'S05', shotNo: '052', shotSize: '特写', cameraAngle: '平视', lens: '65mm', movement: '固定机位', transition: '淡出' },
    reference: {
      scene: '灯室控制台',
      shotType: '特写 / 道具线索',
      composition: '旧无线电居中，旋钮和频谱线形成对称构图',
      lighting: '破晓冷光进入，设备小灯保留暖点',
      color: '冷灰蓝、旧铜黄、暗绿色氧化痕迹',
      mood: '余波、线索、下一场钩子',
      purpose: '给美术准备控制台材质，也给 AI 视频提示词保留可复现的道具细节',
      shotUsage: '第 5 场 / 第 52 镜，结尾无线电发出第二个坐标',
      tags: ['控制台', '无线电', '道具特写', '破晓', '线索'],
      aiPromptNote: 'old lighthouse radio console close-up, dawn light, glowing frequency line, oxidized brass details'
    },
    prompt: '旧无线电控制台特写，4:3 构图，旋钮与频谱线居中对称，破晓冷光从侧面进来，设备小灯保留一点旧铜暖色，暗绿色氧化痕迹和潮湿灰尘清晰可见。'
  }
]

export function createLighthouseDemo(): LighthouseDemo {
  const media: MediaItem[] = []
  const frames: Frame[] = []
  const stills: Record<string, DemoStill> = {}

  specs.forEach((spec, order) => {
    const mediaId = `demo_media_${spec.id}`
    const frameId = `demo_frame_${spec.id}`
    const dataUrl = svgDataUrl(visualSvg(spec))

    media.push({
      id: mediaId,
      kind: 'image',
      sourceFile: dataUrl,
      name: `${String(order + 1).padStart(2, '0')}_${spec.title}.svg`,
      width: WIDTH,
      height: HEIGHT
    })

    frames.push({
      id: frameId,
      mediaId,
      timeS: 0,
      label: spec.title,
      notes: [
        `镜头类型：${spec.reference.shotType}`,
        `构图：${spec.reference.composition}`,
        `光线：${spec.reference.lighting}`,
        `色彩：${spec.reference.color}`,
        `情绪：${spec.reference.mood}`,
        `用途：${spec.reference.purpose}`,
        `可用于：${spec.reference.shotUsage}`,
        `AI 提示词备注：${spec.reference.aiPromptNote}`
      ].join('\n'),
      order,
      crop: spec.cropAspect ? { aspect: spec.cropAspect, x: 0, y: 0, w: 1, h: 1 } : null,
      prompt: {
        text: spec.prompt,
        profileId: 'generic',
        generatedAt: '2026-08-09T00:00:00.000Z',
        model: 'demo-template'
      },
      durationS: order % 3 === 0 ? 2.5 : 2,
      shot: spec.shot,
      reference: spec.reference,
      annotations:
        order === 0
          ? [{ id: 'demo_anno_beam', kind: 'arrow', points: [{ x: 0.77, y: 0.35 }, { x: 0.47, y: 0.49 }], color: '#ffd166', text: '灯塔扫光' }]
          : []
    })

    stills[frameId] = { path: dataUrl, width: WIDTH, height: HEIGHT }
  })

  return {
    folderName: '雨夜灯塔视觉参考板.sbref',
    doc: {
      version: 2,
      id: 'demo_lighthouse_rain_night',
      name: '雨夜灯塔视觉参考板',
      media,
      frames,
      settings: { defaultProfileId: 'generic', audioFile: null }
    },
    stills
  }
}
