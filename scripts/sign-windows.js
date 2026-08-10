import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const releaseDir = join(root, 'src-tauri', 'target', 'release')
const outputDir = join(root, 'output', 'signing')
const timestampUrl = process.env.WINDOWS_TIMESTAMP_URL || 'http://timestamp.digicert.com'
const publisherName = process.env.WINDOWS_PUBLISHER_NAME || 'BloomReel Team'
const signingRequired = /^(1|true|yes)$/i.test(process.env.WINDOWS_SIGNING_REQUIRED || '')

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function findFiles(dir, predicate) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findFiles(path, predicate))
    else if (predicate(path)) out.push(path)
  }
  return out
}

function defaultTargets() {
  const targets = [
    join(releaseDir, 'storyboard-reference-studio.exe'),
    ...findFiles(join(releaseDir, 'bundle'), (path) => /\.(exe|msi)$/i.test(path))
  ]
  return Array.from(new Set(targets)).filter((path) => existsSync(path))
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function artifactInfo(file) {
  const stat = statSync(file)
  return {
    file,
    bytes: stat.size,
    modified: stat.mtime.toISOString(),
    sha256: sha256(file)
  }
}

function findSigntool() {
  if (process.env.WINDOWS_SIGNTOOL_PATH && existsSync(process.env.WINDOWS_SIGNTOOL_PATH)) {
    return process.env.WINDOWS_SIGNTOOL_PATH
  }
  const kitsRoots = [
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Windows Kits', '10', 'bin'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Windows Kits', '10', 'bin')
  ].filter(Boolean)
  const matches = []
  for (const kitsRoot of kitsRoots) {
    if (!existsSync(kitsRoot)) continue
    for (const version of readdirSync(kitsRoot)) {
      const candidate = join(kitsRoot, version, 'x64', 'signtool.exe')
      if (existsSync(candidate)) matches.push(candidate)
    }
  }
  matches.sort()
  return matches.at(-1) || null
}

function writePfxFromSecret() {
  const b64 = process.env.WINDOWS_SIGNING_CERTIFICATE_BASE64
  if (!b64) return null
  mkdirSync(outputDir, { recursive: true })
  const pfx = join(outputDir, 'windows-signing.pfx')
  writeFileSync(pfx, Buffer.from(b64, 'base64'))
  return pfx
}

function signingArgs(file, pfxPath) {
  const args = ['sign', '/fd', 'sha256', '/tr', timestampUrl, '/td', 'sha256']
  if (process.env.WINDOWS_SIGNING_CERT_THUMBPRINT) {
    args.push('/sha1', process.env.WINDOWS_SIGNING_CERT_THUMBPRINT)
  } else if (pfxPath || process.env.WINDOWS_PFX_PATH) {
    args.push('/f', pfxPath || process.env.WINDOWS_PFX_PATH)
    if (process.env.WINDOWS_SIGNING_CERTIFICATE_PASSWORD) {
      args.push('/p', process.env.WINDOWS_SIGNING_CERTIFICATE_PASSWORD)
    }
  } else {
    return null
  }
  args.push(file)
  return args
}

function certificateMode(pfxPath) {
  if (process.env.WINDOWS_SIGNING_CERT_THUMBPRINT) return 'certificate-store-thumbprint'
  if (pfxPath) return 'pfx-from-ci-secret'
  if (process.env.WINDOWS_PFX_PATH) return 'pfx-path'
  return 'not-configured'
}

function smartscreenPolicy() {
  return {
    publisherName,
    timestampUrl,
    digestAlgorithm: 'sha256',
    recommendations: [
      'Use the same OV or EV code-signing certificate across releases to build publisher reputation.',
      'Timestamp every signed exe, msi, and nsis installer so signatures survive certificate renewal.',
      'Publish signed installers from one consistent GitHub release channel and avoid re-uploading unsigned rebuilds.',
      'Keep the Tauri identifier and product name stable: studio.storyboard.reference / Storyboard Reference Studio.'
    ]
  }
}

function verify(file) {
  if (process.platform !== 'win32') return { status: 'skipped', reason: 'non-windows host' }
  const ps = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath ${JSON.stringify(file)}).Status`],
    { encoding: 'utf8' }
  )
  return {
    status: ps.status === 0 ? ps.stdout.trim() : 'UnknownError',
    stderr: ps.stderr.trim()
  }
}

function signOne(signtool, file, pfxPath) {
  const args = signingArgs(file, pfxPath)
  if (!args) {
    return {
      ...artifactInfo(file),
      ok: !signingRequired,
      skipped: true,
      reason: 'missing signing certificate configuration'
    }
  }
  const before = statSync(file).mtimeMs
  const res = spawnSync(signtool, args, { encoding: 'utf8' })
  const after = existsSync(file) ? statSync(file).mtimeMs : before
  return {
    ...artifactInfo(file),
    ok: res.status === 0,
    skipped: false,
    signtool,
    changed: after !== before,
    stdout: res.stdout.trim(),
    stderr: res.stderr.trim(),
    signature: verify(file)
  }
}

function main() {
  const singleFile = argValue('--file')
  const isTauriHook = hasFlag('--tauri')
  const targets = singleFile ? [resolve(singleFile)] : defaultTargets()
  mkdirSync(outputDir, { recursive: true })

  if (targets.length === 0) {
    const result = {
      ok: !signingRequired,
      skipped: true,
      reason: 'no windows artifacts found',
      signingRequired,
      timestampUrl,
      certificateMode: certificateMode(null),
      smartscreen: smartscreenPolicy(),
      targets: []
    }
    writeFileSync(join(outputDir, 'windows-signing-manifest.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exit(1)
    return
  }

  const signtool = findSigntool()
  if (!signtool) {
    const result = {
      ok: !signingRequired,
      skipped: true,
      reason: 'signtool.exe not found on this host',
      signingRequired,
      timestampUrl,
      certificateMode: certificateMode(null),
      smartscreen: smartscreenPolicy(),
      targets: targets.map(artifactInfo)
    }
    if (!isTauriHook) writeFileSync(join(outputDir, 'windows-signing-manifest.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exit(1)
    return
  }

  const pfxFromSecret = writePfxFromSecret()
  try {
    const results = targets.map((target) => signOne(signtool, target, pfxFromSecret))
    const ok = results.every((item) => item.ok)
    const result = {
      ok,
      skipped: results.every((item) => item.skipped),
      signingRequired,
      timestampUrl,
      certificateMode: certificateMode(pfxFromSecret),
      smartscreen: smartscreenPolicy(),
      results
    }
    if (!isTauriHook) writeFileSync(join(outputDir, 'windows-signing-manifest.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    if (!ok) process.exit(1)
  } finally {
    if (pfxFromSecret) rmSync(pfxFromSecret, { force: true })
  }
}

main()
