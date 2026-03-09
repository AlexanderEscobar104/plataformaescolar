const fs = require('fs')
const path = require('path')

const DASHBOARD_DIR = path.join(__dirname, 'src', 'pages', 'dashboard')

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  
  // Find all function declarations: `function name(` or `const name = (`
  // We want to see if a lowercase function contains the hook.
  
  const functionBlocks = []
  
  // Very simplistic parsing by splitting on `function `
  const parts = content.split('function ')
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    const nameMatch = part.match(/^([a-zA-Z0-9_]+)\s*\(/)
    if (nameMatch) {
      const funcName = nameMatch[1]
      // Check if it's a lowercase function (helper)
      if (funcName[0] === funcName[0].toLowerCase() && funcName[0] !== funcName[0].toUpperCase()) {
        // Find if this block up to the next function contains the hook
        if (part.includes('const [currentPage')) {
          console.log(`[MISPLACED HOOK FOUND] File: ${path.basename(filePath)} -> Function: ${funcName}`)
        }
      }
    }
  }

  // Also check if exportExcelButton data mapping is broken.
  // E.g., data={GRADE_OPTIONS} or data={[]} instead of data={filteredArray} or data={rows}
  const exportMatch = content.match(/<ExportExcelButton[^>]+data=\{([^}]+)\}/)
  if (exportMatch) {
    const dataVar = exportMatch[1]
    // If it's a known constant or empty array
    if (dataVar === '[]' || dataVar === 'GRADE_OPTIONS' || dataVar === 'GROUP_OPTIONS') {
      console.log(`[BAD EXPORT DATA] File: ${path.basename(filePath)} -> data={${dataVar}}`)
    }
  }
}

function scanDir(dir) {
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const fullPath = path.join(dir, file)
    if (fs.statSync(fullPath).isDirectory()) {
      scanDir(fullPath)
    } else if (file.endsWith('.jsx')) {
      checkFile(fullPath)
    }
  }
}

console.log('Starting audit...')
scanDir(DASHBOARD_DIR)
console.log('Audit complete.')
