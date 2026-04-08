# Guía de Integración del Chatbot Restructurado

## Cambios en la API del Chatbot

### Endpoint de Consulta

**POST** `/api/chatbot/`

**Request:**

```json
{
  "message": "Mostrar todos los casos de hoy"
}
```

**Response:**

```json
{
  "reply": "📊 **Resultados Masivos Encontrados**\n\n✅ Se encontraron **150 casos** en total...",
  "excelFile": {
    "fileName": "casos_1712938754123.xlsx",
    "fileUrl": "/api/chatbot/download-excel/casos_1712938754123.xlsx"
  }
}
```

_O sin archivo si es una consulta pequeña:_

```json
{
  "reply": "📋 **Total de Casos: 2**\n\n1. **CASE123** | Abierto | Juan Pérez",
  "excelFile": null
}
```

### Descargar Archivo Excel

**GET** `/api/chatbot/download-excel/{fileName}`

Descarga directa del archivo.

---

## Comportamiento Esperado

### Casos Pequeños (1-3 registros)

- ❌ NO se genera Excel
- ✅ La respuesta se muestra completamente en el chat
- Ejemplo: "¿Cuál es el estado del caso ABC123?"

### Casos Masivos (>3 registros)

- ✅ Se genera archivo Excel automáticamente
- ✅ El chatbot informa sobre el archivo
- ✅ Se proporciona enlace de descarga
- Ejemplo: "Mostrar todos los casos abiertos desde el lunes"

---

## Integración en el Frontend

### 1. Actualizar el manejador de respuestas

```javascript
// Antes (antiguo)
const response = await fetch("/api/chatbot", {
  method: "POST",
  body: JSON.stringify({ message: userMessage }),
});
const data = await response.json();
setMessages((prev) => [...prev, { text: data.reply }]);

// Después (nuevo)
const response = await fetch("/api/chatbot", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: userMessage }),
});
const data = await response.json();

// data.reply siempre contiene el mensaje del chatbot
setMessages((prev) => [...prev, { text: data.reply }]);

// Si hay archivo Excel, agregar botón de descarga
if (data.excelFile) {
  const downloadButton = {
    type: "download",
    fileName: data.excelFile.fileName,
    url: data.excelFile.fileUrl,
  };
  // Mostrar botón de descarga al usuario
}
```

### 2. Crear componente de descarga (ejemplo React)

```jsx
function ChatMessage({ message, excelFile }) {
  return (
    <div className="chat-message">
      <p>{message}</p>
      {excelFile && (
        <a
          href={excelFile.fileUrl}
          download={excelFile.fileName}
          className="excel-download-btn"
        >
          📥 Descargar {excelFile.fileName}
        </a>
      )}
    </div>
  );
}
```

### 3. Manejo de los archivos descargados

Los archivos Excel generados:

- Se guardan en el servidor por 24 horas
- Contienen todos los detalles de los casos
- Están formateados con encabezados estilizados
- Son descargables por el navegador

---

## Variables de Ambiente (si es necesario)

No se requieren nuevas variables de ambiente. Los archivos se guardan en:

```
src/uploads/excel-exports/
```

Si necesitas cambiar esta ubicación, edita `excel.service.js` en la variable `DOWNLOADS_DIR`.

---

## Limpieza de Archivos

Los archivos antiguos (>24 horas) se pueden limpiar ejecutando:

```javascript
// En un job/cron
const { cleanupOldExcelFiles } = require("./modules/chatbot/excel.service");
await cleanupOldExcelFiles();
```

(Esto aún no está integrado en una tarea programada, configúralo según tus necesidades)

---

## Ejemplos de Consultas

### ✅ Mostrará en el chat (1-3 casos)

- "¿Cuál es el estado del caso #12345?"
- "Mostrar casos del email juan@example.com"
- "¿Cuántos intentos tiene el agente Carlos?"

### ✅ Generará Excel (>3 casos)

- "Mostrar todos los casos de hoy"
- "¿Cuáles son los casos abiertos?"
- "Casos por origen = teléfono"
- "Casos en rango de fechas del 1 al 15 de abril"
- "Casos por llamada center Bogotá"

---

## Soporte para Otros Tipos de Datos

Actualmente, Excel se genera para consultas que retornan casos.
Para agregar Excel a otros tipos de datos (opportunities, etc.),
puedes extender `excel.service.js` con nuevas funciones como:

- `generateOpportunitiesExcel()`
- `generateAgentMetricsExcel()`
- etc.
