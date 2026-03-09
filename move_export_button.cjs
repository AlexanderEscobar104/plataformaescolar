const fs = require('fs')
const path = require('path')

const basePath = path.join(__dirname, 'src', 'pages', 'dashboard')
const filesToPatch = fs.readdirSync(basePath).filter(file => file.endsWith('.jsx'))

for (const fileName of filesToPatch) {
  const filePath = path.join(basePath, fileName)
  let code = fs.readFileSync(filePath, 'utf-8')

  // Regex to find the ExportExcelButton tag exactly
  const exportPattern = /<ExportExcelButton\s+data=\{[^}]*\}\s+filename="[^"]*"\s*\/>/

  if (exportPattern.test(code)) {
    const match = code.match(exportPattern)
    const buttonString = match[0]

    // Remove the button from its current location
    code = code.replace(exportPattern, '')
    // Some lines might be left empty with just formatting spaces, won't worry too much about it, or clean up:
    code = code.replace(/\n\s*\n/g, '\n\n')

    // Now find where to insert it. We want it after the table.
    // The typical structure is:
    // <div className="students-table-wrap"> or <div className="table-responsive">
    //   <table ...>
    //     ...
    //   </table>
    // </div>
    // So we can insert it right after the closing </table> block (or after its immediate closing div).

    // Let's insert it right after `</table>` OR `</div>` if that div wraps the table.
    // The safest and easiest generic approach is right after `</table>` inside the wrap, 
    // or right after the `table-wrap` div. Let's do after `</table>\n      </div>`
    
    const insertionPoint1 = '</table>\n        </div>'
    const insertionPoint2 = '</table>\n      </div>'
    const insertionPoint3 = '</table>\n    </div>'
    
    // Create the wrapper div with right alignment
    const newButtonHtml = `\n      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>\n        ${buttonString}\n      </div>`

    if (code.includes('</table>\n        </div>')) {
      code = code.replace('</table>\n        </div>', `</table>\n        </div>${newButtonHtml}`)
    } else if (code.includes('</table>\n      </div>')) {
       code = code.replace('</table>\n      </div>', `</table>\n      </div>${newButtonHtml}`)
    } else if (code.includes('</table>\n    </div>')) {
       code = code.replace('</table>\n    </div>', `</table>\n    </div>${newButtonHtml}`)
    } else if (code.includes('</table>\n          </div>')) {
       code = code.replace('</table>\n          </div>', `</table>\n          </div>${newButtonHtml}`)
    } else if (code.includes('</table>')) {
      // Fallback: just immediately after </table>
      code = code.replace('</table>', `</table>${newButtonHtml}`)
    } else {
      console.log(`Could not find insertion point for table in ${fileName}. Restoring button.`)
      code = code.replace('// Restoring...', buttonString) // fallback logic missing but hopefully </table> matches
      continue // skip saving
    }

    fs.writeFileSync(filePath, code, 'utf-8')
    console.log(`Relocated ExportExcelButton in: ${fileName}`)
  }
}
