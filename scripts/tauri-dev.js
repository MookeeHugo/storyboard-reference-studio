import { createServer } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

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

const port = Number(process.env.VITE_PORT || process.env.SBR_TAURI_DEV_PORT || await findFreePort(5173))
const devUrl = `http://127.0.0.1:${port}`
const beforeDevCommand = `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`
const outputDir = join(root, 'output')
const configPath = join(outputDir, 'tauri-dev-config.json')
mkdirSync(outputDir, { recursive: true })
writeFileSync(configPath, JSON.stringify({ build: { devUrl, beforeDevCommand } }, null, 2))

console.log(`Tauri dev 使用前端地址：${devUrl}`)

const childCommand =
  process.platform === 'win32'
    ? { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `npx tauri dev --config "${configPath}"`] }
    : { cmd: 'npx', args: ['tauri', 'dev', '--config', configPath] }

const child = spawn(childCommand.cmd, childCommand.args, {
  cwd: root,
  env: { ...process.env, VITE_PORT: String(port) },
  stdio: 'inherit'
})

child.on('exit', (code) => process.exit(code ?? 0))
