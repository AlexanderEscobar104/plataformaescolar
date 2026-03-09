const fs = require('fs')
const path = require('path')

const filesToPatch = [
  'TasksPage.jsx',
  'TaskFollowUpPage.jsx',
  'StudentEditPage.jsx',
  'RoleRegistrationPage.jsx',
  'ProfessorEditPage.jsx',
  'EvaluationGradingPage.jsx',
  'EvaluationsPage.jsx',
  'MessagesPage.jsx',
  'CircularsPage.jsx',
  'PlantelDataPage.jsx',
  'EventsPage.jsx',
  'AspiranteRegistrationPage.jsx',
  'DirectivoEditPage.jsx',
  'AspiranteEditPage.jsx'
]

const basePath = path.join(__dirname, 'src', 'pages', 'dashboard')

for (const fileName of filesToPatch) {
  const filePath = path.join(basePath, fileName)
  if (!fs.existsSync(filePath)) {
    console.log(`File missing: ${filePath}`)
    continue
  }

  let code = fs.readFileSync(filePath, 'utf-8')

  // Step 1: Remove uploadBytes from firebase/storage import
  let importMatch = code.match(/import \{([^}]+)\} from 'firebase\/storage'/)
  if (importMatch) {
    let imports = importMatch[1].split(',').map(s => s.trim()).filter(s => s !== 'uploadBytes' && s !== '')
    if (imports.length > 0) {
      code = code.replace(importMatch[0], `import { ${imports.join(', ')} } from 'firebase/storage'`)
    } else {
      code = code.replace(importMatch[0], '')
    }
  }

  // Add the new import just below it, or near the top
  if (!code.includes('uploadBytesTracked')) {
    // find firebase import to inject below it
    code = code.replace(
      /import \{.+?\} from '\.\.\/\.\.\/firebase'/,
      match => `${match}\nimport { uploadBytesTracked } from '../../services/storageService'`
    )

    // fallback if no exact firebase match
    if (!code.includes('uploadBytesTracked')) {
      code = `import { uploadBytesTracked } from '../../services/storageService'\n` + code
    }
  }

  // Step 2: replace all calls
  code = code.replace(/uploadBytes\(/g, 'uploadBytesTracked(')

  fs.writeFileSync(filePath, code, 'utf-8')
  console.log(`Patched: ${fileName}`)
}
