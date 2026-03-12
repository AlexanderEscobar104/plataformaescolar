import fs from 'node:fs/promises'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const sanitizeKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '-')
  .replace(/[^a-z0-9-_]/g, '')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '')

const yamlQuote = (value) => `'${String(value || '').replace(/'/g, "''")}'`

const applyPathToConfig = (rawContent, streamKey, sourceUrl) => {
  const lineBreak = rawContent.includes('\r\n') ? '\r\n' : '\n'
  const lines = rawContent.split(/\r?\n/)
  const keyPattern = new RegExp(`^ {2}${streamKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`)
  const sectionKeyPattern = /^ {2}[^\s#][^:]*:\s*$/
  const sourceValue = `    source: ${yamlQuote(sourceUrl)}`

  let pathsIndex = lines.findIndex((line) => /^paths:\s*$/.test(line))
  if (pathsIndex < 0) {
    lines.push('')
    lines.push('paths:')
    pathsIndex = lines.length - 1
  }

  const existingKeyIndex = lines.findIndex((line, index) => index > pathsIndex && keyPattern.test(line))
  if (existingKeyIndex >= 0) {
    let blockEnd = lines.length
    for (let i = existingKeyIndex + 1; i < lines.length; i += 1) {
      if (sectionKeyPattern.test(lines[i])) {
        blockEnd = i
        break
      }
    }

    const sourceIndex = lines.findIndex((line, index) => index > existingKeyIndex && index < blockEnd && /^ {4}source:\s*/.test(line))
    if (sourceIndex >= 0) {
      lines[sourceIndex] = sourceValue
    } else {
      lines.splice(existingKeyIndex + 1, 0, sourceValue)
    }
    return lines.join(lineBreak)
  }

  const allOthersIndex = lines.findIndex((line, index) => index > pathsIndex && /^ {2}all_others:\s*$/.test(line))
  const insertAt = allOthersIndex >= 0 ? allOthersIndex : lines.length
  const entryLines = [`  ${streamKey}:`, sourceValue]
  if (insertAt > 0 && lines[insertAt - 1] !== '') entryLines.unshift('')
  lines.splice(insertAt, 0, ...entryLines)

  return lines.join(lineBreak)
}

const createMediamtxLocalSyncPlugin = () => {
  const register = (server) => {
    server.middlewares.use('/__local/mediamtx/path', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, message: 'Metodo no permitido' }))
        return
      }

      try {
        let rawBody = ''
        for await (const chunk of req) {
          rawBody += chunk.toString('utf8')
        }
        const body = JSON.parse(rawBody || '{}')

        const streamKey = sanitizeKey(body?.streamKey)
        const sourceUrl = String(body?.urlCamara || '').trim()

        if (!streamKey || !sourceUrl) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, message: 'streamKey y urlCamara son obligatorios' }))
          return
        }

        const configPath = path.resolve('mediamtx', 'mediamtx.yml')
        const before = await fs.readFile(configPath, 'utf8')
        const after = applyPathToConfig(before, streamKey, sourceUrl)
        if (before !== after) {
          await fs.writeFile(configPath, after, 'utf8')
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: true, updated: before !== after, streamKey }))
      } catch (error) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, message: error?.message || 'Error actualizando mediamtx.yml' }))
      }
    })
  }

  return {
    name: 'mediamtx-local-sync',
    configureServer(server) {
      register(server)
    },
    configurePreviewServer(server) {
      register(server)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), createMediamtxLocalSyncPlugin()],
})
