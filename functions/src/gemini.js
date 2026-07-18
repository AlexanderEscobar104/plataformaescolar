const MODEL = 'gemini-2.5-flash'

async function queryGemini({ systemPrompt, history, message }) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY no configurada')
  }
  const { GoogleGenAI } = require('@google/genai')
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

  const contents = (history || []).map((m) => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }))

  contents.push({
    role: 'user',
    parts: [{ text: message }],
  })

  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  })

  const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return text
}

async function queryGeminiWithTools({ systemPrompt, history, message, tools, toolFunctions, userContext, db }) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY no configurada')
  }
  const { GoogleGenAI, createPartFromFunctionResponse } = require('@google/genai')
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

  const contents = (history || []).map((m) => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }))

  contents.push({
    role: 'user',
    parts: [{ text: message }],
  })

  let turnCount = 0
  const maxTurns = 10

  while (turnCount < maxTurns) {
    turnCount++
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        maxOutputTokens: 2048,
        tools,
      },
    })

    const fc = response.functionCalls
    const text = response.text

    if (fc?.length) {
      const candidate = response.candidates?.[0]
      if (candidate?.content) {
        contents.push(candidate.content)
      }

      const parts = []
      for (const call of fc) {
        const name = call.name
        const args = call.args || {}
        const id = call.id
        try {
          const fn = toolFunctions[name]
          if (!fn) {
            parts.push(createPartFromFunctionResponse(id, name, { error: `Funcion desconocida: ${name}` }))
            continue
          }
          const result = await fn({ args, userContext, db })
          parts.push(createPartFromFunctionResponse(id, name, { result }))
        } catch (err) {
          parts.push(createPartFromFunctionResponse(id, name, { error: err.message }))
        }
      }

      contents.push({
        role: 'function',
        parts,
      })
      continue
    }

    return text || ''
  }

  return 'Lo siento, no pude procesar tu consulta despues de varias iteraciones.'
}

module.exports = { queryGemini, queryGeminiWithTools }
