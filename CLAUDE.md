# Sistema IT — PLG (Panamerican Logistics Group)

## gstack

Este proyecto usa [gstack](https://github.com/garrytan/gstack). Skills disponibles: `/qa`, `/ship`, `/review`, `/browse`.

---

## Índice rápido

1. [Arquitectura general](#1-arquitectura-general)
2. [Variables de entorno](#2-variables-de-entorno)
3. [Estructura de archivos](#3-estructura-de-archivos)
4. [Tablas en Azure Table Storage](#4-tablas-en-azure-table-storage)
5. [Autenticación y roles](#5-autenticación-y-roles)
6. [Endpoints API](#6-endpoints-api)
7. [Patrones de frontend](#7-patrones-de-frontend)
8. [Bugs resueltos — NO repetir](#8-bugs-resueltos--no-repetir)
9. [Reglas invariantes](#9-reglas-invariantes)
10. [Cómo agregar funcionalidades nuevas](#10-cómo-agregar-funcionalidades-nuevas)

---

## 1. Arquitectura general

```
Azure Static Web Apps (Free tier)
├── Frontend HTML/JS estático (sin framework, Vanilla JS)
├── Azure Functions Node ~18  →  /api/*
└── Azure Table Storage        →  datos principales

Supabase PostgreSQL
└── usuarios_sistema           →  cuentas de acceso al portal IT
```

**URL de producción:** `nice-mud-0d1acad10.7.azurestaticapps.net`

**Repositorio:** `https://github.com/sypr01/sharepoint-tools`  
Deploy automático en cada push a `master`.

**Sin framework de frontend.** Todo es HTML + Vanilla JS. Sin React, sin Vue, sin bundler. Los cambios de JS se ven directamente en el archivo `.html`.

---

## 2. Variables de entorno

Configuradas en Azure Static Web Apps → Configuration → Application settings.

| Variable | Dónde se usa | Descripción |
|---|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | Todos los APIs | Cadena de conexión completa a Azure Storage |
| `SUPABASE_DB_URL` | `/api/login`, `/api/boveda-reauth`, `/api/gestion-usuarios` | URL de conexión PostgreSQL a Supabase |
| `JWT_SECRET` | `/api/lib/auth.js` | Secreto para firmar/verificar tokens JWT |
| `BOVEDA_SECRET` | `/api/boveda`, `/api/boveda-reauth` | Clave AES-256 en base64 (32 bytes). **Opcional** — si no se configura, se deriva automáticamente de JWT_SECRET |
| `TENANT_ID` | `/api/me`, `/api/colaboradores` | ID de tenant Azure AD (M365) |
| `CLIENT_ID` | `/api/me`, `/api/colaboradores` | App registration client ID |
| `CLIENT_SECRET` | `/api/me`, `/api/colaboradores` | App registration client secret |

**Generar BOVEDA_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## 3. Estructura de archivos

```
proyecto/
├── inventario.html          # Módulo principal IT: usuarios + equipos
├── boveda.html              # Bóveda de Accesos IT
├── tickets.html             # Mesa de ayuda / tickets
├── admin-usuarios.html      # Gestión de usuarios del sistema (admin)
├── login.html               # Login del portal IT
├── index.html               # Portal principal PLG (redirige a módulos)
├── directorio.html          # Directorio de colaboradores (interno)
├── directorio-colaboradores.html  # Directorio público
├── staticwebapp.config.json # Rutas SWA, fallbacks, auth
├── api/
│   ├── host.json            # Configuración Azure Functions
│   ├── package.json         # Dependencias: @azure/data-tables, pg, bcryptjs, jsonwebtoken
│   ├── lib/
│   │   └── auth.js          # verifyToken() + signToken() — JWT via X-PLG-Auth
│   ├── login/               # POST — autenticación, devuelve JWT
│   ├── usuarios/            # GET/POST/PUT/DELETE — perfil de usuarios IT
│   ├── cuentas-usuario/     # GET/PUT — cuentas de sistemas por usuario (SEPARADO)
│   ├── inventario/          # GET/POST/PUT/DELETE — equipos físicos
│   ├── boveda/              # GET/POST/PUT/DELETE — sistemas y accesos IT
│   ├── boveda-reauth/       # POST — verificar contraseña antes de revelar
│   ├── boveda-audit/        # GET — log de auditoría de la bóveda
│   ├── colaboradores/       # GET — directorio M365 (Graph API)
│   ├── me/                  # GET — perfil del usuario M365
│   ├── tickets/             # GET/POST — tickets IT
│   ├── ticket/              # GET/PUT — ticket individual
│   ├── mesa-ayuda/          # Mesa de ayuda (Supabase)
│   ├── gestion-usuarios/    # Admin de usuarios del sistema
│   └── ...
```

---

## 4. Tablas en Azure Table Storage

Todas usan `partitionKey = "IT"`. El `rowKey` es el ID único.

### Tabla `usuarios`
Perfil de cada colaborador en el inventario IT.

| Campo | Tipo | Notas |
|---|---|---|
| `rowKey` | string | `USR-{timestamp}-{random}` |
| `nombre` | string | Nombre completo — FK en inventario.usuarioActual |
| `division` | string | `PLG DE EL SALVADOR`, `PLG DIVISION ADUANAS`, etc. |
| `area` | string | Departamento |
| `puesto` | string | Cargo |
| `telefono`, `celular`, `extension` | string | Contacto |
| `hostname`, `anydesk` | string | Acceso remoto |
| `microsoftEmail`, `microsoftPass` | string | Campos legacy — **preferir `cuentas[]`** |
| `gmailEmail`, `gmailPass` | string | Campos legacy |
| `magayaUser`, `magayaPass` | string | Campos legacy |
| `equipos` | JSON string | **LEGACY** — fuente de verdad es tabla `inventario` |
| `cuentas` | JSON string | Array `[{sistema, usuario, pass}]` — **gestionado SOLO por `/api/cuentas-usuario`** |
| `accesosFisicos` | JSON string | `{edificio, piso, sala, notas}` |

### Tabla `inventario`
Equipos físicos (laptops, monitores, celulares, tablets, etc.).

| Campo | Tipo | Notas |
|---|---|---|
| `rowKey` | string | `INV-{timestamp}-{random}` |
| `tipo` | string | `Laptop`, `Monitor`, `Celular`, `Tablet`, `Impresora`, `Otro` |
| `marca`, `modelo`, `serial` | string | Identificación física |
| `estado` | string | `Bueno`, `Regular`, `Baja`, `Disponible`, `Asignado` |
| `division` | string | División PLG |
| `usuarioActual` | string | Nombre del usuario asignado (igual a `usuarios.nombre`) |
| `usuarioId` | string | **FK a `usuarios.rowKey`** — fuente de verdad para el join |
| `usuarioAnterior` | string | Historial de asignación anterior |
| `notas` | string | Notas de mantenimiento |
| `fechaIngreso` | ISO string | Fecha de alta |

### Tabla `boveda`
Sistemas y credenciales IT centralizadas.

| Campo | Tipo | Notas |
|---|---|---|
| `rowKey` | string | `SIS-{timestamp}-{random}` |
| `nombre` | string | Nombre del sistema |
| `categoria` | string | ERP/Logística, Email/Comunicación, etc. |
| `url` | string | Enlace al sistema |
| `usuario` | string | Usuario/correo de acceso |
| `passEnc` | string | Contraseña **cifrada AES-256-GCM** — formato `iv:tag:ciphertext` (base64) |
| `notas` | string | Instrucciones, contexto |
| `division` | string | División o `Todas` |
| `creadoPor` | string | Nombre del usuario que lo creó |
| `activo` | boolean | `false` = eliminado lógicamente |

### Tabla `bovedaAudit`
Log inmutable de acciones en la bóveda.

| Campo | Notas |
|---|---|
| `accion` | `CREAR`, `EDITAR`, `REVELAR`, `REVELAR_FALLIDO`, `ELIMINAR` |
| `sistemaId` | rowKey del sistema afectado |
| `sistemaNombre` | Nombre en el momento de la acción |
| `usuarioId`, `usuarioNombre` | Quién realizó la acción |
| `fecha` | ISO timestamp |

### Tabla en Supabase PostgreSQL: `usuarios_sistema`
Cuentas de acceso al portal IT (no confundir con la tabla `usuarios` de Azure).

```sql
id              serial PRIMARY KEY
nombre          text
usuario         text UNIQUE   -- login name
contrasena_hash text          -- bcrypt hash
rol             text          -- 'admin', 'it_admin', 'it_soporte', 'it_lectura'
activo          boolean
ultimo_acceso   timestamp
```

---

## 5. Autenticación y roles

### Flujo de autenticación
1. Usuario hace POST a `/api/login` con `{usuario, contrasena}`
2. Se verifica contra Supabase con bcrypt
3. Se devuelve un JWT firmado con `JWT_SECRET`
4. El frontend guarda el token en `sessionStorage.getItem('plg_session')`
5. Todas las llamadas API incluyen `X-PLG-Auth: <token>` en el header
6. El API verifica con `verifyToken(req)` de `api/lib/auth.js`

### Datos del JWT
```javascript
{ id, nombre, usuario, rol }
```

### Roles actuales
| Rol | Acceso |
|---|---|
| `admin` | Todo — usuarios, inventario, bóveda, admin, auditoría |
| `it_admin` | Igual a admin en inventario y bóveda |
| `it_soporte` | Puede agregar/editar en bóveda; no puede eliminar ni ver auditoría |
| `it_lectura` | Solo lectura en bóveda; sin contraseñas |

### Verificar rol en un API nuevo
```javascript
const { verifyToken } = require('../lib/auth');
const user = verifyToken(req);
if (!user) return context.res = { status: 403, ... };
if (user.rol !== 'admin') return context.res = { status: 403, ... };
```

### Verificar sesión en HTML nuevo
```html
<script>(function(){if(!sessionStorage.getItem('plg_session'))location.replace('/login.html');})()</script>
```

### Header de auth en fetch del frontend
```javascript
function authH() {
  return { 'Content-Type':'application/json', 'X-PLG-Auth': sessionStorage.getItem('plg_session')||'' };
}
```

---

## 6. Endpoints API

### `/api/usuarios` — Perfil de usuarios IT
- `GET` → lista todos los usuarios (sin autenticación requerida — acceso interno)
- `POST` → crear usuario `{nombre (req), division, area, puesto, ...}`
- `PUT?id=USR-xxx` → actualizar perfil. **NUNCA toca `cuentas`** (ver bug #1)
- `DELETE?id=USR-xxx` → eliminar usuario

**Estrategia Azure Tables:** `Merge` (solo actualiza los campos enviados)

**Regla crítica en PUT:** Los campos `cuentas`, `equipos`, `accesosFisicos` tienen guardias:
- `cuentas` se extrae y se ignora completamente (`const { cuentas: _ignorar, ...bSinCuentas } = b`)
- `equipos` solo se incluye en la entidad si `'equipos' in b` (guard explícito)
- `accesosFisicos` igual: solo si `'accesosFisicos' in b`

### `/api/cuentas-usuario` — Cuentas por usuario (endpoint dedicado)
- `GET?id=USR-xxx` → devuelve array `[{sistema, usuario, pass}]`
- `PUT?id=USR-xxx` → reemplaza SOLO el campo `cuentas` (Merge), nunca toca el resto

**Este endpoint existe porque:** un PUT parcial a `/api/usuarios` no puede jamás borrar las cuentas.

### `/api/inventario` — Equipos físicos
- `GET` → lista todos los equipos
- `POST` → crear equipo `{tipo (req), serial (req), marca, modelo, estado, ...}`
- `PUT?id=INV-xxx` → actualizar equipo. Usa `body.campo ?? existing.campo` para preservar campos no enviados
- `DELETE?id=INV-xxx` → eliminar equipo (borrado físico)

**Estrategia Azure Tables:** `Replace` con fallback `??` — siempre envía todos los campos con valor actual si no se especifica uno nuevo.

### `/api/boveda` — Sistemas y credenciales IT
- Requiere JWT válido con rol `it_lectura` o superior
- `GET` → lista sistemas activos (sin contraseñas — `tienePass: boolean`)
- `POST` → crear sistema (requiere `it_soporte` o superior)
- `PUT?id=SIS-xxx` → editar sistema (requiere `it_soporte` o superior)
- `DELETE?id=SIS-xxx` → borrado lógico `{activo: false}` (requiere `admin` o `it_admin`)

### `/api/boveda-reauth` — Revelar contraseña
- `POST {sistemaId, password}` — verifica contraseña del usuario vs Supabase, devuelve contraseña descifrada
- Registra en `bovedaAudit` tanto éxitos como fallos
- Requiere JWT válido

### `/api/boveda-audit` — Auditoría bóveda
- `GET` → log de auditoría (solo `admin` o `it_admin`)

### `/api/colaboradores` — Directorio M365
- `GET` → colaboradores de M365 via Graph API. Param `?nofoto=1` para omitir fotos.

---

## 7. Patrones de frontend

### Carga en paralelo (patrón en `inventario.html`)
Los tres loaders corren en paralelo al iniciar la página:
```javascript
cargarUsuarios();      // → usuarios[]
iniciarBusquedaDir(); // → _colabs[] (directorio M365)
cargarEquiposData();  // → equipos[] (inventario)
```
Cada uno llama `filtrarUsuarios()` al terminar. `enlazarEquiposLegacy()` corre cuando AMBOS `_usuariosListos` y `_equiposDatos` son `true`.

### Fuente de verdad para equipos por usuario — `_eqArr(u)`
```
Prioridad 1: inventario por usuarioId  ← ÚNICA FUENTE CONFIABLE
Prioridad 2: inventario por nombre (legacy, pre-migración)
Prioridad 3: u.equipos[] (campo en usuario — LEGACY, posiblemente vacío)
Prioridad 4: campos planos laptopModelo, monitorModelo, etc.
```
**Nunca usar `u.equipos` directamente en código nuevo.** Siempre usar `_eqArr(u)`.

### Auto-enlace de equipos legacy — `enlazarEquiposLegacy()`
Se ejecuta una vez por sesión. Busca equipos con `usuarioActual` pero sin `usuarioId`, los enlaza por nombre normalizado, actualiza localmente para mostrar inmediato, y guarda `usuarioId` en servidor permanentemente. Normalización: `.normalize('NFD').replace(/[̀-ͯ]/g,'')` para resistir acentos.

### Deep copy de arrays al abrir formularios
**Siempre usar copia profunda** al cargar arrays en formularios. Referencia directa causa mutaciones silenciosas:
```javascript
// CORRECTO:
_cuentasForm = (u.cuentas||[]).map(function(c){ return Object.assign({},c); });

// INCORRECTO (modifica u.cuentas en memoria):
_cuentasForm = u.cuentas;
```

### Header nav estándar
Todos los módulos IT comparten este patrón de nav:
```html
<a href="index.html"          class="nav-tab">🏠 Portal Principal</a>
<a href="inventario.html"     class="nav-tab">💻 Inventario IT</a>
<a href="tickets.html"        class="nav-tab">🎫 Tickets IT</a>
<a href="boveda.html"         class="nav-tab">🔐 Bóveda IT</a>
<a href="admin-usuarios.html" class="nav-tab" id="nav-admin" style="display:none">⚙️ Admin</a>
```
Agregar la clase `activo` al tab de la página actual. El tab Admin se muestra con JS:
```javascript
if(sessionStorage.getItem('plg_rol')==='admin') document.getElementById('nav-admin').style.display='';
```

### Paleta de colores PLG
```css
--navy: #1B3A6B   /* títulos, headers, botones principales */
--blue: #2F5AA8   /* links, hover states */
--red:  #CC1F2A   /* acento, borde del header, estados de error */
--bg:   #F0F4F9   /* fondo de página */
```

---

## 8. Bugs resueltos — NO repetir

### Bug #1 — PUT parcial borra campos JSON (CRÍTICO)
**Qué pasó:** `sincronizarCelularesDir()` hacía `PUT /api/usuarios` con solo `{celular: "..."}`. El API construía la entidad incluyendo `cuentas: (undefined || '') = ''`, y con estrategia `Merge` sobrescribía el campo `cuentas` con cadena vacía. Se perdieron las cuentas de ~50 usuarios.

**El mismo bug afectó también `equipos`:** el campo `u.equipos[]` también quedó vacío para esos usuarios.

**Fix aplicado en `api/usuarios/index.js` PUT:**
```javascript
// cuentas: SIEMPRE ignorar — se gestiona solo desde /api/cuentas-usuario
const { cuentas: _ignorar, ...bSinCuentas } = b;

// equipos y accesosFisicos: SOLO incluir si vienen en el body
if ('equipos' in b)        entity.equipos        = ...
if ('accesosFisicos' in b) entity.accesosFisicos = ...
```

**Regla:** En cualquier PUT de usuarios, campos JSON (`cuentas`, `equipos`, `accesosFisicos`) NUNCA se incluyen en la entidad si no están explícitamente en el body. El guard `'campo' in b` es obligatorio.

---

### Bug #2 — Equipos desaparecen al refrescar página
**Qué pasó:** El bug #1 vació `u.equipos[]` en Table Storage. Los ítems de inventario legacy no tenían `usuarioId` (solo `usuarioActual` por nombre). `_eqArr()` prioridad 1 fallaba (sin `usuarioId`), prioridad 2 fallaba si el nombre no coincidía exactamente (acentos, espacios), prioridad 3 fallaba (`u.equipos` = []). Al refrescar, se cargaban datos frescos de Table Storage → sin equipos.

**Fix aplicado:** `enlazarEquiposLegacy()` en `inventario.html`:
- Corre una vez por sesión cuando ambos loaders terminan
- Normaliza nombres (sin acentos, lowercase) para el match
- Actualiza `usuarioId` localmente (render inmediato) y en servidor (fix permanente)
- Después del primer refresco, todos los ítems tienen `usuarioId` → prioridad 1 siempre funciona

---

### Bug #3 — Form de cuentas modifica datos en memoria al cancelar
**Qué pasó:** `_cuentasForm = u.cuentas` asignaba la misma referencia. Agregar/quitar cuentas en el form mutaba `u.cuentas` aunque el usuario cancelara. Al reabrir el form, la lista estaba "corrupta".

**Fix:** Deep copy al abrir el form:
```javascript
_cuentasForm = (u.cuentas||[]).map(function(c){ return Object.assign({},c); });
```

---

### Bug #4 — Errores silenciosos en cargarEquiposData
**Qué pasó:** El catch tenía un comentario vacío. Si la API de inventario fallaba, `equipos = []` y no se veía ningún error en consola. Los equipos no se mostraban y no había forma de diagnosticar.

**Fix:**
```javascript
} catch(e) {
  console.error('cargarEquiposData:', e.message);
}
```

---

## 9. Reglas invariantes

Estas reglas **nunca se pueden violar** sin entender completamente las consecuencias:

1. **`cuentas` solo via `/api/cuentas-usuario`** — Ningún otro endpoint puede escribir ese campo. Si un nuevo endpoint de usuarios necesita hacer un PUT, debe usar el mismo patrón de guard que el actual.

2. **Inventario es la fuente de verdad de equipos** — Nunca confiar en `u.equipos[]` para lógica nueva. Siempre usar `_eqArr(u)` que lee de la tabla `inventario`.

3. **PUT de inventario usa `??` (fallback al existing)** — El PUT de `/api/inventario` siempre lee el registro existente y hace `body.campo ?? existing.campo`. Nunca usar Merge en inventario (puede dejar campos vacíos si se omiten).

4. **PUT de usuarios usa Merge** — Correcto para usuarios porque los campos JSON tienen guards `'in b'`. No cambiar a Replace sin revisar todos los callers.

5. **Contraseñas de bóveda SIEMPRE cifradas** — Nunca guardar `pass` en texto plano en Table Storage. La función `encrypt()` en `/api/boveda/index.js` es obligatoria.

6. **Reauth antes de revelar contraseña** — Nunca devolver una contraseña descifrada desde `/api/boveda` GET. Solo `/api/boveda-reauth` POST puede devolver contraseñas, y solo tras verificar credenciales contra Supabase.

7. **Auditoría no falla el flujo** — El bloque `logAudit()` está en try/catch propio. Un error de auditoría nunca debe romper la operación principal.

---

## 10. Cómo agregar funcionalidades nuevas

### Nuevo módulo HTML
1. Copiar el header/nav de `inventario.html` o `boveda.html`
2. Agregar el check de sesión al inicio: `<script>(function(){if(!sessionStorage.getItem('plg_session'))location.replace('/login.html');})()</script>`
3. Agregar el nuevo archivo a `staticwebapp.config.json` routes
4. Agregar el link de nav en **todos** los módulos existentes

### Nuevo endpoint API
1. Crear carpeta `api/nombre-endpoint/`
2. Copiar `function.json` de un endpoint existente, ajustar `methods`
3. Siempre incluir manejo de OPTIONS (CORS preflight):
   ```javascript
   if (req.method === "OPTIONS") {
     context.res = { status: 200, headers: CORS, body: "" };
     return;
   }
   ```
4. Si requiere auth: `const user = verifyToken(req); if (!user) return 403;`
5. Siempre usar `try/catch` y devolver error 500 con `e.message`

### Nuevo campo JSON en tabla `usuarios`
Si el campo puede ser modificado por un PUT parcial:
1. En `api/usuarios/index.js` PUT, agregar guard: `if ('nuevoCampo' in b) entity.nuevoCampo = ...`
2. Documentar aquí qué formato usa el campo

### Nuevo campo en tabla `inventario`
1. Agregar a `entityToItem()` en `api/inventario/index.js`
2. En PUT, agregar `nuevoCampo: body.nuevoCampo ?? existing.nuevoCampo ?? ""`
3. Si es un campo de asignación a usuario, asegurarse de que `usuarioId` se setee correctamente

### Modificar sincronizarCelularesDir
Esta función corre automáticamente al cargar la página. **Cualquier campo** que se envíe en el PUT de usuarios desde aquí debe tener un guard en el API. Actualmente solo envía `{celular}` que es un campo simple (no JSON), por lo que no requiere guard.

---

## Historial de cambios mayores

| Fecha | Cambio |
|---|---|
| 2026-07 | Fix: PUT parcial de usuario ya no borra cuentas/equipos/accesosFisicos |
| 2026-07 | Refactor: cuentas separadas a endpoint dedicado `/api/cuentas-usuario` |
| 2026-07 | Fix: deep copy de cuentas al abrir formulario |
| 2026-07 | Feat: botón de recuperación masiva de cuentas borradas por sync |
| 2026-07 | Fix: enlace automático de equipos legacy (sin usuarioId) al cargar |
| 2026-07 | Feat: Bóveda de Accesos IT con cifrado AES-256-GCM y auditoría |
