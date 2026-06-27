# Script para importar inventario desde Excel a Azure Table Storage
# Ejecutar UNA SOLA VEZ despues de hacer deploy de la API
#
# Uso: .\importar-inventario.ps1

$API_URL   = "https://nice-mud-0d1acad10.7.azurestaticapps.net/api/inventario"
$XLSX_PATH = "$env:USERPROFILE\Desktop\Copia de inventario 2025.xlsx"

Write-Host "Abriendo Excel..." -ForegroundColor Cyan
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($XLSX_PATH)

$importados = 0
$errores    = 0

# Mapeo de divisiones del Excel al formato del sistema
function NormalizarDivision($d) {
    $d = ($d ?? "").Trim().ToUpper()
    if ($d -match "ADUANAS")    { return "PLG DIVISION ADUANAS" }
    if ($d -match "TERRESTRE")  { return "PLG DIVISION TERRESTRE" }
    if ($d -match "DOMINICANA") { return "PLG DOMINICANA" }
    if ($d -match "EL SALVADOR|SV") { return "PLG DE EL SALVADOR" }
    if ($d -match "GROUP|PLG AD") { return "PLG GROUP" }
    return $d
}

function NormalizarEstado($e) {
    $e = ($e ?? "").Trim().ToUpper()
    if ($e -match "BUEN|GOOD|OK")        { return "Bueno" }
    if ($e -match "DISPONIBLE|LIBRE")    { return "Disponible" }
    if ($e -match "BAJA|RETIRAD")        { return "Baja" }
    if ($e -match "REPARAC|MANTEN")      { return "Reparacion" }
    if ($e)                               { return "Bueno" }
    return "Bueno"
}

# ── Importar hoja INVENTARIO 2025 ────────────────────────────────────────────
Write-Host "`nImportando INVENTARIO 2025..." -ForegroundColor Yellow
$ws = $wb.Worksheets["INVENTARIO 2025"]
$lastRow = $ws.UsedRange.Rows.Count

for ($r = 3; $r -le $lastRow; $r++) {
    $tipo     = $ws.Cells($r, 2).Text.Trim()
    $marca    = $ws.Cells($r, 3).Text.Trim()
    $modelo   = $ws.Cells($r, 4).Text.Trim()
    $serial   = $ws.Cells($r, 5).Text.Trim()
    $estado   = $ws.Cells($r, 6).Text.Trim()
    $division = $ws.Cells($r, 7).Text.Trim()
    $anterior = $ws.Cells($r, 8).Text.Trim()
    $actual   = $ws.Cells($r, 9).Text.Trim()
    $notas    = $ws.Cells($r, 10).Text.Trim()

    if (-not $tipo -or -not $serial) { continue }

    $body = @{
        tipo            = $tipo
        marca           = $marca
        modelo          = $modelo
        serial          = $serial
        estado          = NormalizarEstado $estado
        division        = NormalizarDivision $division
        usuarioAnterior = $anterior
        usuarioActual   = $actual
        notas           = if ($notas) { "$estado | $notas" } else { $estado }
    } | ConvertTo-Json -Compress

    try {
        $res = Invoke-RestMethod -Uri $API_URL -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
        $importados++
        if ($importados % 50 -eq 0) { Write-Host "  $importados equipos importados..." -ForegroundColor Green }
    } catch {
        $errores++
        Write-Host "  Error fila $r : $($_.Exception.Message)" -ForegroundColor Red
    }
}

$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null

Write-Host "`n==============================" -ForegroundColor Cyan
Write-Host "Importacion completada" -ForegroundColor Green
Write-Host "  Importados : $importados" -ForegroundColor Green
Write-Host "  Errores    : $errores"    -ForegroundColor $(if ($errores -gt 0) { "Red" } else { "Green" })
Write-Host "==============================`n" -ForegroundColor Cyan
Write-Host "Abre: $API_URL para verificar" -ForegroundColor Yellow
