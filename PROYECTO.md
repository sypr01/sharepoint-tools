# Portal Interno PLG — Documentación del Proyecto

## Descripción
Portal interno para Panamerican Logistics Group (PLG). Implementado como Azure Static Web App con autenticación Microsoft 365 (Entra ID). Cada usuario ve solo el contenido de su división y departamento.

---

## URLs

| Recurso | URL |
|---|---|
| Portal (producción) | https://nice-mud-0d1acad10.7.azurestaticapps.net/portal-plg.html |
| Directorio de colaboradores | https://nice-mud-0d1acad10.7.azurestaticapps.net/directorio-colaboradores.html |
| SharePoint Portal PLG | https://plggroup.sharepoint.com/sites/PortalPLG |

---

## Arquitectura

```
Usuario (Edge/Chrome)
    │
    ▼
Azure Static Web App (nice-mud-0d1acad10.7.azurestaticapps.net)
    │
    ├── portal-plg.html          ← Frontend principal
    ├── directorio-colaboradores.html
    ├── staticwebapp.config.json ← Rutas + protección auth
    │
    └── /api/me (Azure Function)
            │
            ▼
        Microsoft Graph API
        (perfil usuario + grupos M365)
```

### Autenticación
- **Proveedor**: Azure SWA built-in Entra ID (Microsoft 365)
- **Login**: `/.auth/login/aad` → redirige a login de Microsoft
- **Logout**: `/.auth/logout?post_logout_redirect_uri=/.auth/login/aad...`
- **Token SWA**: header `x-ms-client-principal` (base64) contiene email del usuario
- **Graph API**: usa client credentials flow (app token), NO delegated

> ⚠️ No usar MSAL — fue abandonado porque Edge Tracking Prevention bloquea el almacenamiento de CDN de terceros.

---

## Archivos clave

### `portal-plg.html`
Frontend completo del portal. Incluye:
- Header con logo PLG, nombre de usuario, división, departamento, fecha y botón cerrar sesión
- Barra de búsqueda
- Accesos rápidos: Outlook, Teams, Sistema (Magaya), Power BI, Tracking
- Grid de departamentos (accesibles o bloqueados según perfil)
- Directorio de colaboradores mini
- Columna derecha: Anuncios, Cumpleaños, Documentos

### `api/me/index.js`
Azure Function que:
1. Lee el email del usuario desde el header `x-ms-client-principal`
2. Obtiene token de app via client credentials
3. Llama a Graph API para obtener perfil del usuario (`displayName`, `department`, `officeLocation`, etc.)
4. Obtiene grupos del usuario (`/memberOf`) para derivar división/departamento si los campos de perfil están vacíos
5. Devuelve `{ user, colegas }`

### `staticwebapp.config.json`
- Protege `/portal-plg.html` con rol `authenticated`
- Redirige 401 → login Microsoft

---

## Lógica de acceso

### Admin (Informática)
- Condición: `department` contiene "informatica" (con o sin acento)
- Ve **todas las divisiones** y **todos los departamentos** desbloqueados

### Usuario regular
- Requiere que `officeLocation` (Oficina en M365) **Y** `department` (Departamento en M365) estén configurados
- Si falta alguno → pantalla de **Acceso no autorizado** (no puede entrar)
- Si ambos presentes → ve **solo su división** con **solo su departamento** desbloqueado; el resto con 🔒

### Comparación de departamento
Usa `.includes()` para manejar variaciones:
- M365 tiene `"DEPARTAMENTO DE FINANZAS"` → incluye `"finanzas"` → acceso al tile "Finanzas" ✅

---

## Divisiones y departamentos configurados

```javascript
const DIVISION_DEPTS = {
  "PLG DE EL SALVADOR":     ["Operaciones","Comercial","Finanzas","Pricing","Coordinación","RRHH","Informática","Administración"],
  "PLG DIVISION ADUANAS":   ["Operaciones","Comercial","Finanzas","Pricing","Coordinación","RRHH","Administración"],
  "PLG DIVISION TERRESTRE":  ["Operaciones","Comercial","Finanzas","Coordinación","RRHH","Administración"],
  "PLG DOMINICANA":         ["Operaciones","Comercial","Finanzas","RRHH","Administración"]
};
```

---

## Configuración en M365 por usuario

Para que un usuario pueda acceder al portal, debe tener configurados en el **Admin Center de Microsoft 365 → Usuarios → [usuario] → Información de contacto**:

| Campo M365 | Valor esperado | Ejemplo |
|---|---|---|
| **Oficina** (`officeLocation`) | Nombre exacto de la división | `PLG DE EL SALVADOR` |
| **Departamento** (`department`) | Nombre del departamento | `Finanzas` |

> El campo Oficina debe ser **exactamente** uno de los 4 valores de división. El departamento puede incluir palabras adicionales (ej: "DEPARTAMENTO DE FINANZAS") y seguirá funcionando.

---

## Credenciales de la app (Azure AD)

| Variable | Valor |
|---|---|
| TENANT_ID | `ddfac243-a888-4ed6-8fb0-bc8557897b74` |
| CLIENT_ID | `fa3f52ca-277a-4eae-ad71-cb248934def6` |
| CLIENT_SECRET | En GitHub Secrets como `CLIENT_SECRET` |

Permisos de la app en Graph API:
- `User.Read.All` (application) — leer perfiles de usuarios
- `GroupMember.Read.All` (application) — leer membresías de grupos

---

## Colores corporativos PLG

| Color | Hex |
|---|---|
| Navy (primario) | `#1B3A6B` |
| Azul medio | `#2F5AA8` |
| Rojo (acento) | `#CC1F2A` |

---

## Problemas resueltos

| Problema | Solución |
|---|---|
| MSAL bloqueado por Edge Tracking Prevention | Abandonar MSAL; usar SWA built-in auth (`/.auth/login/aad`) |
| Logo con espacio en nombre de archivo | URL encode: `log%20PLG.png` |
| Deploy fallaba con bloque `"auth"` en config | Configurar auth vía Azure Portal → SWA → Autenticación |
| Logout redirigía a `login.html` de otro proyecto | Agregar `post_logout_redirect_uri` en URL de logout |
| Usuario sin `officeLocation` veía "PLG GROUP" y sin departamentos | Bloquear acceso si faltan campos; derivar desde grupos M365 si posible |
| `department = "DEPARTAMENTO DE FINANZAS"` no matcheaba tile "Finanzas" | Cambiar `===` por `.includes()` en comparación |

---

## Estado actual (30 junio 2026)

- ✅ Autenticación Microsoft 365 funcionando
- ✅ Perfil de usuario cargando desde Graph API
- ✅ Acceso por división y departamento implementado
- ✅ Admin (Informática) ve todo sin restricciones
- ✅ Usuarios sin perfil completo son bloqueados
- ✅ Botón cerrar sesión en header
- ✅ Logo PLG real en header
- ⬜ Probar con múltiples usuarios reales
- ⬜ Anuncios reales desde SharePoint News
- ⬜ Cumpleaños desde Microsoft 365
- ⬜ Embed del directorio en SharePoint
- ⬜ Configurar navegación SharePoint → 4 páginas de división
- ⬜ Migración futura a Next.js + Azure (largo plazo)

---

## Deploy

El deploy es automático vía GitHub Actions al hacer push a `master`.
- Repo: https://github.com/sypr01/sharepoint-tools
- Workflow: `.github/workflows/azure-static-web-apps-*.yml`
- Tiempo de deploy: ~2 minutos

Para verificar el estado del deploy: **GitHub → Actions** o **Azure Portal → Static Web Apps → Entornos**.
