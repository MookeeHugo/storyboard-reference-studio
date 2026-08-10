import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { chmod } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outDir = join(root, 'src-tauri', 'bin')
const isWindows = process.platform === 'win32'

function copyTool(name, sourcePath) {
  if (!sourcePath || typeof sourcePath !== 'string') {
    throw new Error(`${name} package did not expose a binary path`)
  }
  const dest = join(outDir, isWindows ? `${name}.exe` : name)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(sourcePath, dest)
  if (!isWindows) awaitableChmod(dest)
  const size = statSync(dest).size
  if (size < 100_000) throw new Error(`${name} sidecar looks too small: ${dest}`)
  return { name, sourcePath, dest, size }
}

function awaitableChmod(path) {
  chmod(path, 0o755).catch(() => {})
}

const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path
const copied = [copyTool('ffmpeg', ffmpegPath), copyTool('ffprobe', ffprobePath)]
console.log(JSON.stringify({ ok: true, outDir, copied }, null, 2))
