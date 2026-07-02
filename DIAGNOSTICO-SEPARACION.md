# Diagnóstico Técnico — Separación Portal PLG / IT Support
**Fecha:** 2 julio 2026  
**Elaborado por:** Arquitectura TI — PLG  
**Estado:** Aprobado para ejecución

---

## 1. Causa raíz del conflicto

### Situación encontrada
Dos sistemas con arquitecturas de autenticación incompatibles compartiendo un único Azure Static Web App (SWA):

| Sistema | Autenticación | Sesión | Entrada |
|---|---|---|---|
| **IT Support** | Login propio (`/api/login`) con usuario y contraseña | `sessionStorage` (`plg_session`, `plg_token`) | `index.html` → `login.html` |
| **Portal PLG** | Microsoft Entra ID (`/.auth/login/aad`) nativo de SWA | Cookie segura gestionada por Azure | `portal-plg.html` |

### Por qué colisionan
Azure Static Web Apps tiene un único archivo de configuración global (`staticwebapp.config.json`) que aplica a **todas** las rutas del dominio sin excepción.

El bloque `responseOverrides` configurado para el Portal PLG:
```json
"responseOverrides": {
  "401": {
    "redirect": "/.auth/login/aad?post_login_redirect_uri=/portal-plg.html",
    "statusCode": 302
  }
}
```
Intercepta **cualquier respuesta 401** del SWA — incluyendo las del IT Support — y redirige al login de Microsoft. El usuario del IT Support, que usa credenciales propias, es enviado a un flujo de autenticación que no corresponde a su sistema, resultando en un error de acceso.

Adicionalmente, el `navigationFallback` reescribe rutas no reconocidas hacia `index.html` (IT Support), lo que puede capturar rutas del Portal PLG en ciertos escenarios.

---

## 2. Por qué dos sistemas de auth no deben compartir el mismo SWA

### Principio de aislamiento de seguridad
Cada sistema de autenticación define su propio perímetro de confianza. Mezclarlos en un mismo dominio y configuración crea los siguientes problemas estructurales:

**2.1 Configuración global no aislable**  
`staticwebapp.config.json` no permite reglas de autenticación condicionales por subsistema. Todo lo que se define aplica al dominio completo.

**2.2 Cookies y tokens compartidos**  
El SWA built-in auth de Entra ID almacena sus tokens en cookies del dominio `*.azurestaticapps.net`. El IT Support usa `sessionStorage`. Ambos coexisten en el mismo origen (`nice-mud-0d1acad10.7.azurestaticapps.net`), lo que puede causar:
- Lectura cruzada de storage entre sistemas
- Interferencia en el ciclo de vida de sesión
- Cierre de sesión de un sistema afectando al otro

**2.3 Interceptación de errores HTTP**  
Los `responseOverrides` (401, 403, 404) se aplican globalmente. No se puede definir "este 401 es del Portal PLG" vs "este 401 es del IT Support".

**2.4 Superficie de ataque ampliada**  
Un token válido de Entra ID en el dominio compartido podría en teoría acceder a rutas del IT Support que no fueron diseñadas para validar tokens JWT de Microsoft.

---

## 3. Riesgos de mantenerlos juntos

| Riesgo | Impacto | Probabilidad |
|---|---|---|
| El 401 del Portal rompe sesiones activas del IT Support | Alto — usuarios pierden trabajo no guardado | Alta |
| Cambio de configuración del Portal afecta IT Support | Alto — sistema en producción con usuarios activos | Alta |
| Logout del Portal cierra sesión global del dominio | Medio — afecta ambos sistemas | Media |
| Fuga de información entre sistemas por mismo origen | Alto — violación de principio de mínimo privilegio | Baja actualmente, crece con el tiempo |
| Imposibilidad de aplicar políticas de seguridad diferenciadas | Alto — IT Support y Portal tienen requisitos distintos | Certeza |
| Deploy de uno puede romper el otro | Alto — comparten pipeline de GitHub Actions | Alta |

---

## 4. Por qué un proyecto independiente es la solución

### Aislamiento total
Cada proyecto tiene su propio:
- Repositorio GitHub → pipeline de deploy independiente
- Azure Static Web App → dominio propio, configuración propia
- `staticwebapp.config.json` → reglas que aplican solo a ese sistema
- App Registration en Entra ID → permisos y roles propios
- Variables de entorno → secretos no compartidos

