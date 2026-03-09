/**
 * replace_delete_doc.cjs
 * Replaces deleteDoc() calls with deleteDocTracked() in all dashboard pages
 * and updates their imports accordingly.
 */
const fs = require('fs')
const path = require('path')

const DASHBOARD_DIR = path.join(__dirname, 'src', 'pages', 'dashboard')

const FILES = [
  'TasksPage.jsx',
  'SubjectsPage.jsx',
  'StudentsListPage.jsx',
  'StoragePage.jsx',
  'ServiciosComplementariosPage.jsx',
  'RolesPage.jsx',
  'ProfessorsListPage.jsx',
  'NotificationsPage.jsx',
  'MessagesPage.jsx',
  'EventsPage.jsx',
  'EvaluationsPage.jsx',
  'EmpleadosPage.jsx',
  'DirectivosListPage.jsx',
  'CircularsPage.jsx',
  'AspirantesListPage.jsx',
]

let changed = 0
let skipped = 0

for (const filename of FILES) {
  const filepath = path.join(DASHBOARD_DIR, filename)
  if (!fs.existsSync(filepath)) {
    console.log(`[SKIP] ${filename} — file not found`)
    skipped++
    continue
  }

  let content = fs.readFileSync(filepath, 'utf8')
  const original = content

  // Replace usage: await deleteDoc(  →  await deleteDocTracked(
  content = content.replace(/\bdeleteDoc\(/g, 'deleteDocTracked(')

  // Fix import: remove deleteDoc from firestore import
  content = content.replace(
    /import \{([^}]*)\} from 'firebase\/firestore'/g,
    (match, group) => {
      const items = group.split(',').map(s => s.trim()).filter(s => s && s !== 'deleteDoc')
      return `import { ${items.join(', ')} } from 'firebase/firestore'`
    }
  )

  // Add deleteDocTracked to the firestoreProxy import
  content = content.replace(
    /import \{([^}]*)\} from '\.\.\/\.\.\/services\/firestoreProxy'/g,
    (match, group) => {
      const items = group.split(',').map(s => s.trim()).filter(Boolean)
      if (!items.includes('deleteDocTracked')) {
        items.push('deleteDocTracked')
      }
      return `import { ${items.join(', ')} } from '../../services/firestoreProxy'`
    }
  )

  // If the file doesn't import from firestoreProxy at all, add the import
  if (!content.includes("from '../../services/firestoreProxy'")) {
    const firstImport = content.indexOf('import ')
    const endOfImports = content.lastIndexOf('\nimport ') + 1
    const insertPos = endOfImports > 0 ? content.indexOf('\n', endOfImports) + 1 : firstImport
    content = content.slice(0, insertPos) +
      "import { deleteDocTracked } from '../../services/firestoreProxy'\n" +
      content.slice(insertPos)
  }

  if (content !== original) {
    fs.writeFileSync(filepath, content, 'utf8')
    console.log(`[OK] ${filename}`)
    changed++
  } else {
    console.log(`[UNCHANGED] ${filename}`)
    skipped++
  }
}

console.log(`\nDone. ${changed} files updated, ${skipped} skipped.`)
