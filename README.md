# DashboardTI Backend (English)

Backend service for an internal Operations Automation Platform with CRM integrations, contact-center tooling, AI assistant features, and audio transcription workflows.

## 1) What This Project Is

This is not only a dashboard API.

It is an operational backend that:

- exposes business APIs for internal teams,
- integrates multiple external systems (Salesforce, Infobip, Vicidial, Azure services, etc.),
- automates repetitive cross-system processes with scheduled jobs,
- centralizes operational data in MySQL,
- powers AI-assisted workflows (chatbot + transcription analysis).

Recommended product definition:

"An internal Operations and Automation Platform backend with AI capabilities."

## 2) Core Capabilities

- Authentication and role-aware access control for protected endpoints.
- Salesforce case operations, reporting, closed-case workflows, comments, and exports.
- Vendor performance synchronization and category/rule evaluation.
- Infobip messaging synchronization (inbound + outbound statuses).
- Vicidial integrations (status, recordings-related flows, exceeded-time alerts).
- Azure OpenAI chatbot with function-calling and user session history.
- Azure Speech + Azure Storage based transcription pipeline.
- SQL Server data synchronization into MySQL operational tables.
- Public lead intake endpoints with rate limiting.
- Meta and GHL webhook/bridge endpoints.

## 3) Tech Stack

- Runtime: Node.js + Express
- ORM: Sequelize
- Main DB: MySQL
- Secondary data source: SQL Server
- Scheduling: node-cron
- Auth: JWT
- Security middlewares: Helmet, express-mongo-sanitize, xss-clean, CORS, rate limiting

## 4) High-Level Architecture

1. Express app boots API routes and global middleware.
2. Sequelize connects to MySQL (main persistence).
3. Optional cron workers run synchronization and monitoring jobs.
4. External adapters in services/controllers push/pull data from third-party systems.
5. Frontend (separate React app) consumes these APIs.

## 5) Main Integrations

### Salesforce

- OAuth authentication and SOQL-based data access.
- Case workflows, reports, vendor metrics, and case-related automations.

### Infobip

- Messaging send/receive flows.
- Conversation/message status synchronization jobs.

### Vicidial

- Contact center status and recordings-related operations.
- Agent exceeded-time monitoring job with email notifications.

### Azure OpenAI

- Chatbot assistant for operational and case-related queries.
- Function-calling workflow integrated with internal services.

### Azure Speech + Azure Storage

- Audio transcription pipeline.
- Recording ingestion, provider polling, enrichment and persistence.

### SQL Server

- Reads operational source data for periodic synchronization into MySQL.

### Mailchimp

- Audience/export and campaign-oriented automation support.

### SAP

- Finance invoice intake can persist vendor-submitted invoice data in MySQL and submit it to a configured SAP supplier invoice endpoint.

### GoHighLevel (GHL) + Gravity Forms

- Inbound/outbound sync style endpoints for lead/case state propagation.

### Meta

- Lead/comment webhook intake endpoint.

## 6) Data Layer

- Primary system-of-record for this backend: MySQL.
- ORM models are under src/models.
- Includes operational entities such as users, roles, products, vendors, case snapshots, chatbot sessions, transcription jobs/segments, message records, and more.
- External systems remain authoritative for some domains (for example Salesforce and Vicidial), and data is synchronized as needed.

## 7) Security Model

- JWT Bearer token authentication middleware for protected routes.
- Optional forced re-login on deployment via app version check.
- Role-based checks available through middleware.
- CORS allowlist and configurable extra origins through environment variables.
- Rate limiting for sensitive/public endpoints.
- Basic hardening with Helmet + input sanitization middleware.

## 8) API Surface (Functional Groups)

The backend exposes routes for domains such as:

- auth, users, roles
- salesforce, salesforce/cases
- vendors, case assignments, summaries
- infobit, callcenter, vicidial
- sqlserver
- chatbot
- transcriptions
- public-leads
- ghl bridges
- meta webhook

Utility endpoints:

- GET /health
- GET /version

## 9) Prerequisites

