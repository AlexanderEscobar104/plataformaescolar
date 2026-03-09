const fs = require('fs')
const path = require('path')

const basePath = path.join(__dirname, 'src', 'pages', 'dashboard')
const filesToPatch = fs.readdirSync(basePath).filter(file => file.endsWith('.jsx'))

for (const fileName of filesToPatch) {
  const filePath = path.join(basePath, fileName)
  let code = fs.readFileSync(filePath, 'utf-8')

  // We are looking for the exact pattern the previous script created which caused invalid JSX twins
  // Pattern:
  // </table>
  //   </div>
  //   <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
  //     <ExportExcelButton ... />
  //   </div>

  // We need to move the <div style=...> *before* the closing `</div>`

  const regex = /<\/table>\s*<\/div>\s*<div style=\{\{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' \}\}>\s*<ExportExcelButton data=\{[^}]*\} filename="[^"]*"\s*\/>\s*<\/div>/g

  if (regex.test(code)) {
    code = code.replace(regex, (match) => {
      // Find the closing div of the table wrapper and swap it
      return match.replace(/<\/table>\s*<\/div>/, '</table>').concat('\n        </div>')
    })
    fs.writeFileSync(filePath, code, 'utf-8')
    console.log(`Fixed JSX siblings in: ${fileName}`)
  } else {
      // Try a looser regex
      const looseRegex = /<\/div>\s*<div style=\{\{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' \}\}>\s*<ExportExcelButton/g
      if(looseRegex.test(code)){
        console.log(`Needs manual intervention or loose fix: ${fileName}`)
      }
  }
}
