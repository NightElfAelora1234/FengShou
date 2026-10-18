# 将当前文件夹里的 pack.json + portrait.png 打成 zip
# 用法：在 PowerShell 中运行
#   .\make-pack.ps1 -Folder .\my-boss -Output .\my-boss.zip

param(
  [Parameter(Mandatory=$true)][string]$Folder,
  [Parameter(Mandatory=$true)][string]$Output
)

$Folder = (Resolve-Path $Folder).Path
$pack = Join-Path $Folder 'pack.json'
$portrait = Join-Path $Folder 'portrait.png'
if (-not (Test-Path $pack)) { throw "缺少 pack.json" }
if (-not (Test-Path $portrait)) { throw "缺少 portrait.png" }

$json = Get-Content -Raw -Encoding UTF8 $pack | ConvertFrom-Json
if (-not $json.name) { throw "pack.json 缺少 name" }
if (-not $json.lines -or $json.lines.Count -lt 1) { throw "pack.json 缺少 lines" }

if (Test-Path $Output) { Remove-Item $Output -Force }
Compress-Archive -Path $pack,$portrait -DestinationPath $Output -CompressionLevel Optimal
Write-Host "已生成 $Output"
