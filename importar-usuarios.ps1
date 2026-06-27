# Script para importar usuarios desde NUEVO INVENTARIO 2026.xlsx
# Un registro por usuario con todos sus equipos y cuentas
# Uso: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#      .\importar-usuarios.ps1

$API_URL   = "https://nice-mud-0d1acad10.7.azurestaticapps.net/api/usuarios"
$XLSX_PATH = "$env:USERPROFILE\Downloads\NUEVO INVENTARIO 2026.xlsx"

$importados = 0
$errores    = 0

function Limpio($v) {
    if (-not $v) { return "" }
    $s = $v.Trim()
    $u = $s.ToUpper()
    if ($u -eq "NO POSEE" -or $u -eq "*" -or $u -eq "N/A" -or $u -eq "-" -or $u -eq "") { return "" }
    return $s
}

function EsVacio($v) {
    return ((Limpio $v) -eq "")
}

Write-Host "Abriendo Excel: $XLSX_PATH" -ForegroundColor Cyan
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($XLSX_PATH)

# ---------------------------------------------------------------
# Mapeo de columnas (1-based) por hoja
# ---------------------------------------------------------------
# ADUANAS / EL SALVADOR / DOMINICANA:
#   Col 1  = Nombre
#   Col 2  = AnyDesk
#   Col 3  = Hostname
#   Col 4  = Area/Depto
#   Col 5  = Puesto
#   Col 6  = Telefono
#   Col 7  = Extension
#   Col 8  = Correo Microsoft
#   Col 9  = Pass Microsoft
#   Col 10 = Correo Gmail
#   Col 11 = Pass Gmail
#   Col 12 = Usuario Magaya
#   Col 13 = Pass Magaya
#   Col 21 = Laptop modelo
#   Col 22 = Laptop serie
#   Col 40 = Monitor modelo
#   Col 41 = Monitor serie
#   Col 49 = Celular modelo
#   Col 50 = Celular IMEI
#   Col 52 = Tablet modelo
#   Col 53 = Tablet IMEI
#
# TERRESTRE: mismas cuentas (cols 1-13), equipos desplazados:
#   Col 38 = Laptop modelo
#   Col 39 = Laptop serie
#   Col 35 = Monitor modelo
#   Col 36 = Monitor serie
#   Col 44 = Celular modelo
#   Col 45 = Celular IMEI
#   Col 47 = Tablet modelo
#   Col 48 = Tablet IMEI
# ---------------------------------------------------------------

$mapas = @(
    [PSCustomObject]@{ hoja="PLG DIVISION ADUANAS";   div="PLG DIVISION ADUANAS";   lapMod=21; lapSer=22; monMod=40; monSer=41; celMod=49; celImei=50; tabMod=52; tabImei=53 }
    [PSCustomObject]@{ hoja="PLG DE EL SALVADOR";      div="PLG DE EL SALVADOR";      lapMod=21; lapSer=22; monMod=40; monSer=41; celMod=49; celImei=50; tabMod=52; tabImei=53 }
    [PSCustomObject]@{ hoja="PLG DOMINICANA";           div="PLG DOMINICANA";           lapMod=21; lapSer=22; monMod=40; monSer=41; celMod=49; celImei=50; tabMod=52; tabImei=53 }
    [PSCustomObject]@{ hoja="PLG DIVISION TERRESTRE";  div="PLG DIVISION TERRESTRE";  lapMod=38; lapSer=39; monMod=35; monSer=36; celMod=44; celImei=45; tabMod=47; tabImei=48 }
)

foreach ($m in $mapas) {
    $ws = $null
    try { $ws = $wb.Worksheets.Item($m.hoja) } catch {}
    if (-not $ws) {
        Write-Host "Hoja no encontrada: $($m.hoja)" -ForegroundColor Yellow
        continue
    }

    $lastRow = $ws.UsedRange.Rows.Count
    Write-Host "`nImportando $($m.hoja) ($lastRow filas)..." -ForegroundColor Yellow

    for ($r = 3; $r -le $lastRow; $r++) {
        $nombre = Limpio $ws.Cells($r, 1).Text
        if (EsVacio $nombre) { continue }

        $usuario = [PSCustomObject]@{
            nombre        = $nombre
            division      = $m.div
            area          = Limpio $ws.Cells($r, 4).Text
            puesto        = Limpio $ws.Cells($r, 5).Text
            telefono      = Limpio $ws.Cells($r, 6).Text
            extension     = Limpio $ws.Cells($r, 7).Text
            hostname      = Limpio $ws.Cells($r, 3).Text
            anydesk       = Limpio $ws.Cells($r, 2).Text
            microsoftEmail= Limpio $ws.Cells($r, 8).Text
            microsoftPass = Limpio $ws.Cells($r, 9).Text
            gmailEmail    = Limpio $ws.Cells($r, 10).Text
            gmailPass     = Limpio $ws.Cells($r, 11).Text
            magayaUser    = Limpio $ws.Cells($r, 12).Text
            magayaPass    = Limpio $ws.Cells($r, 13).Text
            laptopModelo  = Limpio $ws.Cells($r, $m.lapMod).Text
            laptopSerie   = Limpio $ws.Cells($r, $m.lapSer).Text
            monitorModelo = Limpio $ws.Cells($r, $m.monMod).Text
            monitorSerie  = Limpio $ws.Cells($r, $m.monSer).Text
            celularModelo = Limpio $ws.Cells($r, $m.celMod).Text
            celularImei   = Limpio $ws.Cells($r, $m.celImei).Text
            tabletModelo  = Limpio $ws.Cells($r, $m.tabMod).Text
            tabletImei    = Limpio $ws.Cells($r, $m.tabImei).Text
        }

        $body = $usuario | ConvertTo-Json -Compress

        try {
            Invoke-RestMethod -Uri $API_URL -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop | Out-Null
            $script:importados++
            Write-Host "  OK: $nombre" -ForegroundColor Green
        } catch {
            $script:errores++
            Write-Host "  Error ($nombre): $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Importacion completada" -ForegroundColor Green
Write-Host "  Usuarios importados : $importados" -ForegroundColor Green
if ($errores -gt 0) {
    Write-Host "  Errores             : $errores" -ForegroundColor Red
} else {
    Write-Host "  Errores             : 0" -ForegroundColor Green
}
Write-Host "======================================" -ForegroundColor Cyan
