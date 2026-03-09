const fs = require('fs')
const path = require('path')

const DASHBOARD_DIR = path.join(__dirname, 'src', 'pages', 'dashboard')

// Collections that hold sensitive tenant data that must be filtered explicitly
const TENANT_COLLECTIONS = [
  'users',
  'tareas',
  'tareas_entregas',
  'asignaturas',
  'servicios_complementarios',
  'horarios',
  'eventos',
  'event_respuestas',
  'evaluacion_intentos',
  'evaluaciones',
  'empleados',
  'documentos',
  'cobros',
  'cobros_pagos',
  'calificaciones',
  'archivos',
]

/**
 * Regex patterns to find specific Firestore collection calls
 */
const GETDOCS_COLLECTION_REGEX = /getDocs\(\s*collection\(\s*db\s*,\s*['"]([^'"]+)['"]\s*\)\s*\)/g
const ONSNAPSHOT_COLLECTION_REGEX = /onSnapshot\(\s*collection\(\s*db\s*,\s*['"]([^'"]+)['"]\s*\)\s*,/g
const QUERY_COLLECTION_REGEX = /(?:getDocs|onSnapshot)\(\s*query\(\s*collection\(\s*db\s*,\s*['"]([^'"]+)['"]\s*\)\s*(,[^)]+?)\)\s*(,|\))/g

function injectImports(content) {
  // We need to ensure query and where are imported from firebase/firestore
  // if they are not already.
  let modifiedContent = content
  
  const firestoreImportRegex = /import\s+\{([^}]+)\}\s+from\s+['"]firebase\/firestore['"]/
  const match = modifiedContent.match(firestoreImportRegex)
  
  if (match) {
    let importsStr = match[1]
    let imports = importsStr.split(',').map(i => i.trim()).filter(Boolean)
    
    let changed = false
    if (!imports.includes('query')) {
      imports.push('query')
      changed = true
    }
    if (!imports.includes('where')) {
      imports.push('where')
      changed = true
    }
    
    if (changed) {
      const newImportLine = `import { ${imports.join(', ')} } from 'firebase/firestore'`
      modifiedContent = modifiedContent.replace(firestoreImportRegex, newImportLine)
    }
  }

  // Inject userNitRut into useAuth destructuring if not present
  const useAuthRegex = /const\s+\{([^}]+)\}\s*=\s*useAuth\(\)/
  const authMatch = modifiedContent.match(useAuthRegex)
  if (authMatch) {
    let authProps = authMatch[1].split(',').map(p => p.trim()).filter(Boolean)
    if (!authProps.includes('userNitRut')) {
      authProps.push('userNitRut')
      const newAuthLine = `const { ${authProps.join(', ')} } = useAuth()`
      modifiedContent = modifiedContent.replace(useAuthRegex, newAuthLine)
    }
  } else {
    // If no useAuth, we can't safely inject tenant id. Warn about it.
    // console.log("Missing useAuth in file");
  }

  return modifiedContent
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8')
  let changed = false
  
  // 1. Convert getDocs(collection(db, 'NAME')) -> getDocs(query(collection(db, 'NAME'), where('nitRut', '==', userNitRut)))
  content = content.replace(GETDOCS_COLLECTION_REGEX, (match, collectionName) => {
    if (TENANT_COLLECTIONS.includes(collectionName)) {
      changed = true
      return `getDocs(query(collection(db, '${collectionName}'), where('nitRut', '==', userNitRut)))`
    }
    return match
  })

  // 2. Convert onSnapshot(collection(...) -> onSnapshot(query(collection(...), where('nitRut'...))
  content = content.replace(ONSNAPSHOT_COLLECTION_REGEX, (match, collectionName) => {
    if (TENANT_COLLECTIONS.includes(collectionName)) {
      changed = true
      return `onSnapshot(query(collection(db, '${collectionName}'), where('nitRut', '==', userNitRut)),`
    }
    return match
  })
  
  // 3. Handle existing queries: getDocs(query(collection(db, 'users'), where('role', '==', 'profesor')))
  const ComplexQueryRegex = /query\(\s*collection\(\s*db\s*,\s*['"]([^'"]+)['"]\s*\)\s*,\s*(.*?)\)/g
  content = content.replace(ComplexQueryRegex, (match, collectionName, existingWheres) => {
    if (TENANT_COLLECTIONS.includes(collectionName)) {
       // if we haven't already injected nitRut
       if (!existingWheres.includes("'nitRut'")) {
         changed = true
         return `query(collection(db, '${collectionName}'), ${existingWheres}, where('nitRut', '==', userNitRut))`
       }
    }
    return match
  })

  if (changed) {
    content = injectImports(content)
    fs.writeFileSync(filePath, content, 'utf8')
    console.log(`[UPDATED] ${path.basename(filePath)}`)
  }
}

function scanDir(dir) {
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const fullPath = path.join(dir, file)
    if (fs.statSync(fullPath).isDirectory()) {
      scanDir(fullPath)
    } else if (file.endsWith('.jsx')) {
      processFile(fullPath)
    }
  }
}

console.log('Starting tenant injection...')
scanDir(DASHBOARD_DIR)
console.log('Done.')
