param([string]$RuntimeDirectory)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
  Write-Host 'Puuka JLPT Dojo - 本地部署' -ForegroundColor Green
  $node = $null
  $pointer = Join-Path $root '.runtime\node-path.txt'
  $candidates = @()
  if (Test-Path -LiteralPath $pointer) { $candidates += (Get-Content -LiteralPath $pointer -Raw).Trim() }
  $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($systemNode) { $candidates += $systemNode.Source }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      $version = & $candidate --version
      if ($LASTEXITCODE -eq 0 -and [int]($version.TrimStart('v').Split('.')[0]) -ge 20) { $node = $candidate; break }
    }
  }
  if (-not $node) {
    if (-not $RuntimeDirectory) {
      if ([IO.Path]::GetPathRoot($root) -eq 'C:\') { $RuntimeDirectory = 'D:\Puuka-JLPT-Dojo-runtime' }
      else { $RuntimeDirectory = Join-Path $root '.runtime\node' }
    }
    $RuntimeDirectory = [IO.Path]::GetFullPath($RuntimeDirectory)
    if ([IO.Path]::GetPathRoot($RuntimeDirectory) -eq 'C:\') { throw '请将 Node.js 运行环境放在 D 盘或其他非 C 盘目录。' }
    Write-Host "将下载 Node.js 便携版到：$RuntimeDirectory"
    New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null
    $cache = Join-Path $RuntimeDirectory 'download'
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $env:TEMP = $cache; $env:TMP = $cache
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 60
    $release = $index | Where-Object { $_.lts -and [int]($_.version.TrimStart('v').Split('.')[0]) -ge 20 } | Select-Object -First 1
    if (-not $release) { throw '未找到可用的 Node.js LTS 版本。' }
    $arch = 'x64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
    $name = "node-$($release.version)-win-$arch"
    $zip = Join-Path $cache "$name.zip"
    $base = "https://nodejs.org/dist/$($release.version)"
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$name.zip" -OutFile $zip -TimeoutSec 300
    $checks = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -TimeoutSec 60).Content
    $line = $checks -split "`n" | Where-Object { $_.Trim().EndsWith("  $name.zip") } | Select-Object -First 1
    if (-not $line) { throw '未找到官方下载校验信息。' }
    $expected = ($line.Trim() -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected) { throw 'Node.js 下载校验失败，请重新部署。' }
    Expand-Archive -LiteralPath $zip -DestinationPath $RuntimeDirectory -Force
    $node = Join-Path $RuntimeDirectory "$name\node.exe"
    if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js 解压失败。' }
    Remove-Item -LiteralPath $zip
  }
  foreach ($dir in @('.runtime','exams','data','tmp')) { New-Item -ItemType Directory -Path (Join-Path $root $dir) -Force | Out-Null }
  [IO.File]::WriteAllText($pointer,$node,[Text.UTF8Encoding]::new($false))
  & $node --check (Join-Path $root 'server.js')
  if ($LASTEXITCODE -ne 0) { throw '程序文件不完整，请重新下载项目。' }
  Write-Host "部署完成。Node.js：$node" -ForegroundColor Green
  Write-Host '下一步：双击「启动网站.cmd」，即可使用随项目附带的题库。'
  Write-Host '部署不会启动网站、安装全局软件或修改系统 PATH。'
  exit 0
} catch {
  Write-Host "部署未完成：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host '请检查网络、磁盘空间，或先安装 Node.js 20 及以上版本后重新运行。'
  exit 1
}
