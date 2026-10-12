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

$yearList = @(2024, 2025, 2026)

# Year folders may be named 24 or 2024 -- accept both.
function Resolve-YearDir {
    param([string]$Root, [int]$Year)
    $short = $Year.ToString().Substring(2)
    foreach ($name in @("$Year", $short)) {
        $candidate = Join-Path $Root $name
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw "year folder for $Year not found under $Root"
}

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

# The source shapefile is renamed between data versions, but the published
# feature type keeps pointing at the OLD file. Drop the layer and every
# feature type in the store first, so the new upload is what gets published.
function Remove-PublishedLayer {
    param([string]$LayerName)
    Invoke-Rest -Method Delete -Uri "$rest/layers/${Workspace}:${LayerName}?recurse=true" `
        -ContentType 'application/json' -AllowMissing | Out-Null
}

function Remove-StoreFeatureTypes {
    param([string]$StoreName)
    $list = Invoke-Rest -Method Get -Uri "$rest/workspaces/$Workspace/datastores/$StoreName/featuretypes.json" `
        -ContentType 'application/json' -AllowMissing
    if (-not $list) { return }
    foreach ($ft in $list.featureTypes.featureType) {
        Invoke-Rest -Method Delete -Uri "$rest/workspaces/$Workspace/datastores/$StoreName/featuretypes/$($ft.name)?recurse=true" `
            -ContentType 'application/json' -AllowMissing | Out-Null
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

foreach ($year in $yearList) {
    $srcDir = Resolve-YearDir -Root $CutRoot -Year $year
    $shp = Get-ChildItem -LiteralPath $srcDir -Filter '*.shp' | Select-Object -First 1
    if (-not $shp) { throw "no .shp found in $srcDir" }
    $native = [IO.Path]::GetFileNameWithoutExtension($shp.Name)
    $store = "cut_$year"
    $layer = "bh_crop_class_$year"

    Write-Host "==> $year resetting old layer and feature types"
    Remove-PublishedLayer -LayerName $layer
    Remove-StoreFeatureTypes -StoreName $store

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

foreach ($year in $yearList) {
    $layer = "bh_crop_class_$year"
    Write-Host "==> applying $StyleName to $layer"
    $body = @{ layer = @{ defaultStyle = @{ name = $StyleName; workspace = $Workspace } } } | ConvertTo-Json -Depth 5
    Invoke-Rest -Method Put -Uri "$rest/layers/${Workspace}:$layer" -ContentType 'application/json' -Body $body | Out-Null
}

Write-Host ""
Write-Host "Done. Verify:"
Write-Host "  $Server/geoserver/$Workspace/wms?service=WMS&version=1.1.1&request=GetCapabilities"
