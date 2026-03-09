/**
 * fix_duplicate_imports.cjs
 * Merges duplicate firestoreProxy import lines into a single import in all dashboard pages.
 */
const fs = require('fs')
const path = require('path')

const DASHBOARD_DIR = path.join(__dirname, 'src', 'pages', 'dashboard')

const files = fs.readdirSync(DASHBOARD_DIR).filter(f => f.endsWith('.jsx') || f.endsWith('.js'))

let changed = 0

for (const filename of files) {
  const filepath = path.join(DASHBOARD_DIR, filename)
  let content = fs.readFileSync(filepath, 'utf8')
  const original = content

  // Find all firestoreProxy import lines
  const proxyImportRegex = /import \{([^}]*)\} from '\.\.\/\.\.\/services\/firestoreProxy'/g
  const matches = []
  let match
  while ((match = proxyImportRegex.exec(content)) !== null) {
    matches.push({ full: match[0], symbols: match[1].split(',').map(s => s.trim()).filter(Boolean) })
  }

  if (matches.length <= 1) continue // No duplicates

  // Collect all unique symbols across all proxy imports
  const allSymbols = [...new Set(matches.flatMap(m => m.symbols))]
  const mergedImport = `import { ${allSymbols.join(', ')} } from '../../services/firestoreProxy'`

  // Remove all existing proxy imports and replace with merged
  let firstMatch = true
  content = content.replace(/import \{[^}]*\} from '\.\.\/\.\.\/services\/firestoreProxy'\n?/g, () => {
    if (firstMatch) {
      firstMatch = false
      return mergedImport + '\n'
    }
    return '' // Remove subsequent duplicates
  })

  if (content !== original) {
    fs.writeFileSync(filepath, content, 'utf8')
    console.log(`[FIXED] ${filename}`)
    changed++
  }
}

console.log(`\nDone. ${changed} files fixed.`)