### Sin interferencia operacional
Un deploy del Portal PLG no puede afectar al IT Support. Un cambio de configuración de auth en el Portal no toca al IT Support. Los equipos pueden trabajar en paralelo sin riesgo de conflicto.

### Principio de responsabilidad única
Cada repo tiene un propósito claro y auditores/desarrolladores futuros entienden inmediatamente qué hace cada sistema sin necesidad de leer múltiples sistemas en el mismo código.

---

## 5. Configuración del nuevo Portal PLG

### Azure Static Web App
| Parámetro | Valor |
|---|---|
| Nombre | `portal-plg` (nuevo) |
| Región | East US 2 (o la más cercana al tenant PLG) |
| Plan | Free (o Standard si se necesitan roles custom) |
| Repositorio | `sypr01/portal-plg` (nuevo) |
| Rama | `main` |
| Auth provider | Microsoft (Entra ID) — Modo Sencillo |

### App Registration en Entra ID
| Parámetro | Valor |
|---|---|
| Nombre | `portal-plg-app` |
| Tipo de cuenta | Solo cuentas del directorio PLG (`plg.com.sv`) |
| Redirect URI | `https://[nueva-url].azurestaticapps.net/.auth/login/aad/callback` (tipo Web) |
| Permisos API | `User.Read.All` (application), `GroupMember.Read.All` (application) |
| Client Secret | Nuevo, guardado en GitHub Secrets y SWA Environment Variables |

### Variables de entorno requeridas
```
TENANT_ID     = ddfac243-a888-4ed6-8fb0-bc8557897b74
CLIENT_ID     = [nuevo o mismo si se reutiliza app registration]
CLIENT_SECRET = [nuevo secreto]
```

### staticwebapp.config.json del Portal PLG
```json
{
  "routes": [
    {
      "route": "/",
      "rewrite": "/portal-plg.html",
      "allowedRoles": ["authenticated"]
    },
    {
      "route": "/api/*",
      "allowedRoles": ["authenticated"]
    }
  ],
  "responseOverrides": {
    "401": {
      "redirect": "/.auth/login/aad?post_login_redirect_uri=/",
      "statusCode": 302
    }
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'"
  }
}
```

### Lógica de acceso por perfil (ya implementada)
- Usuario con `department = Informática` → acceso admin (todas las divisiones)
- Usuario con `officeLocation` + `department` configurados → acceso a su división y departamento
- Usuario sin perfil completo en M365 → pantalla de acceso no autorizado

---

## 6. Ventajas de esta arquitectura a futuro

### Escalabilidad
Cada módulo nuevo (CRM, logística, RRHH, reportes) puede desplegarse como su propio SWA o como ruta dentro del Portal PLG, sin afectar al IT Support ni a otros sistemas. La arquitectura soporta múltiples apps bajo el mismo tenant de Entra ID.

### Seguridad
- Cada app tiene su propio App Registration con permisos mínimos necesarios
- Los tokens de acceso están acotados al sistema que los generó
- Políticas de acceso condicional de Entra ID se pueden aplicar por app
- Auditoría de acceso separada por sistema en Azure Monitor / Sign-in logs

### Mantenimiento
- Deploys independientes — un cambio en el Portal no puede romper el IT Support
- Rollback independiente por sistema
- Equipos pueden trabajar en paralelo sin conflicto de ramas o configuración

### Módulos futuros planificados
| Módulo | Arquitectura sugerida |
|---|---|
| CRM Logístico | Módulo dentro del Portal PLG (`/crm/`) |
| Tracking de envíos | Módulo dentro del Portal PLG (`/tracking/`) |
| RRHH / Nómina | SWA independiente con roles propios |
| Reportes ejecutivos | Power BI Embedded dentro del Portal PLG |
| IT Support (mejora) | Migrar a Entra ID eliminando login propio |

### Trazabilidad
Con proyectos separados, cada repo tiene su propio historial de cambios, commits, y decisiones técnicas documentadas. Se sabe exactamente qué cambió, cuándo, y por qué en cada sistema.

---

## 7. Decisión aprobada

**Se procede a crear:**
1. Nuevo repositorio GitHub: `sypr01/portal-plg`
2. Nueva Azure Static Web App conectada al nuevo repo
3. Configuración de Entra ID apuntando al nuevo dominio

**IT Support permanece intacto** en `sypr01/sharepoint-tools` / `nice-mud-0d1acad10.7.azurestaticapps.net`.

---

*Documento generado como respaldo técnico antes de ejecutar la separación de proyectos.*
