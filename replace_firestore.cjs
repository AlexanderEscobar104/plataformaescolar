const fs = require('fs')
const path = require('path')

const basePath = path.join(__dirname, 'src', 'pages', 'dashboard')

// All files inside src/pages/dashboard
const filesToPatch = fs.readdirSync(basePath).filter(file => file.endsWith('.jsx'))

for (const fileName of filesToPatch) {
  const filePath = path.join(basePath, fileName)
  let code = fs.readFileSync(filePath, 'utf-8')

  let modified = false

  // Step 1: Analyze import { ..., updateDoc, setDoc, ... } from 'firebase/firestore'
  const importRegex = /import \{([^}]+)\} from 'firebase\/firestore'/
  let importMatch = code.match(importRegex)
  
  if (importMatch) {
    let imports = importMatch[1].split(',').map(s => s.trim()).filter(s => s !== '')
    let hasUpdateDoc = imports.includes('updateDoc')
    let hasSetDoc = imports.includes('setDoc')
    let hasAddDoc = imports.includes('addDoc')

    if (hasUpdateDoc || hasSetDoc || hasAddDoc) {
      modified = true
      
      // Remove them from firebase/firestore
      imports = imports.filter(s => s !== 'updateDoc' && s !== 'setDoc' && s !== 'addDoc')
      if (imports.length > 0) {
        code = code.replace(importMatch[0], `import { ${imports.join(', ')} } from 'firebase/firestore'`)
      } else {
        code = code.replace(importMatch[0] + '\n', '')
      }

      // Add the proxy imports
      let addedImports = []
      if (hasUpdateDoc) addedImports.push('updateDocTracked')
      if (hasSetDoc) addedImports.push('setDocTracked')
      if (hasAddDoc) addedImports.push('addDocTracked')

      // Find the firebase import to inject right below it
      const firebaseImportRegex = /import \{.+?\} from '\.\.\/\.\.\/firebase'/
      if (firebaseImportRegex.test(code)) {
        code = code.replace(
          firebaseImportRegex,
          match => `${match}\nimport { ${addedImports.join(', ')} } from '../../services/firestoreProxy'`
        )
      } else {
        code = `import { ${addedImports.join(', ')} } from '../../services/firestoreProxy'\n` + code
      }
      
      // Step 2: Replace occurrences
      if (hasUpdateDoc) {
        code = code.replace(/updateDoc\(/g, 'updateDocTracked(')
      }
      if (hasSetDoc) {
        code = code.replace(/setDoc\(/g, 'setDocTracked(')
      }
      if (hasAddDoc) {
        code = code.replace(/addDoc\(/g, 'addDocTracked(')
      }
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, code, 'utf-8')
    console.log(`Patched: ${fileName}`)
  }
}
