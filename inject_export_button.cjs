const fs = require('fs')
const path = require('path')

const basePath = path.join(__dirname, 'src', 'pages', 'dashboard')
const filesToPatch = fs.readdirSync(basePath).filter(file => file.endsWith('.jsx'))

for (const fileName of filesToPatch) {
  const filePath = path.join(basePath, fileName)
  let code = fs.readFileSync(filePath, 'utf-8')

  // Only patch files that have a students-table or table
  if (code.includes('className="students-table"') || code.includes('className="table"')) {
    let modified = false

    // 1. Add import if not present
    if (!code.includes('ExportExcelButton')) {
      const importStatement = `import ExportExcelButton from '../../components/ExportExcelButton'\n`
      // Try to put it after other imports
      const lastImportIndex = code.lastIndexOf('import ')
      if (lastImportIndex !== -1) {
        const endOfLastImport = code.indexOf('\n', lastImportIndex)
        code = code.slice(0, endOfLastImport + 1) + importStatement + code.slice(endOfLastImport + 1)
      } else {
        code = importStatement + code
      }
      modified = true
    }

    // 2. Find the toolbar or search bar to inject the button
    // It's usually <div className="students-toolbar"> or <div className="search-bar">
    const toolbars = ['className="students-toolbar"', 'className="search-bar"']
    for (const toolbar of toolbars) {
      if (code.includes(toolbar) && !code.includes('<ExportExcelButton')) {
        // We will inject it inside the toolbar div, right after the opening tag
        code = code.replace(
          new RegExp(`(<div[^>]*?${toolbar}[^>]*?>)`),
          `$1\n        <ExportExcelButton data={[]} filename="${fileName.replace('.jsx', '')}" />`
        )
        modified = true
        break
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, code, 'utf-8')
      console.log(`Injected ExportExcelButton into: ${fileName}`)
    }
  }
}
