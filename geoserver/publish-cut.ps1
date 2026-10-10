<#
  Publish the three years of parcel shapefiles from the "cut" folder to GeoServer,
  and apply geoserver/crop-style-10.sld (10 crop classes).

  Usage:
    powershell -ExecutionPolicy Bypass -File .\publish-cut.ps1

  Options:
    -Server    http://10.98.59.222:8080     GeoServer base URL
    -User      admin                        admin account
    -Workspace agri-agent                   target workspace
    -CutRoot   C:\Users\27814\Desktop\cut   folder containing 24 / 25 / 26
    -StyleFile .\crop-style-10.sld          SLD file

  Idempotent: re-running overwrites the same datastores / layers / style.
  Published layers: bh_crop_class_2024 / bh_crop_class_2025 / bh_crop_class_2026
#>

param(
    [string]$Server    = 'http://10.98.59.222:8080',
    [string]$User      = 'admin',
    [string]$Password  = 'geoserver',
    [string]$Workspace = 'agri-agent',
    [string]$CutRoot   = 'C:\Users\27814\Desktop\cut',
    [string]$StyleFile = (Join-Path $PSScriptRoot 'crop-style-10.sld'),
    [string]$StyleName = 'crop-style-10'
)

$ErrorActionPreference = 'Stop'
$rest = "$Server/geoserver/rest"
$pair = "$User`:$Password"
$auth = @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair)) }

$years = @(
    @{ dir = '24'; year = 2024 },
    @{ dir = '25'; year = 2025 },
    @{ dir = '26'; year = 2026 }
)

function Invoke-Rest {
    param([string]$Method, [string]$Uri, [string]$ContentType, $Body, [switch]$AllowMissing)
    try {
        if ($Body -ne $null) {
            return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $auth -ContentType $ContentType -Body $Body
        }
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $auth -ContentType $ContentType
    } catch {
        if ($AllowMissing) { return $null }
        throw
    }
}

Write-Host "==> checking workspace $Workspace"
$ws = Invoke-Rest -Method Get -Uri "$rest/workspaces/$Workspace" -ContentType 'application/json' -AllowMissing
if (-not $ws) {
    Write-Host "    workspace missing, creating it"
    Invoke-Rest -Method Post -Uri "$rest/workspaces" -ContentType 'application/json' `
        -Body (@{ workspace = @{ name = $Workspace } } | ConvertTo-Json -Depth 5) | Out-Null
} else {
    Write-Host "    ok"
}

foreach ($item in $years) {
    $year = $item.year
    $srcDir = Join-Path (Join-Path $CutRoot $item.dir) ''
    $shp = Get-ChildItem -LiteralPath $srcDir -Filter '*.shp' | Select-Object -First 1
    if (-not $shp) { throw "no .shp found in $srcDir" }
    $native = [IO.Path]::GetFileNameWithoutExtension($shp.Name)
    $store = "cut_$year"
    $layer = "bh_crop_class_$year"

    Write-Host "==> $year zipping $($shp.Name)"
    $zip = Join-Path $env:TEMP "cut_$year.zip"
    if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
    $parts = Get-ChildItem -LiteralPath $srcDir -Filter "$native.*" | ForEach-Object { $_.FullName }
    Compress-Archive -Path $parts -DestinationPath $zip -Force

    Write-Host "==> $year uploading datastore $store"
    Invoke-Rest -Method Put -Uri "$rest/workspaces/$Workspace/datastores/$store/file.shp" `
        -ContentType 'application/zip' -Body ([IO.File]::ReadAllBytes($zip)) | Out-Null

    Write-Host "==> $year publishing layer $layer"
    Invoke-Rest -Method Post -Uri "$rest/workspaces/$Workspace/datastores/$store/featuretypes" `
        -ContentType 'application/json' -AllowMissing `
        -Body (@{ featureType = @{ name = $layer; nativeName = $native; srs = 'EPSG:4326' } } | ConvertTo-Json -Depth 5) | Out-Null

    Remove-Item -LiteralPath $zip -Force
}

Write-Host "==> uploading style $StyleName"
if (-not (Test-Path -LiteralPath $StyleFile)) { throw "SLD not found: $StyleFile" }
$sld = Get-Content -LiteralPath $StyleFile -Raw -Encoding UTF8
$styleBody = [Text.Encoding]::UTF8.GetBytes($sld)
# Update when the style already exists. GeoServer answers 500 for a GET on an
# existing style, so skip the existence probe: fall back to POST when PUT fails.
try {
    Invoke-Rest -Method Put -Uri "$rest/workspaces/$Workspace/styles/$StyleName" `
        -ContentType 'application/vnd.ogc.sld+xml; charset=UTF-8' -Body $styleBody | Out-Null
    $styleDone = $true
} catch {
    $styleDone = $false
}
if (-not $styleDone) {
    Invoke-Rest -Method Post -Uri "$rest/workspaces/$Workspace/styles?name=$StyleName" `
        -ContentType 'application/vnd.ogc.sld+xml; charset=UTF-8' -Body $styleBody | Out-Null
}

foreach ($item in $years) {
    $layer = "bh_crop_class_$($item.year)"
    Write-Host "==> applying $StyleName to $layer"
    $body = @{ layer = @{ defaultStyle = @{ name = $StyleName; workspace = $Workspace } } } | ConvertTo-Json -Depth 5
    Invoke-Rest -Method Put -Uri "$rest/layers/${Workspace}:$layer" -ContentType 'application/json' -Body $body | Out-Null
}

Write-Host ""
Write-Host "Done. Verify:"
Write-Host "  $Server/geoserver/$Workspace/wms?service=WMS&version=1.1.1&request=GetCapabilities"