- Node.js 22 recommended
- npm
- Access credentials for:
  - local MySQL instance (or shared environment)
  - external services used by your selected features (Salesforce, Azure, etc.)
- Frontend repository (React) if you want end-to-end local testing

## 10) Local Setup

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Create environment variables file

Create a .env file in the project root and add the required variables from section 11.

### Step 3: Start the backend

Development:

```bash
npm run dev
```

Production-like local run:

```bash
npm start
```

The API starts on PORT (default: 4000).

### Step 4: Validate

- Open GET /health
- Open GET /version

If both are successful, the service is running correctly.

## 11) Environment Variables

This project uses many feature-based integrations. Start with core variables, then add optional modules you need.

### 11.1 Core (Required)

```env
NODE_ENV=development
PORT=4000
JWT_SECRET=your_jwt_secret

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=dashboard_db
DB_USER=dashboard_user
DB_PASSWORD=dashboard_password

APP_VERSION=local-dev
```

### 11.2 Auth / Deployment Behavior

```env
FORCE_RELOGIN_ON_DEPLOY=false
RENDER_DEPLOY_ID=
RENDER_GIT_COMMIT=
```

### 11.3 CORS / Public Forms

```env
CORS_ALLOWED_ORIGINS=http://localhost:5173
PUBLIC_FORM_ALLOWED_ORIGINS=http://localhost:5173
```

### 11.4 Jobs / Scheduling

```env
ENABLE_JOBS=true
VENDOR_SYNC_CRON_EXPRESSION=*/30 * * * *
TRANSCRIPTION_POLL_INTERVAL_SECONDS=30
```

### 11.5 Salesforce

```env
SF_CLIENT_ID=
SF_CLIENT_SECRET=
SF_USERNAME=
SF_PASSWORD=
SALESFORCE_TIMEZONE=America/New_York
```

### 11.5.1 SAP / Finance Invoices

```env
SAP_ENABLED=false
SAP_DRY_RUN=false
SAP_BASE_URL=https://your-sap-host.example.com
SAP_SUPPLIER_INVOICE_ENDPOINT=/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice
SAP_AUTH_TYPE=basic
SAP_USERNAME=
SAP_PASSWORD=
SAP_CLIENT_ID=
SAP_CLIENT_SECRET=
SAP_TOKEN_URL=
SAP_CSRF_ENABLED=true
SAP_TIMEOUT_MS=30000
SAP_REJECT_UNAUTHORIZED=true
```

Finance invoice API:

- `POST /finance/invoices` stores the submitted invoice fields and, when SAP is configured, attempts to send it to SAP.
- `POST /finance/invoices` accepts `multipart/form-data` and may include one optional PDF file under the `invoicePdf` field.
- `GET /finance/invoices/catalogs` returns dropdown options for document type, identity document type, currency, purchase type, and goods/services type.
- `GET /finance/invoices` lists stored invoices. Optional filters: `sapStatus`, `documentType`, `purchaseType`, `ruc`, `search`, `limit`.
- `GET /finance/invoices/:invoiceId` returns one invoice.
- `POST /finance/invoices/:invoiceId/sap-sync` retries SAP submission. Body: `{ "force": false }`.

Required `POST /finance/invoices` body fields:

`documentType`, `documentSeries`, `documentNumber`, `purchaseType`, `goodsServicesType`, `identityDocumentType`, `ruc`, `businessName`, `issueDate`, `dueDate`, `currencyType`, `taxableBaseAmount`, `igvAmount`, `totalAmount`, `validateDetraction`, `detractionPercentage`, `detractionCode`, `detractionAmount`.

Optional file upload for `POST /finance/invoices`:

- field name: `invoicePdf`
- accepted type: `application/pdf`
- max size: `10 MB`

Optional SAP attachment config:

```env
SAP_SUPPLIER_INVOICE_ATTACHMENT_ENDPOINT=
SAP_AUTH_TYPE=basic
```

If `SAP_SUPPLIER_INVOICE_ATTACHMENT_ENDPOINT` is configured and a PDF is uploaded, the backend sends the created invoice to SAP first and then posts the PDF attachment in a second request using the SAP document id. The endpoint may include the placeholder `:sapDocumentId`.

