const fs = require('fs')
const path = require('path')

const basePath = path.join(__dirname, 'src', 'pages', 'dashboard')
const filesToPatch = fs.readdirSync(basePath).filter(file => file.endsWith('.jsx'))

for (const fileName of filesToPatch) {
  const filePath = path.join(basePath, fileName)
  let code = fs.readFileSync(filePath, 'utf-8')

  if (code.includes('<ExportExcelButton data={[]}')) {
    // Attempt to guess the mapped array name
    // Usually looks like: filteredTasks.map((task) => ( ... ))
    // or filteredUsers.map((user) =>
    
    // Regex matches: "arrayName.map" or "arrayName?.map"
    // Usually right after <tbody> or a conditional like "loading ? ... : ("
    
    // In our codebase, the typical pattern is: something.map((item) => ...
    const mapRegex = /([a-zA-Z0-9_]+)(?:\?)?\.map\(/
    const mapMatch = code.match(mapRegex)
    
    let arrayName = '[]'
    
    if (mapMatch && mapMatch[1]) {
      arrayName = mapMatch[1]
      // Exclude common false positives like "Object.keys(row).map"
      if (['Array', 'Object', 'Promise', 'gradeOptions', 'groupOptions'].includes(arrayName)) {
        // try to find next map match
        const allMatches = [...code.matchAll(/([a-zA-Z0-9_]+)(?:\?)?\.map\(/g)]
        const betterMatch = allMatches.find(m => !['Array', 'Object'].includes(m[1]) && m[1].toLowerCase().includes('filter')) 
          || allMatches.find(m => !['Array', 'Object', 'Promise', 'gradeOptions', 'groupOptions'].includes(m[1]))
        if (betterMatch) arrayName = betterMatch[1]
      }
    }

    // Now replace the inject call
    code = code.replace(
      `<ExportExcelButton data={[]} filename="${fileName.replace('.jsx', '')}" />`,
      `<ExportExcelButton data={${arrayName}} filename="${fileName.replace('.jsx', '')}" />`
    )
    
    fs.writeFileSync(filePath, code, 'utf-8')
    console.log(`Replaced data array in ${fileName} with: ${arrayName}`)
  }
}
