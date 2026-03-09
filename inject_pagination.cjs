const fs = require('fs')
const path = require('path')

const basePath = path.join(__dirname, 'src', 'pages', 'dashboard')
const filesToPatch = fs.readdirSync(basePath).filter(file => file.endsWith('.jsx'))

for (const fileName of filesToPatch) {
  const filePath = path.join(basePath, fileName)
  let code = fs.readFileSync(filePath, 'utf-8')

  // Only patch files that have an ExportExcelButton
  if (code.includes('<ExportExcelButton ')) {
    let modified = false

    // 1. Add import for PaginationControls
    if (!code.includes('PaginationControls')) {
      code = code.replace(
        `import ExportExcelButton from '../../components/ExportExcelButton'`,
        `import ExportExcelButton from '../../components/ExportExcelButton'\nimport PaginationControls from '../../components/PaginationControls'`
      )
      modified = true
    }

    // 2. We need to inject the pagination states.
    // Finding the start of the component body to inject:
    // const [currentPage, setCurrentPage] = useState(1)
    // const [exportingAll, setExportingAll] = useState(false)
    const functionStartRegex = /function\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*\{/
    if (!code.includes('const [currentPage, setCurrentPage] = useState(1)')) {
      code = code.replace(functionStartRegex, (match) => {
        return `${match}\n  const [currentPage, setCurrentPage] = useState(1)\n  const [exportingAll, setExportingAll] = useState(false)\n`
      })
      modified = true
    }
    
    // Also make sure useState is imported
    if (code.includes('from \'react\'') && !code.includes('useState')) {
        code = code.replace(/import\s*\{([^}]*)\}\s*from\s*'react'/, (match, group1) => {
            return `import { useState, ${group1.trim()} } from 'react'`
        })
    } else if (!code.includes('from \'react\'')) {
        code = `import { useState } from 'react'\n` + code
    }

    // 3. Update the ExportExcelButton to use exportingAll
    const exportBtnRegex = /<ExportExcelButton\s+data=\{([^}]+)\}\s+filename="([^"]+)"\s*\/>/
    if (exportBtnRegex.test(code)) {
      code = code.replace(exportBtnRegex, (match, dataVar, filename) => {
        return `<ExportExcelButton \n            data={${dataVar}} \n            filename="${filename}" \n            onExportStart={() => setExportingAll(true)}\n            onExportEnd={() => setExportingAll(false)}\n          />`
      })
      modified = true
    }

    // 4. Find the mapped array directly above or inside the table
    // E.g. {filteredTasks.map((t) =>
    // We want to replace `filteredTasks` with `(exportingAll ? filteredTasks : filteredTasks.slice((currentPage - 1) * 10, currentPage * 10))`
    // But safely. The best heuristic is grabbing the first Array.map((...) inside the tbody or closest to the table.
    
    // Regex for: arrayName.map
    // Exclude Object, Array keys
    const mapRegex = /\{([a-zA-Z0-9_]+)(?:\?)?\.map\(/g
    
    let targetArray = null
    const allMaps = [...code.matchAll(mapRegex)]
    for (const m of allMaps) {
      if (!['Object', 'Array'].includes(m[1])) {
        targetArray = m[1]
        break
      }
    }

    if (targetArray && !code.includes(`.slice((currentPage - 1) * 10`)) {
       // Replace ALL occurrences of `targetArray.map` or `targetArray?.map` inside JSX `{ ... }`
       // This is a bit risky but usually `targetArray` is unique to the table items
       
       const replaceTarget = new RegExp(`\\{${targetArray}(\\?\\.)?map\\(`, 'g')
       code = code.replace(replaceTarget, `{ (exportingAll ? ${targetArray} : ${targetArray}.slice((currentPage - 1) * 10, currentPage * 10))$1map(`)
       
       modified = true
    }

    // 5. Inject <PaginationControls /> right after the table wrapper closes
    // Similar to how we injected the export button
    if (targetArray && !code.includes('<PaginationControls')) {
      const paginationHtml = `\n      <PaginationControls \n        currentPage={currentPage}\n        totalItems={${targetArray}.length || 0}\n        itemsPerPage={10}\n        onPageChange={setCurrentPage}\n      />`
      
      // We know ExportExcelButton was injected after </table>...
      if (code.includes('</table>\n        </div>')) {
        code = code.replace('</table>\n        </div>', `</table>\n        </div>${paginationHtml}`)
      } else if (code.includes('</table>\n      </div>')) {
         code = code.replace('</table>\n      </div>', `</table>\n      </div>${paginationHtml}`)
      } else if (code.includes('</table>\n    </div>')) {
         code = code.replace('</table>\n    </div>', `</table>\n    </div>${paginationHtml}`)
      } else if (code.includes('</table>\n          </div>')) {
         code = code.replace('</table>\n          </div>', `</table>\n          </div>${paginationHtml}`)
      } else {
        code = code.replace('</table>', `</table>${paginationHtml}`)
      }
      modified = true
    }

    if (modified) {
      fs.writeFileSync(filePath, code, 'utf-8')
      console.log(`Injected pagination into: ${fileName}`)
    }
  }
}
