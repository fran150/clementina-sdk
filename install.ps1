# Installs the Clementina SDK and its toolchain on Windows. In PowerShell:
#
#   irm https://raw.githubusercontent.com/fran150/clementina-sdk/main/install.ps1 | iex
#
# It downloads the `clementina` command-line tool from the newest SDK release
# into ~\.clementina\bin, checks it against the release's SHA256SUMS, then runs
# `clementina install`, which installs cc65, the emulator, the video client and
# Studio and adds the tools to the user PATH. Run it again to update.
#
# $env:CLEMENTINA_VERSION = 'v0.3.0-alpha.1' picks a release; $env:CLEMENTINA_HOME
# moves the folder; $env:CLEMENTINA_INSTALL_ARGS = 'emulator --no-modify-path'
# passes arguments to `clementina install`. macOS and Linux use install.sh.
# See docs/install.md.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  # Windows PowerShell 5.1 may default to TLS versions GitHub refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = 'fran150/clementina-sdk'
  $clementinaHome = if ($env:CLEMENTINA_HOME) { $env:CLEMENTINA_HOME } else { Join-Path $HOME '.clementina' }
  $tag = $env:CLEMENTINA_VERSION
  if (-not $tag) {
    # The newest SDK release, alphas included. Other tags (cc65-v*) are not SDK releases.
    $releases = Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=30"
    $tag = ($releases | Where-Object { $_.tag_name -like 'v*' } | Select-Object -First 1).tag_name
    if (-not $tag) { throw 'clementina install: could not find an SDK release on GitHub' }
  }

  $asset = 'clementina-windows-x64.exe'
  $base = "https://github.com/$repo/releases/download/$tag"
  $bin = Join-Path $clementinaHome 'bin'
  New-Item -ItemType Directory -Force -Path $bin | Out-Null
  $partial = Join-Path $bin 'clementina.exe.download'

  Write-Host "Downloading clementina $tag ($asset)"
  Invoke-WebRequest "$base/$asset" -OutFile $partial -UseBasicParsing
  $sums = (Invoke-WebRequest "$base/SHA256SUMS" -UseBasicParsing).Content
  if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
  $row = $sums -split "`n" | Where-Object { ($_.Trim() -split '\s+')[-1] -in @($asset, "*$asset") } | Select-Object -First 1
  if (-not $row) { throw "clementina install: SHA256SUMS of $tag lists no $asset" }
  $expected = ($row.Trim() -split '\s+')[0].ToLower()
  $actual = (Get-FileHash $partial -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) {
    Remove-Item $partial -Force
    throw "clementina install: $asset does not match its SHA256SUMS entry"
  }
  $cli = Join-Path $bin 'clementina.exe'
  Move-Item -Force $partial $cli

  $env:CLEMENTINA_HOME = $clementinaHome
  $installArgs = if ($env:CLEMENTINA_INSTALL_ARGS) { $env:CLEMENTINA_INSTALL_ARGS -split '\s+' | Where-Object { $_ } } else { @() }
  & $cli install @installArgs
  if ($LASTEXITCODE -ne 0) { throw "clementina install failed with exit code $LASTEXITCODE" }
  # Let this window use the tools without opening a new one.
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
}