### 11.6 Infobip

```env
INFOBIP_BASE_URL=
INFOBIP_API_KEY=
INFOBIP_SENDER=
INFOBIP_CCAAS_AGENT_ID=
INFOBIP_CALL_PHONE=
INFOBIP_BOOKING_URL=
```

### 11.7 Vicidial

```env
VICIDIAL_USER=
VICIDIAL_PASS=
VICIDIAL_RECORDINGS_USER=
VICIDIAL_RECORDINGS_PASS=
VICIDIAL_DB_HOST=
VICIDIAL_DB_PORT=3306
VICIDIAL_DB_NAME=asterisk
VICIDIAL_DB_USER=
VICIDIAL_DB_PASSWORD=
VICIDIAL_DB_TIMEZONE=America/Lima
VICIDIAL_USER_STATS_USERS=
VICIDIAL_USER_STATS_EXCLUDED_USERS=
```

The `VICIDIAL_DB_*` values are optional, but Time To Lead uses them when available to search `vicidial_log` directly for the first outbound call by phone and date before falling back to lead-search scraping.
The `VICIDIAL_USER_STATS_*` values are optional comma-separated overrides for the web-report fallback. When omitted, the backend uses the current active/excluded Vicidial user lists configured in code.

### 11.8 Azure OpenAI (Chatbot)

```env
AZURE_OPENAI_KEY=
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_VERSION=
AZURE_OPENAI_DEPLOYMENT=
```

### 11.9 Azure Speech + Storage (Transcriptions)

```env
AZURE_SPEECH_KEY=
AZURE_SPEECH_ENDPOINT=
# Optional alternative to endpoint:
AZURE_SPEECH_REGION=

AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER_INPUT=recordings-input
AZURE_STORAGE_CONTAINER_OUTPUT=transcriptions-output

TRANSCRIPTION_LOCALE=en-US
```

### 11.10 SQL Server Source

```env
SQLSERVER_HOST=
SQLSERVER_DB=
SQLSERVER_USER=
SQLSERVER_PASSWORD=
```

### 11.11 GHL / Gravity Forms / External APIs

```env
GF_API_BASE_URL=
GF_CONSUMER_KEY=
GF_CONSUMER_SECRET=

GHL_ACCESS_TOKEN=
GHL_LOCATION_ID=

ACTIVE_PROSPECT_URL=
```

### 11.12 Mailchimp (If used)

```env
MAILCHIMP_API_KEY=
MAILCHIMP_SERVER_PREFIX=
MAILCHIMP_AUDIENCE_ID=
```

### 11.13 Runtime Note

NODE_TLS_REJECT_UNAUTHORIZED appears in runtime/config contexts and should remain secure in production environments.

## 12) Background Jobs

When ENABLE_JOBS is not set to false, the backend schedules and runs jobs such as:

- attempts daily sync
- infobit status sync
- infobit inbound sync
- vendor sync + rule evaluation
- vicidial exceeded-time alerts (production only)
- transcription status polling (when Azure transcription config is present)

Most jobs also run once at startup for initial sync.

## 13) Frontend + Backend Local Workflow

This repository is the backend only. Typical local workflow:

1. Run backend in this repo.
2. Run React frontend in its own repository/workspace.
3. Configure frontend base API URL to this backend (for example localhost:4000).
4. Ensure CORS_ALLOWED_ORIGINS includes your frontend origin.

## 14) First-Day Onboarding Checklist

1. Install dependencies.
2. Prepare MySQL database and credentials.
3. Add minimum .env core values.
4. Start backend and validate /health.
5. Log in with a valid user.
6. Enable one integration at a time (Salesforce, Infobip, etc.).
7. Enable jobs only after integration credentials are valid.

## 15) Troubleshooting

- App fails at startup: verify MySQL connectivity and core DB env vars.
- 401 Unauthorized: validate JWT secret and token lifecycle.
- CORS errors: add frontend origin to CORS_ALLOWED_ORIGINS.
- Jobs disabled unexpectedly: check ENABLE_JOBS value.
- Transcription polling not running: ensure Azure Speech + Storage vars are set.

