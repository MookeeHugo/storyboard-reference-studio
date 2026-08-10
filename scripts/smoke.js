import { createServer } from 'node:net'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputDir = join(root, 'output', 'playwright')

function findFreePort(startPort) {
  return new Promise((resolvePort) => {
    const tryPort = (port) => {
      const server = createServer()
      server.once('error', () => tryPort(port + 1))
      server.once('listening', () => {
        server.close(() => resolvePort(port))
      })
      server.listen(port, '127.0.0.1')
    }
    tryPort(startPort)
  })
}

function waitForUrl(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolveWait, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url)
        if (res.ok) {
          resolveWait()
          return
        }
      } catch {
        // Dev server is still starting.
      }
      if (Date.now() > deadline) {
        reject(new Error(`前端服务启动超时：${url}`))
        return
      }
      setTimeout(tick, 500)
    }
    tick()
  })
}

async function launchBrowser(chromium) {
  try {
    return await chromium.launch({ channel: 'msedge', headless: true })
  } catch {
    return await chromium.launch({ headless: true })
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  mkdirSync(outputDir, { recursive: true })
  const port = Number(process.env.SBR_SMOKE_PORT || await findFreePort(5173))
  const url = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    VITE_PORT: String(port),
    SBR_SMOKE: '1'
  }

  const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  const serverCommand = {
    cmd: process.execPath,
    args: [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort']
  }
  const server = spawn(serverCommand.cmd, serverCommand.args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })

  let serverLog = ''
  server.stdout.on('data', (chunk) => {
    serverLog += chunk.toString()
  })
  server.stderr.on('data', (chunk) => {
    serverLog += chunk.toString()
  })

  let browser
  try {
    await waitForUrl(url)
    const { chromium } = await import('playwright')
    browser = await launchBrowser(chromium)
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, locale: 'zh-CN' })

    await page.goto(url, { waitUntil: 'networkidle' })
    await page.screenshot({ path: join(outputDir, '01-welcome.png'), fullPage: true })

    const htmlLang = await page.locator('html').getAttribute('lang')
    const title = await page.title()
    assert(htmlLang === 'zh-CN', `默认语言不是 zh-CN：${htmlLang}`)
    assert(title.includes('分镜参考工作室'), `页面标题未中文化：${title}`)
    await page.getByRole('button', { name: /加载雨夜灯塔 Demo/ }).click()

    await page.locator('.workspace').waitFor({ state: 'visible' })
    await page.locator('.board-card').first().waitFor({ state: 'visible' })
    await page.screenshot({ path: join(outputDir, '02-demo-board.png'), fullPage: true })

    const cardCount = await page.locator('.board-card').count()
    const chipCount = await page.locator('.filter-chip').count()
    assert(cardCount >= 10, `参考卡片数量不足：${cardCount}`)
    assert(chipCount >= 12, `筛选标签数量不足：${chipCount}`)

    const bodyText = await page.locator('body').innerText()
    for (const text of [
      '雨夜灯塔视觉参考板',
      '外景沿海公路',
      '皮卡车内',
      '灯塔楼梯井',
      '开阔海面',
      '参考拆解',
      'AI 提示词',
      '导出参考包',
      '补全提示词'
    ]) {
      assert(bodyText.includes(text), `缺少关键中文文本：${text}`)
    }

    const detailRows = await page.locator('.reference-grid dt').count()
    const detailTags = await page.locator('.reference-tags span').count()
    assert(detailRows >= 9, `详情面板字段不足：${detailRows}`)
    assert(detailTags >= 6, `详情标签不足：${detailTags}`)
    await page.screenshot({ path: join(outputDir, '03-detail-panel.png'), fullPage: true })

    await page.locator('.board-search').fill('灯室')
    await page.waitForTimeout(250)
    const filteredCount = await page.locator('.board-card').count()
    assert(filteredCount >= 2 && filteredCount < cardCount, `检索筛选未生效：${filteredCount}/${cardCount}`)
    await page.screenshot({ path: join(outputDir, '04-filter-lighthouse-room.png'), fullPage: true })

    console.log(JSON.stringify({
      ok: true,
      url,
      screenshots: outputDir,
      cardCount,
      filterChipCount: chipCount,
      detailRows,
      detailTags,
      filteredCount
    }, null, 2))
  } finally {
    if (browser) await browser.close()
    if (!server.killed) server.kill()
    await new Promise((resolveExit) => {
      if (server.exitCode !== null || server.signalCode !== null) {
        resolveExit()
        return
      }
      const timeout = setTimeout(resolveExit, 2000)
      server.once('exit', () => {
        clearTimeout(timeout)
        resolveExit()
      })
    })
    if (server.exitCode && server.exitCode !== 0) {
      console.error(serverLog)
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
