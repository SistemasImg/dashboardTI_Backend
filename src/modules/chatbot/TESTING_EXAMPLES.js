/**
 * EJEMPLO: Cómo probar el chatbot restructurado
 *
 * Guía completa de uso para el equipo de testing
 */

// ============================================
// EJEMPLO 1: Consulta que termina en chat
// ============================================

// REQUEST: Consulta sobre UN CASO específico
const request1 = {
  method: "POST",
  url: "http://localhost:5000/api/chatbot/",
  body: {
    message: "¿Cuál es el estado del caso #CASE001?",
  },
};

// RESPONSE esperada:
const response1 = {
  reply:
    "📌 **Caso: CASE001**\n• **Estado:** Abierto\n• **Subestado:** En Revisión\n...",
  excelFile: null, // ← Sin Excel porque es UN solo caso
};

// En el frontend:
// - Mostrar el mensaje en el chat
// - NO mostrar botón de descarga

// ============================================
// EJEMPLO 2: Consulta masiva que genera Excel
// ============================================

// REQUEST: Consulta de MUCHOS casos
const request2 = {
  method: "POST",
  url: "http://localhost:5000/api/chatbot/",
  body: {
    message: "Mostrar todos los casos abiertos de hoy",
  },
};

// RESPONSE esperada:
const response2 = {
  reply:
    "📊 **Resultados Masivos Encontrados**\n\n✅ Se encontraron **47 casos** en total.\n\nDebido a la cantidad de registros, he preparado un archivo Excel...\n\n📥 **Archivo:** casos_1712345678123.xlsx",
  excelFile: {
    fileName: "casos_1712345678123.xlsx",
    fileUrl: "/api/chatbot/download-excel/casos_1712345678123.xlsx",
  },
};

// En el frontend:
// - Mostrar el mensaje en el chat
// - Mostrar un botón de descarga con link a excelFile.fileUrl

// ============================================
// EJEMPLO 3: Descargar archivo
// ============================================

// Si el usuario hace clic en el botón de descarga:
const downloadRequest = {
  method: "GET",
  url: "http://localhost:5000/api/chatbot/download-excel/casos_1712345678123.xlsx",
};

// El navegador descarga el archivo automáticamente

// ============================================
// EJEMPLO 4: Integración en React
// ============================================

import { useState } from "react";

export function ChatbotChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    try {
      // 1. Enviar el mensaje al backend
      const response = await fetch("/api/chatbot/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });

      const data = await response.json();

      // 2. Agregar el mensaje del chatbot al chat
      const botMessage = {
        id: Date.now(),
        type: "bot",
        text: data.reply,
        excelFile: data.excelFile, // Puede ser null
      };

      setMessages((prev) => [...prev, botMessage]);
      setInput("");
    } catch (error) {
      console.error("Error:", error);
    }
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.type}`}>
            {/* 3. Mostrar el mensaje */}
            <p>{msg.text}</p>

            {/* 4. Si hay Excel, mostrar botón de descarga */}
            {msg.excelFile && (
              <a
                href={msg.excelFile.fileUrl}
                download={msg.excelFile.fileName}
                className="btn-download-excel"
              >
                📥 Descargar {msg.excelFile.fileName}
              </a>
            )}
          </div>
        ))}
      </div>

      <div className="input-container">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
          placeholder="Pregunta al chatbot..."
        />
        <button onClick={handleSendMessage}>Enviar</button>
      </div>
    </div>
  );
}

// ============================================
// PRUEBAS A REALIZAR
// ============================================

/*
PRUEBA 1: Caso Individual
─────────────────────────
Mensaje: "¿Cuál es el estado del caso #ABC123?"
Resultado esperado:
  ✅ Mensaje se muestra en chat
  ✅ excelFile = null
  ✅ No hay botón de descarga

PRUEBA 2: Pocos Casos (≤3)
──────────────────────────
Mensaje: "Mostrar casos del email juan@example.com" (si retorna 2 casos)
Resultado esperado:
  ✅ Se listan los 2 casos en el chat
  ✅ excelFile = null
  ✅ No hay botón de descarga

PRUEBA 3: Muchos Casos (>3)
───────────────────────────
Mensaje: "Mostrar todos los casos abiertos" (si retorna 10+ casos)
Resultado esperado:
  ✅ Mensaje informando sobre el Excel
  ✅ excelFile contiene fileName y fileUrl válidos
  ✅ Se muestra botón de descarga

PRUEBA 4: Descargar Archivo
─────────────────────────────
Acción: Hacer clic en botón de descarga
Resultado esperado:
  ✅ Se descarga el archivo Excel
  ✅ El archivo contiene todos los datos
  ✅ El formato tiene encabezados azules
  ✅ Las columnas están bien ajustadas

PRUEBA 5: Archivo no encontrado
───────────────────────────────
Acción: Intentar descargar un archivo con nombre inválido
URL: /api/chatbot/download-excel/../../../etc/passwd
Resultado esperado:
  ✅ Error 400 (archivo inválido)
  ✅ Se previene path traversal
  ✅ No hay acceso a archivos del sistema

PRUEBA 6: Resumen Operacional
─────────────────────────────
Mensaje: "Mostrar resumen operacional de hoy"
Resultado esperado:
  ✅ Se muestra el resumen con formato
  ✅ Desglose por Estado
  ✅ Desglose por Origen
  ✅ Desglose por Segmento
  ✅ excelFile = null (los resúmenes no generan Excel)
*/

// ============================================
// LOGS A VERIFICAR EN EL SERVIDOR
// ============================================

/*
Cuando se ejecutan las pruebas, deberías ver logs como:

✅ Caso pequeño:
  "Incoming chatbot message: ¿Cuál es el estado del caso #ABC123?"
  "Function requested: getCaseByNumber"
  → No hay mensaje sobre Excel

✅ Caso masivo:
  "Incoming chatbot message: Mostrar todos los casos abiertos"
  "Function requested: getCasesByStatus"
  "Excel file generated: casos_1712345678123.xlsx"
  → Se genera Excel

✅ Descarga de archivo:
  "Excel file downloaded: casos_1712345678123.xlsx"
  → Se registra la descarga

❌ Intento de path traversal:
  "Download Excel controller error: Nombre de archivo inválido"
  → Se rechaza por seguridad
*/