## 16) Notes for Maintainers

- Keep .env secrets out of version control.
- Rotate third-party credentials periodically.
- Document new integrations and route groups in this README when added.
- Consider adding a .env.example file for faster onboarding.

------------------------------------------------------------------------------------.

# DashboardTI Backend (Spanish)

Servicio backend para una plataforma interna de operaciones y automatizacion con integraciones CRM, herramientas de contact center, capacidades de IA y flujos de transcripcion de audio.

## 1) Que es este proyecto

No es solo una API de dashboard.

Es un backend operativo que:

- expone APIs de negocio para equipos internos,
- integra multiples sistemas externos (Salesforce, Infobip, Vicidial, servicios de Azure, etc.),
- automatiza procesos repetitivos entre sistemas con jobs programados,
- centraliza datos operativos en MySQL,
- habilita flujos asistidos por IA (chatbot + analisis de transcripciones).

Definicion recomendada del producto:

"Backend de una plataforma interna de operaciones y automatizacion con capacidades de IA."

## 2) Capacidades principales

- Autenticacion y control de acceso por roles para endpoints protegidos.
- Operaciones de casos en Salesforce, reportes, flujos de casos cerrados, comentarios y exportaciones.
- Sincronizacion de desempeno de vendors y evaluacion de categorias/reglas.
- Sincronizacion de mensajeria Infobip (entrante + estados salientes).
- Integraciones con Vicidial (estados, flujos de grabaciones, alertas por tiempo excedido).
- Chatbot con Azure OpenAI, function-calling e historial por usuario.
- Pipeline de transcripcion con Azure Speech + Azure Storage.
- Sincronizacion de datos desde SQL Server hacia tablas operativas en MySQL.
- Endpoints publicos de captacion de leads con rate limiting.
- Endpoints webhook/bridge para Meta y GHL.

## 3) Stack tecnologico

- Runtime: Node.js + Express
- ORM: Sequelize
- Base de datos principal: MySQL
- Fuente de datos secundaria: SQL Server
- Scheduler: node-cron
- Auth: JWT
- Middlewares de seguridad: Helmet, express-mongo-sanitize, xss-clean, CORS, rate limiting

## 4) Arquitectura de alto nivel

1. Express inicia rutas API y middleware global.
2. Sequelize conecta con MySQL (persistencia principal).
3. Workers cron opcionales ejecutan sincronizaciones y monitoreo.
4. Adaptadores externos en services/controllers envian y reciben datos de terceros.
5. El frontend (React en repo separado) consume estas APIs.

## 5) Integraciones principales

### Salesforce

- Autenticacion OAuth y acceso a datos con SOQL.
- Flujos de casos, reportes, metricas de vendors y automatizaciones relacionadas.

### Infobip

- Flujos de envio/recepcion de mensajeria.
- Jobs de sincronizacion de conversaciones y estados de mensajes.

### Vicidial

- Operaciones de estado de contact center y flujos de grabaciones.
- Job de monitoreo por tiempo excedido de agentes con notificaciones por email.

### Azure OpenAI

- Chatbot asistente para consultas operativas y de casos.
- Flujo de function-calling integrado con servicios internos.

### Azure Speech + Azure Storage

- Pipeline de transcripcion de audio.
- Ingesta de grabaciones, polling del proveedor, enriquecimiento y persistencia.

### SQL Server

- Lectura de datos operativos para sincronizacion periodica hacia MySQL.

### Mailchimp

- Soporte para flujos de audiencia/export y automatizaciones de campanas.

### GoHighLevel (GHL) + Gravity Forms

- Endpoints tipo bridge para propagacion de estados de leads/casos.

### Meta

- Endpoint webhook para ingesta de leads/comentarios.

## 6) Capa de datos

- Sistema principal de registro para este backend: MySQL.
- Los modelos ORM estan en src/models.
- Incluye entidades operativas como users, roles, products, vendors, snapshots de casos, sesiones de chatbot, jobs/segmentos de transcripcion, registros de mensajes y mas.
- Sistemas externos siguen siendo la fuente de verdad para ciertos dominios (por ejemplo Salesforce y Vicidial), y los datos se sincronizan cuando aplica.

