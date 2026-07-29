/**
 * Stage the latest DTH Character Studio Runner release (the studio's own Daz
 * Studio plugin — github.com/polynaut/dth-character-studio-runner) as Tauri
 * bundle resources, so the installer ships the plugin self-contained:
 *
 *   apps/desktop/resources/dth-runner/
 *     version.txt                           ← the release tag (e.g. "1.0.0")
 *     ds4/dthcharacterstudiorunner.dll      ← Daz Studio 4.x build
 *     ds6/dsp_dthcharacterstudiorunner.dll  ← Daz Studio 6 build (DS6 only
 *                                             loads plugins named dsp_*.dll)
 *
 * Wired into tauri.conf.json's beforeBuildCommand, so a local
 * `pnpm build:desktop` and the Release workflow (tauri-action) both run it;
 * `pnpm fetch:runner` runs it by hand (needed once for `pnpm dev:desktop` to
 * offer the Runner install in dev). Skips the download when version.txt
 * already matches the latest tag. Only the DLLs are staged (the release zips
 * also carry .pdb crash symbols — dead weight in an installer).
 *
 * Zip extraction shells out to `tar -xf` (bsdtar reads zip archives — present
 * on Windows 10+ and macOS, the two platforms the desktop app builds on).
 * Uses GITHUB_TOKEN when present (CI API rate limits).
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'polynaut/dth-character-studio-runner'
const FLAVORS = ['ds4', 'ds6']

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const destDir = join(root, 'apps', 'desktop', 'resources', 'dth-runner')
const versionFile = join(destDir, 'version.txt')

const headers = {
  'user-agent': 'dth-character-studio-build',
  accept: 'application/vnd.github+json',
}
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`

const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers })
if (!res.ok) throw new Error(`GitHub API ${res.status} fetching the latest ${REPO} release`)
const release = await res.json()
const version = String(release.tag_name ?? '').replace(/^v/, '')
if (!version) throw new Error(`Latest ${REPO} release has no tag`)

const staged = (flavor) => {
  const dir = join(destDir, flavor)
  return existsSync(dir) && readdirSync(dir).some((name) => name.toLowerCase().endsWith('.dll'))
}
if (
  existsSync(versionFile) &&
  readFileSync(versionFile, 'utf8').trim() === version &&
  FLAVORS.every(staged)
) {
  console.log(`dth-runner ${version} already staged — skipping download`)
  process.exit(0)
}

const tmp = mkdtempSync(join(tmpdir(), 'dth-runner-'))
try {
  for (const flavor of FLAVORS) {
    const asset = (release.assets ?? []).find((a) => a.name.endsWith(`-${flavor}.zip`))
    if (!asset) throw new Error(`Release v${version} has no -${flavor}.zip asset`)
    const zipPath = join(tmp, asset.name)
    const download = await fetch(asset.browser_download_url, {
      headers: { 'user-agent': headers['user-agent'] },
    })
    if (!download.ok) throw new Error(`Downloading ${asset.name}: HTTP ${download.status}`)
    writeFileSync(zipPath, Buffer.from(await download.arrayBuffer()))

    const extractDir = join(tmp, flavor)
    mkdirSync(extractDir, { recursive: true })
    execFileSync('tar', ['-xf', zipPath, '-C', extractDir])

    const dlls = readdirSync(extractDir, { recursive: true })
      .map(String)
      .filter((rel) => rel.toLowerCase().endsWith('.dll'))
    if (dlls.length === 0) throw new Error(`${asset.name} contains no .dll`)

    const outDir = join(destDir, flavor)
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(outDir, { recursive: true })
    for (const rel of dlls) cpSync(join(extractDir, rel), join(outDir, basename(rel)))
    console.log(`staged ${flavor}: ${dlls.map((rel) => basename(rel)).join(', ')}`)
  }
  writeFileSync(versionFile, `${version}\n`)
  console.log(`dth-runner ${version} staged into apps/desktop/resources/dth-runner`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
