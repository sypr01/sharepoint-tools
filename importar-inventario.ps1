# Script importar inventario desde NUEVO INVENTARIO 2026.xlsx
# Uso: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#      .\importar-inventario.ps1

$API_URL   = "https://nice-mud-0d1acad10.7.azurestaticapps.net/api/inventario"
$XLSX_PATH = "$env:USERPROFILE\Downloads\NUEVO INVENTARIO 2026.xlsx"

$importados = 0
$errores    = 0

function EsVacio($v) {
    if (-not $v) { return $true }
    $v = $v.Trim().ToUpper()
    return ($v -eq "" -or $v -eq "NO POSEE" -or $v -eq "*" -or $v -eq "N/A" -or $v -eq "-")
}

function PostEquipo($tipo, $marca, $modelo, $serial, $estado, $division, $usuario, $area, $notas) {
    if (EsVacio $serial) { return }
    $body = @{
        tipo            = $tipo
        marca           = if ($marca) { $marca.Trim() } else { "" }
        modelo          = if ($modelo) { $modelo.Trim() } else { "" }
        serial          = $serial.Trim()
        estado          = $estado
        division        = $division
        usuarioActual   = if ($usuario) { $usuario.Trim() } else { "" }
        usuarioAnterior = ""
        notas           = if ($notas) { $notas.Trim() } else { "" }
    } | ConvertTo-Json -Compress

    try {
        Invoke-RestMethod -Uri $API_URL -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop | Out-Null
        $script:importados++
        if ($script:importados % 20 -eq 0) { Write-Host "  $($script:importados) equipos importados..." -ForegroundColor Green }
    } catch {
        $script:errores++
        Write-Host "  Error ($tipo $serial): $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "Abriendo Excel: $XLSX_PATH" -ForegroundColor Cyan
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($XLSX_PATH)

# Mapeo de columnas por hoja (col indices 1-based)
# ADUANAS, EL SALVADOR, DOMINICANA tienen la misma estructura base
# TERRESTRE tiene columnas desplazadas

$mapas = @{
    "PLG DIVISION ADUANAS" = @{
        div="PLG DIVISION ADUANAS"; nombre=1; area=4
        eqNom=21; eqSerie=22; eqMem=30; eqObs=34
        monNom=40; monSerie=41
        celNom=49; celImei=50
        tabCheck=51; tabMod=52; tabImei=53
    }
    "PLG DE EL SALVADOR" = @{
        div="PLG DE EL SALVADOR"; nombre=1; area=4
        eqNom=21; eqSerie=22; eqMem=30; eqObs=34
        monNom=40; monSerie=41
        celNom=49; celImei=50
        tabCheck=51; tabMod=52; tabImei=53
    }
    "PLG DOMINICANA" = @{
        div="PLG DOMINICANA"; nombre=1; area=4
        eqNom=21; eqSerie=22; eqMem=30; eqObs=34
        monNom=40; monSerie=41
        celNom=49; celImei=50
        tabCheck=52; tabMod=53; tabImei=54
    }
    "PLG DIVISION TERRESTRE" = @{
        div="PLG DIVISION TERRESTRE"; nombre=1; area=4
        eqNom=38; eqSerie=39; eqMem=26; eqObs=30
        monNom=35; monSerie=36
        celNom=44; celImei=45
        tabCheck=46; tabMod=47; tabImei=48
    }
}

foreach ($sheetName in $mapas.Keys) {
    $ws = $null
    try { $ws = $wb.Worksheets[$sheetName] } catch {}
    if (-not $ws) { Write-Host "Hoja no encontrada: $sheetName" -ForegroundColor Yellow; continue }

    $m = $mapas[$sheetName]
    $lastRow = $ws.UsedRange.Rows.Count
    Write-Host "`nImportando $sheetName ($lastRow filas)..." -ForegroundColor Yellow

    for ($r = 3; $r -le $lastRow; $r++) {
        $nombre = $ws.Cells($r, $m.nombre).Text.Trim()
        if (-not $nombre) { continue }

        $area   = $ws.Cells($r, $m.area).Text.Trim()
        $eqNom  = $ws.Cells($r, $m.eqNom).Text.Trim()
        $eqSer  = $ws.Cells($r, $m.eqSerie).Text.Trim()
        $eqMem  = $ws.Cells($r, $m.eqMem).Text.Trim()
        $eqObs  = $ws.Cells($r, $m.eqObs).Text.Trim()
        $monNom = $ws.Cells($r, $m.monNom).Text.Trim()
        $monSer = $ws.Cells($r, $m.monSerie).Text.Trim()
        $celNom = $ws.Cells($r, $m.celNom).Text.Trim()
        $celIm  = $ws.Cells($r, $m.celImei).Text.Trim()
        $tabChk = $ws.Cells($r, $m.tabCheck).Text.Trim()
        $tabMod = $ws.Cells($r, $m.tabMod).Text.Trim()
        $tabIm  = $ws.Cells($r, $m.tabImei).Text.Trim()

        # Determinar marca y modelo del equipo
        $marca  = ""
        $modelo = $eqNom
        if ($eqNom -match "^(LENOVO|DELL|HP|APPLE|MAC|SAMSUNG|ASUS|ACER|MSI)\s+(.+)$") {
            $marca  = $matches[1]
            $modelo = $matches[2]
        } elseif ($eqNom -match "^(Lenovo|Dell|HP|Apple|Samsung|Asus|Acer)\s+(.+)$") {
            $marca  = $matches[1]
            $modelo = $matches[2]
        }

        $notasEq = if ($eqObs -and $eqMem) { "RAM: $eqMem | $eqObs" } elseif ($eqMem) { "RAM: $eqMem" } elseif ($eqObs) { $eqObs } else { "" }

        # Laptop
        PostEquipo "Laptop" $marca $modelo $eqSer "Bueno" $m.div $nombre $area $notasEq

        # Monitor
        if (-not (EsVacio $monSer)) {
            $monMarca = ""
            $monMod   = $monNom
            if ($monNom -match "^(SAMSUNG|SAMSUMG|LENOVO|DELL|LG|XIAOMI|AOC|HP|VIEWSONIC)\s*(.*)$") {
                $monMarca = $matches[1] -replace "SAMSUMG","SAMSUNG"
                $monMod   = $matches[2]
            }
            PostEquipo "Monitor" $monMarca $monMod $monSer "Bueno" $m.div $nombre $area ""
        }

        # Celular
        if (-not (EsVacio $celIm)) {
            $celMarca = ""
            $celMod   = $celNom
            if ($celNom -match "^(GALAXY|IPHONE|HONOR|HUAWEI)") { $celMarca = "SAMSUNG" }
            if ($celNom -match "^(IPHONE)") { $celMarca = "APPLE" }
            if ($celNom -match "^(HONOR)") { $celMarca = "HONOR" }
            PostEquipo "Celular" $celMarca $celMod $celIm "Bueno" $m.div $nombre $area ""
        }

        # Tablet
        if (-not (EsVacio $tabChk) -and $tabChk.ToUpper() -ne "NO POSEE") {
            $tabSerie = if (-not (EsVacio $tabIm)) { $tabIm } else { $tabMod }
            if (-not (EsVacio $tabSerie)) {
                PostEquipo "Tablet" "" $tabMod $tabSerie "Bueno" $m.div $nombre $area ""
            }
        }
    }
}

# Equipos descartados / dados de baja
$wsBaja = $null
try { $wsBaja = $wb.Worksheets["EQUIPO DESCARTADO"] } catch {}
if ($wsBaja) {
    Write-Host "`nImportando EQUIPO DESCARTADO..." -ForegroundColor Yellow
    $lastRow = $wsBaja.UsedRange.Rows.Count
    for ($r = 2; $r -le $lastRow; $r++) {
        $tipo  = $wsBaja.Cells($r, 3).Text.Trim()
        $marca = $wsBaja.Cells($r, 4).Text.Trim()
        $serie = $wsBaja.Cells($r, 5).Text.Trim()
        $div   = $wsBaja.Cells($r, 6).Text.Trim()
        $obs   = $wsBaja.Cells($r, 7).Text.Trim()
        $user  = $wsBaja.Cells($r, 2).Text.Trim()

        if (-not $tipo -or -not $serie) { continue }

        $divNorm = ""
        $div = $div.ToUpper()
        if ($div -eq "AD")      { $divNorm = "PLG DIVISION ADUANAS" }
        elseif ($div -eq "SV")  { $divNorm = "PLG DE EL SALVADOR" }
        elseif ($div -eq "TR")  { $divNorm = "PLG DIVISION TERRESTRE" }
        elseif ($div -eq "DO")  { $divNorm = "PLG DOMINICANA" }
        else                    { $divNorm = $div }

        PostEquipo $tipo $marca "" $serie "Baja" $divNorm $user "" $obs
    }
}

$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null

Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "Importacion completada" -ForegroundColor Green
Write-Host "  Importados : $importados" -ForegroundColor Green
if ($errores -gt 0) {
    Write-Host "  Errores    : $errores" -ForegroundColor Red
} else {
    Write-Host "  Errores    : $errores" -ForegroundColor Green
}
Write-Host "==============================" -ForegroundColor Cyan