## 7) Modelo de seguridad

- Middleware JWT Bearer token para rutas protegidas.
- Re-login forzado opcional en despliegues por validacion de version de app.
- Validaciones por rol disponibles via middleware.
- Allowlist de CORS y origenes adicionales configurables por variables de entorno.
- Rate limiting para endpoints sensibles/publicos.
- Hardening basico con Helmet + middleware de sanitizacion de input.

## 8) Superficie API (grupos funcionales)

El backend expone rutas para dominios como:

- auth, users, roles
- salesforce, salesforce/cases
- vendors, case assignments, summaries
- infobit, callcenter, vicidial
- sqlserver
- chatbot
- transcriptions
- public-leads
- ghl bridges
- meta webhook

Endpoints utilitarios:

- GET /health
- GET /version

## 9) Prerrequisitos

- Node.js 22 recomendado
- npm
- Credenciales de acceso para:
  - instancia local MySQL (o entorno compartido)
  - servicios externos usados por los modulos que vayas a activar (Salesforce, Azure, etc.)
- Repositorio frontend (React) para pruebas end-to-end locales

## 10) Inicio local

### Paso 1: Instalar dependencias

```bash
npm install
```

### Paso 2: Crear archivo de variables de entorno

Crea un archivo .env en la raiz del proyecto y agrega las variables requeridas de la seccion 11.

### Paso 3: Iniciar el backend

Desarrollo:

```bash
npm run dev
```

Ejecucion local similar a produccion:

```bash
npm start
```

La API inicia en PORT (por defecto: 4000).

### Paso 4: Validar

- Abrir GET /health
- Abrir GET /version

Si ambos endpoints responden correctamente, el servicio esta funcionando.

## 11) Variables de entorno

Este proyecto usa muchas integraciones por modulo. Empieza con variables core y luego agrega los modulos opcionales que necesites.

### 11.1 Core (requeridas)

```env
NODE_ENV=development
PORT=4000
JWT_SECRET=your_jwt_secret

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=dashboard_db
DB_USER=dashboard_user
DB_PASSWORD=dashboard_password

APP_VERSION=local-dev
```

### 11.2 Auth / comportamiento en despliegue

```env
FORCE_RELOGIN_ON_DEPLOY=false
RENDER_DEPLOY_ID=
RENDER_GIT_COMMIT=
```

### 11.3 CORS / formularios publicos

```env
CORS_ALLOWED_ORIGINS=http://localhost:5173
PUBLIC_FORM_ALLOWED_ORIGINS=http://localhost:5173
```

### 11.4 Jobs / scheduling

```env
ENABLE_JOBS=true
VENDOR_SYNC_CRON_EXPRESSION=*/30 * * * *
TRANSCRIPTION_POLL_INTERVAL_SECONDS=30
```

### 11.5 Salesforce

```env
SF_CLIENT_ID=
SF_CLIENT_SECRET=
SF_USERNAME=
SF_PASSWORD=
SALESFORCE_TIMEZONE=America/New_York
```

### 11.6 Infobip

```env
INFOBIP_BASE_URL=
INFOBIP_API_KEY=
INFOBIP_SENDER=
INFOBIP_CCAAS_AGENT_ID=
INFOBIP_CALL_PHONE=
INFOBIP_BOOKING_URL=
```

### 11.7 Vicidial

```env
VICIDIAL_USER=
VICIDIAL_PASS=
VICIDIAL_RECORDINGS_USER=
VICIDIAL_RECORDINGS_PASS=
VICIDIAL_DB_HOST=
VICIDIAL_DB_PORT=3306
VICIDIAL_DB_NAME=asterisk
VICIDIAL_DB_USER=
VICIDIAL_DB_PASSWORD=
VICIDIAL_DB_TIMEZONE=America/Lima
VICIDIAL_USER_STATS_USERS=
VICIDIAL_USER_STATS_EXCLUDED_USERS=
```

