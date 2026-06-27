$API_URL = "https://nice-mud-0d1acad10.7.azurestaticapps.net/api/inventario"

Write-Host "Obteniendo inventario..." -ForegroundColor Cyan
$items = Invoke-RestMethod -Uri $API_URL -Method GET

if ($items.Count -eq 0) {
    Write-Host "El inventario ya esta vacio." -ForegroundColor Green
    exit
}

Write-Host "Se eliminaran $($items.Count) equipos. Continuar? (S/N)" -ForegroundColor Yellow
$resp = Read-Host
if ($resp -ne "S" -and $resp -ne "s") { Write-Host "Cancelado."; exit }

$eliminados = 0
foreach ($item in $items) {
    try {
        Invoke-RestMethod -Uri "$API_URL`?id=$([uri]::EscapeDataString($item.id))" -Method DELETE -ErrorAction Stop | Out-Null
        $eliminados++
        if ($eliminados % 20 -eq 0) { Write-Host "  $eliminados/$($items.Count) eliminados..." -ForegroundColor Green }
    } catch {
        Write-Host "  Error eliminando $($item.id): $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "Listo. $eliminados equipos eliminados." -ForegroundColor Green
