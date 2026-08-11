import { createServer } from 'node:net'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputDir = join(root, 'output', 'playwright')
const smokeRoot = join(root, 'output', 'tauri-release-smoke')
const projectsDir = join(smokeRoot, 'projects')
const exePath = process.env.SBR_TAURI_EXE || join(root, 'src-tauri', 'target', 'release', 'storyboard-reference-studio.exe')

function zh(escaped) {
  return JSON.parse(`"${escaped}"`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function findFreePort(startPort) {
  return new Promise((resolvePort) => {
    const tryPort = (port) => {
      const server = createServer()
      server.once('error', () => tryPort(port + 1))
      server.once('listening', () => server.close(() => resolvePort(port)))
      server.listen(port, '127.0.0.1')
    }
    tryPort(startPort)
  })
}

async function waitForCdp(port, timeoutMs = 45_000) {
  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/json/version`)
      if (res.ok) return url
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error(`Timed out waiting for WebView2 CDP on ${url}`)
}

async function firstUsefulPage(browser, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const title = await page.title().catch(() => '')
        const url = page.url()
        if (title.includes('Storyboard') || url.startsWith('tauri://') || url.startsWith('http://tauri.localhost')) {
          return page
        }
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error('No Tauri WebView page exposed through CDP')
}

function latestMatching(dir, predicate) {
  return readdirSync(dir, { withFileTypes: true })
    .filter(predicate)
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

function allMatching(dir, predicate) {
  return readdirSync(dir, { withFileTypes: true })
    .filter(predicate)
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
}

function normalizePath(p) {
  return String(p ?? '').replace(/\\/g, '/').toLowerCase()
}

function isReleaseSidecar(toolPath) {
  const tool = normalizePath(toolPath)
  const exeDir = normalizePath(dirname(exePath))
  return Boolean(tool) && (
    tool.startsWith(`${exeDir}/bin/`) ||
    tool.startsWith(`${exeDir}/resources/bin/`) ||
    tool.includes('/_up_/bin/') ||
    tool.endsWith('/src-tauri/bin/ffmpeg.exe') ||
    tool.endsWith('/src-tauri/bin/ffprobe.exe')
  )
}

async function main() {
  assert(existsSync(exePath), `Release exe not found: ${exePath}`)
  mkdirSync(outputDir, { recursive: true })
  mkdirSync(projectsDir, { recursive: true })

  const cdpPort = Number(process.env.SBR_TAURI_CDP_PORT || await findFreePort(9333))
  const extraArgs = [process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, `--remote-debugging-port=${cdpPort}`, '--remote-allow-origins=*']
    .filter(Boolean)
    .join(' ')
  const env = {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: extraArgs,
    SBR_PROJECTS_DIR: projectsDir
  }
  delete env.SBR_FFMPEG
  delete env.SBR_FFPROBE

  const child = spawn(exePath, [], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

  let browser
  try {
    const cdpUrl = await waitForCdp(cdpPort)
    browser = await chromium.connectOverCDP(cdpUrl)
    const page = await firstUsefulPage(browser)
    await page.setViewportSize({ width: 1440, height: 980 })
    await page.waitForLoadState('domcontentloaded')
    await page.screenshot({ path: join(outputDir, 'tauri-release-01-welcome.png'), fullPage: true })

    await page.getByRole('button', { name: new RegExp(zh('\\u52a0\\u8f7d\\u96e8\\u591c\\u706f\\u5854 Demo')) }).click()
    await page.locator('.workspace').waitFor({ state: 'visible', timeout: 30_000 })
    await page.locator('.board-card').first().waitFor({ state: 'visible', timeout: 30_000 })
    await page.screenshot({ path: join(outputDir, 'tauri-release-02-demo-loaded.png'), fullPage: true })

    const before = await page.evaluate(() => {
      const store = window.__sbr.store.getState()
      const frames = store.orderedFrames()
      const tagSet = new Set(frames.flatMap((frame) => frame.reference?.tags ?? []))
      return { folder: store.projectFolder, frameCount: frames.length, tagCount: tagSet.size, projectName: store.doc?.name }
    })
    assert(before.frameCount >= 10, `Demo frame count too low: ${before.frameCount}`)
    assert(before.tagCount >= 40, `Demo tag count too low: ${before.tagCount}`)

    const toolStatus = await page.evaluate(async () => await window.sbr.mediaToolsStatus?.())
    assert(toolStatus?.ffmpegPath, `ffmpeg sidecar not resolved: ${JSON.stringify(toolStatus)}`)
    assert(toolStatus?.ffprobePath, `ffprobe sidecar not resolved: ${JSON.stringify(toolStatus)}`)
    assert(existsSync(toolStatus.ffmpegPath), `ffmpeg path missing on disk: ${toolStatus.ffmpegPath}`)
    assert(existsSync(toolStatus.ffprobePath), `ffprobe path missing on disk: ${toolStatus.ffprobePath}`)
    assert(isReleaseSidecar(toolStatus.ffmpegPath), `ffmpeg did not resolve to release sidecar: ${toolStatus.ffmpegPath}`)
    assert(isReleaseSidecar(toolStatus.ffprobePath), `ffprobe did not resolve to release sidecar: ${toolStatus.ffprobePath}`)

    const audioRel = 'media/smoke-scratch-track.wav'
    const audioPath = join(before.folder, 'media', 'smoke-scratch-track.wav')
    mkdirSync(dirname(audioPath), { recursive: true })
    execFileSync(toolStatus.ffmpegPath, [
      '-y',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=8',
      '-ac', '1',
      '-ar', '48000',
      audioPath
    ])
    const storedAudio = await page.evaluate(async (rel) => {
      const storeApi = window.__sbr.store
      storeApi.getState().setAudioFile(rel)
      const state = storeApi.getState()
      await window.sbr.saveProject(state.projectFolder, JSON.stringify(state.doc, null, 2))
      return state.doc?.settings.audioFile
    }, audioRel)
    assert(storedAudio === audioRel, `scratch audio was not enabled: ${storedAudio}`)

    await page.locator('.export-menu-wrap > button').click()
    await page.getByRole('button', { name: 'PDF 导演版（浅色）' }).click()
    await page.locator('.toast.success', { hasText: 'PDF 导演版已导出' }).waitFor({ timeout: 120_000 })

    await page.locator('.export-menu-wrap > button').click()
    await page.getByRole('button', { name: 'PDF 美术版（深色）' }).click()
    await page.locator('.toast.success', { hasText: 'PDF 美术版（深色）已导出' }).waitFor({ timeout: 120_000 })

    await page.locator('.export-menu-wrap > button').click()
    const animaticMenu = page.locator('.export-menu-section')
    const animaticMenuText = await animaticMenu.innerText()
    for (const text of ['淡入淡出', '烧录镜头编号', '烧录参考标题', '临时音轨波形校验']) {
      assert(animaticMenuText.includes(text), `MP4 export option missing: ${text}`)
    }
    await animaticMenu.getByLabel('淡入淡出').check()
    await animaticMenu.getByLabel('烧录镜头编号').check()
    await animaticMenu.getByLabel('临时音轨波形校验').check()
    await page.getByRole('button', { name: '导出动态分镜 MP4' }).click()
    await page.locator('.toast.success', { hasText: '临时音轨波形已校验' }).waitFor({ timeout: 180_000 })

    await page.locator('.export-menu-wrap > button').click()
    await page.getByRole('button', { name: zh('\\u955c\\u5934\\u6e05\\u5355 CSV') }).click()
    await page.locator('.toast.success', { hasText: zh('\\u955c\\u5934\\u6e05\\u5355 CSV \\u5df2\\u5bfc\\u51fa') }).waitFor({ timeout: 60_000 })

    await page.getByRole('button', { name: zh('\\u5bfc\\u51fa\\u53c2\\u8003\\u5305') }).click()
    await page.locator('.toast.success', { hasText: zh('\\u53c2\\u8003\\u5305\\u5df2\\u5bfc\\u51fa') }).waitFor({ timeout: 60_000 })
    await page.screenshot({ path: join(outputDir, 'tauri-release-03-after-exports.png'), fullPage: true })

    const exportsRoot = join(before.folder, 'exports')
    const pdfPaths = allMatching(exportsRoot, (entry) => entry.isFile() && entry.name.endsWith('.pdf'))
    const pdfPath = pdfPaths[0]
    const mp4Path = latestMatching(exportsRoot, (entry) => entry.isFile() && entry.name.endsWith('.mp4'))
    const waveformPath = latestMatching(exportsRoot, (entry) => entry.isFile() && entry.name.endsWith('-audio-waveform.png'))
    const csvPath = latestMatching(exportsRoot, (entry) => entry.isFile() && entry.name.endsWith('.csv'))
    const boardPath = latestMatching(exportsRoot, (entry) => entry.isDirectory() && entry.name.startsWith('board-'))
    assert(pdfPaths.length >= 2, `Expected at least two PDF templates, got ${pdfPaths.length}`)
    assert(pdfPaths.some((p) => p.includes('director-light')), `Director PDF missing: ${pdfPaths.join(', ')}`)
    assert(pdfPaths.some((p) => p.includes('art-dark')), `Dark art PDF missing: ${pdfPaths.join(', ')}`)
    assert(pdfPath && statSync(pdfPath).size > 100_000, `PDF export missing or too small: ${pdfPath}`)
    assert(mp4Path && statSync(mp4Path).size > 100_000, `MP4 export missing or too small: ${mp4Path}`)
    assert(waveformPath && statSync(waveformPath).size > 1_000, `Audio waveform missing or too small: ${waveformPath}`)
    const waveformBytes = readFileSync(waveformPath)
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    assert(waveformBytes.subarray(0, 8).equals(pngMagic), `Audio waveform is not a PNG: ${waveformPath}`)
    assert(csvPath && statSync(csvPath).size > 1_000, `CSV export missing or too small: ${csvPath}`)
    assert(boardPath && existsSync(join(boardPath, 'prompts.json')), `Board export missing prompts.json: ${boardPath}`)

    const probeJson = JSON.parse(execFileSync(toolStatus.ffprobePath, [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', mp4Path
    ]).toString())
    const videoStream = probeJson.streams.find((stream) => stream.codec_type === 'video')
    const audioStream = probeJson.streams.find((stream) => stream.codec_type === 'audio')
    assert(videoStream?.width === 1920, `MP4 width mismatch: ${videoStream?.width}`)
    assert(videoStream?.height === 1080, `MP4 height mismatch: ${videoStream?.height}`)
    assert(audioStream, 'MP4 audio stream missing after scratch-track mux')

    console.log(JSON.stringify({
      ok: true,
      exePath,
      cdpUrl,
      mediaTools: toolStatus,
      project: before,
      exports: { pdfPaths, pdfPath, pdfBytes: statSync(pdfPath).size, mp4Path, mp4Bytes: statSync(mp4Path).size, waveformPath, waveformBytes: statSync(waveformPath).size, csvPath, boardPath },
      screenshots: outputDir
    }, null, 2))
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (!child.killed) child.kill()
    await new Promise((resolveExit) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolveExit()
      const timer = setTimeout(resolveExit, 3000)
      child.once('exit', () => { clearTimeout(timer); resolveExit() })
    })
    if (stderr.trim()) console.error(stderr.trim())
  }
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