Los valores `VICIDIAL_DB_*` son opcionales, pero Time To Lead los usa cuando existen para buscar primero en `vicidial_log` la primera llamada outbound por telefono y fecha antes de caer al scraping del lead search.
Los valores `VICIDIAL_USER_STATS_*` son opcionales y aceptan listas separadas por coma para sobrescribir el fallback del reporte web. Si se omiten, el backend usa las listas actuales de usuarios activos/excluidos configuradas en codigo.

### 11.8 Azure OpenAI (chatbot)

```env
AZURE_OPENAI_KEY=
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_VERSION=
AZURE_OPENAI_DEPLOYMENT=
```

### 11.9 Azure Speech + Storage (transcripciones)

```env
AZURE_SPEECH_KEY=
AZURE_SPEECH_ENDPOINT=
# Alternativa opcional al endpoint:
AZURE_SPEECH_REGION=

AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER_INPUT=recordings-input
AZURE_STORAGE_CONTAINER_OUTPUT=transcriptions-output

TRANSCRIPTION_LOCALE=en-US
```

### 11.10 Fuente SQL Server

```env
SQLSERVER_HOST=
SQLSERVER_DB=
SQLSERVER_USER=
SQLSERVER_PASSWORD=
```

### 11.11 GHL / Gravity Forms / APIs externas

```env
GF_API_BASE_URL=
GF_CONSUMER_KEY=
GF_CONSUMER_SECRET=

GHL_ACCESS_TOKEN=
GHL_LOCATION_ID=

ACTIVE_PROSPECT_URL=
```

### 11.12 Mailchimp (si aplica)

```env
MAILCHIMP_API_KEY=
MAILCHIMP_SERVER_PREFIX=
MAILCHIMP_AUDIENCE_ID=
```

### 11.13 Nota de runtime

NODE_TLS_REJECT_UNAUTHORIZED aparece en contextos de runtime/config y debe mantenerse de forma segura en produccion.

## 12) Jobs en segundo plano

Cuando ENABLE_JOBS no esta en false, el backend agenda y ejecuta jobs como:

- sincronizacion diaria de attempts
- sincronizacion de estados Infobip
- sincronizacion de inbound Infobip
- sincronizacion de vendors + evaluacion de reglas
- alertas por tiempo excedido en Vicidial (solo produccion)
- polling de estados de transcripcion (cuando existe configuracion Azure de transcripcion)

La mayoria de jobs tambien se ejecutan una vez al iniciar el servicio para una sincronizacion inicial.

## 13) Flujo local frontend + backend

Este repositorio contiene solo el backend. Flujo local tipico:

1. Ejecutar backend en este repo.
2. Ejecutar frontend React en su propio repo/workspace.
3. Configurar base API URL del frontend apuntando a este backend (por ejemplo localhost:4000).
4. Asegurar que CORS_ALLOWED_ORIGINS incluya el origen del frontend.

## 14) Checklist de onboarding (primer dia)

1. Instalar dependencias.
2. Preparar base de datos MySQL y credenciales.
3. Agregar valores minimos core en .env.
4. Iniciar backend y validar /health.
5. Iniciar sesion con un usuario valido.
6. Activar una integracion a la vez (Salesforce, Infobip, etc.).
7. Activar jobs solo cuando las credenciales de integraciones esten validadas.

## 15) Troubleshooting

- La app falla al iniciar: validar conectividad MySQL y variables DB core.
- 401 Unauthorized: validar JWT secret y ciclo de vida del token.
- Errores CORS: agregar origen frontend en CORS_ALLOWED_ORIGINS.
- Jobs desactivados inesperadamente: revisar valor de ENABLE_JOBS.
- Polling de transcripcion no corre: validar variables Azure Speech + Storage.

## 16) Notas para maintainers

- Mantener secretos de .env fuera del control de versiones.
- Rotar credenciales de terceros periodicamente.
- Documentar nuevas integraciones y grupos de rutas en este README cuando se agreguen.
- Considerar agregar un archivo .env.example para acelerar onboarding.
