import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload limit for sharing data context
app.use(express.json({ limit: "50mb" }));

// Lazy-initialized Gemini Client
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not configured in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Global flag to see if key is available
app.get("/api/config", (req, res) => {
  res.json({
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
  });
});

// Endpoint: Generate Strategy for a Specific City and World
app.post("/api/gemini/strategy", async (req, res) => {
  try {
    const { cityName, mundoName, idx } = req.body;
    const ai = getGenAI();

    const percentageStr = `${Math.abs((idx - 1) * 100).toFixed(0)}%`;
    const deviationText = idx >= 1.1 
      ? `sobre-representado en un ${percentageStr} respecto al promedio de la cadena`
      : idx <= 0.9
        ? `sub-representado en un ${percentageStr} respecto al promedio de la cadena`
        : `alineado con el promedio de la cadena`;

    const prompt = `Eres un experto consultor comercial y de diseño de espacio (visual merchandising) para Farmatodo.
Estás diseñando la estrategia de optimización para la ciudad de: "${cityName}" y específicamente para el Mundo Comercial: "${mundoName}".
El rendimiento de este mundo en esta ciudad está ${deviationText}.

Genera un plan estratégico sumamente específico y original para esta ciudad y mundo comercial. Responde en formato JSON puro.
Formato de respuesta:
{
  "explicacion": "Una descripción técnica y específica del patrón de compra en ${cityName} para el mundo comercial ${mundoName} (aprox 2 oraciones). SÉ ESPECÍFICO CON LA CIUDAD DE ${cityName}.",
  "sugerencias": [
    {
      "paso": "Paso 1 (Título corto de 3-5 palabras)",
      "detalle": "Detalle concreto y accionable específico para ${cityName} y el mundo ${mundoName} (máximo 15 palabras)."
    },
    {
      "paso": "Paso 2 (Título corto de 3-5 palabras)",
      "detalle": "Detalle concreto y accionable específico para ${cityName} y el mundo ${mundoName} (máximo 15 palabras)."
    },
    {
      "paso": "Paso 3 (Título corto de 3-5 palabras)",
      "detalle": "Detalle concreto y accionable específico para ${cityName} y el mundo ${mundoName} (máximo 15 palabras)."
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const data = JSON.parse(response.text || "{}");
    res.json(data);
  } catch (error: any) {
    console.error("Gemini Strategy Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Generate Insights for a City/Store
app.post("/api/gemini/insights", async (req, res) => {
  try {
    const { cityName, cityMundo, topCats, ventaTotal } = req.body;
    const ai = getGenAI();

    const resumeStr = (cityMundo || [])
      .slice(0, 5)
      .map((m: any) => `${m.m}: ${(m.share * 100).toFixed(1)}% de la venta, índice vs cadena: ${m.idx.toFixed(2)}`)
      .join("; ");
    
    const topsStr = (topCats || [])
      .slice(0, 5)
      .map((c: any) => c.cat)
      .join(", ");

    const prompt = `Eres un experto analista comercial y de planogramas para Farmatodo, la prestigiosa cadena de farmacias y retail en Latinoamérica.
Ciudad actual: ${cityName}. Venta total en 4 meses: ${ventaTotal}.
Distribución de ventas por Mundo (Sección comercial): ${resumeStr}.
Top categorías con mayor venta: ${topsStr}.

Analiza esta información y responde en DOS partes separadas exactamente por la secuencia de tres barras horizontales "|||":
Parte 1: Una etiqueta corta y llamativa de perfil de cliente (máximo 4 palabras, ej: "Salud Familiar & Recetario", "Destino Belleza & SPA", "Conveniencia Urbana de Impulso").
Parte 2: Un insight comercial valioso de máximo dos oraciones en español que explique la preferencia de los clientes de esta ciudad y proponga una sugerencia estratégica para el plano de venta. Sé sumamente pragmático, profesional, respetuoso y directo, sin rodeos de introducción ni markdown.
Ejemplo:
Salud Familiar & Recetario|||La altísima contribución de medicinas indica una compra de necesidad pura; sugerimos priorizar la cercanía de categorías de cuidado infantil al counter para ventas cruzadas.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    const text = response.text || "";
    if (text.includes("|||")) {
      const parts = text.split("|||");
      res.json({
        label: parts[0].trim(),
        insight: parts[1].trim(),
      });
    } else {
      res.json({
        label: "Perfil Mixto Comercial",
        insight: text.trim(),
      });
    }
  } catch (error: any) {
    console.error("Gemini Insights Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Enrich Justifications for optimization changes
app.post("/api/gemini/justifications", async (req, res) => {
  try {
    const { tienda, mundo, items, chainAvg } = req.body;
    const ai = getGenAI();

    if (!items || items.length === 0) {
      return res.json({ justifications: [] });
    }

    const itemsStr = items
      .map((r: any, i: number) => 
        `${i + 1}. Categoría: ${r.cat} | Acción: ${r.action} | ML actual: ${r.mlActual}m → sugerido: ${r.mlSugerido}m (Δ ${r.diffML > 0 ? "+" : ""}${r.diffML}m) | S2S Index: ${r.s2sIndex} | Venta/ML mes: $${r.vmlMes.toFixed(2)}`
      )
      .join("\n");

    const prompt = `Eres un especialista de mercadeo visual, planogramas y optimización de espacios de góndola en tiendas Farmatodo.
Estás optimizando el Mundo "${mundo}" en la tienda "${tienda}". El promedio de venta/ML mensual general de la cadena es $${chainAvg.toFixed(2)}.

Por cada categoría con cambios listada a continuación, genera una justificación comercial breve y súper profesional (máximo 16 palabras) en español, orientada a la eficiencia del piso de venta y rentabilidad.
Responde únicamente como una lista numerada, sin textos adicionales, saludos ni markdown.

Categorías a justificar:
${itemsStr}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    const text = response.text || "";
    // Parse numbered lines
    const lines = text.split("\n")
      .map(line => line.trim())
      .filter(line => /^\d+[\.\)]/.test(line))
      .map(line => line.replace(/^\d+[\.\)]\s*/, ""));

    res.json({ justifications: lines });
  } catch (error: any) {
    console.error("Gemini Justifications Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Interactive Data Consultation Chat
app.post("/api/gemini/chat", async (req, res) => {
  try {
    const { message, history, summaryContext } = req.body;
    const ai = getGenAI();

    let sysInstruction = `Eres "EspacioIQ", un asesor analítico e inteligente exclusivo para los directores de tienda, gerentes de categorías y mercaderistas comerciales de Farmatodo.
Tu propósito es ayudar a los usuarios comerciales a optimizar la asignación del espacio lineal en tiendas, mejorar el rendimiento comercial de cada anaquel y tomar decisiones eficientes sin alterar el espacio total asignado a cada Mundo (Mesa de control, Conveniencia, Cuidado personal, Bebé, Medicinas, etc.).

`;

    if (summaryContext) {
      sysInstruction += `DATOS DE LA CADENA CARGADA ACTUALMENTE:
- Tiendas registradas: ${summaryContext.nTiendas}
- Ciudades: ${summaryContext.nCiudades}
- Mundos comerciales: ${summaryContext.nMundos}
- Categorías totales: ${summaryContext.nCat}
- Metros lineales totales en góndolas: ${summaryContext.mlTotal.toFixed(1)} metros
- Venta total acumulada (4 meses): $${summaryContext.ventaTotal.toLocaleString("es-ES")}
- Venta/ML mensual promedio general: $${summaryContext.avgVmlMes?.toFixed(2)} por metro al mes
- Principales 3 categorías más rentables: ${summaryContext.topCategorias}
- Alertas de rendimiento bajo por categorías: ${summaryContext.alertasBajas}
- Rendimiento por Mundo comercial (Venta/ML mensual): ${summaryContext.mundosPerformance}
- Rendimiento por Área Farmatodo (Venta/ML mensual): ${summaryContext.areasPerformance}
- Top 3 sucursales con mayor Venta/ML: ${summaryContext.topTiendas}
- Bottom 3 sucursales con menor Venta/ML: ${summaryContext.alertasTiendas}

Usa esta información cuantitativa para responder de forma exacta sobre los datos reales cargados.
`;
    }

    sysInstruction += `REGLAS DE RESPUESTA CRÍTICAS (DEBES CUMPLIR ESTO ESTRICTAMENTE):
1. ANCLAJE TOTAL A LOS DATOS: Siempre responde basándote estrictamente en los datos que el usuario ha cargado actualmente (los detallados arriba). Está ABSOLUTAMENTE PROHIBIDO inventar, alucinar o estimar datos numéricos, nombres de tiendas o de categorías que no estén soportados en este contexto real.
2. JUSTIFICACIÓN NUMÉRICA MANDATORIA: Cada vez que des una recomendación, análisis, o respondas sobre el rendimiento de tiendas, áreas, mundos o categorías, DEBES incluir justificativos numéricos específicos tomados directamente de los datos cargados anteriormente (ej. comparando con el promedio general de la cadena de $${summaryContext ? summaryContext.avgVmlMes?.toFixed(2) : "promedio"} Venta/ML mes, indicando metros lineales totales o de la sucursal, o las cifras de venta mensual precisa).
3. Idioma: Habla en español impecable, con un tono analítico, corporativo y cercano al estilo Farmatodo.
4. Conconcisión: Respuestas sumamente breves, directas y al grano (máximo de 2 a 3 párrafos cortos). Evita explicaciones redundantes o introducciones vacías.
5. SIN BLOQUES DE CÓDIGO: Está ESTRICTAMENTE PROHIBIDO responder con bloques de código, JSON, HTML, Markdown extenso o scripts de programación, a menos que el usuario te lo pida con las palabras de software exactas. Habla en lenguaje comercial humano de negocios.
6. Regla de Suma Cero: Apoya de forma consistente el principio de optimización física de espacio: "para sumarle ML a una categoría, hay que restarle a otra menos eficiente dentro del mismo Mundo comercial".`;

    const chatHistory = (history || []).map((h: any) => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.content }],
    }));

    // Add current user message
    chatHistory.push({
      role: "user",
      parts: [{ text: message }],
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: chatHistory,
      config: {
        systemInstruction: sysInstruction,
      }
    });

    res.json({ reply: response.text || "No se pudo obtener respuesta de Gemini." });
  } catch (error: any) {
    console.error("Gemini Chat Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Setup Vite & static paths
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`EspacioIQ Server running on port ${PORT}`);
  });
}

startServer();
