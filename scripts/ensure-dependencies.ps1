param(
    [switch]$ForceClean
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
$NodeRoot = Join-Path $Root ".runtime\node"
$NodeExe = Join-Path $NodeRoot "node.exe"
$NpmCmd = Join-Path $NodeRoot "npm.cmd"
$NodeModules = Join-Path $Root "node_modules"
$ElectronRoot = Join-Path $NodeModules "electron"
$ElectronDist = Join-Path $ElectronRoot "dist"
$ElectronPathFile = Join-Path $ElectronRoot "path.txt"
$ElectronPackageJson = Join-Path $ElectronRoot "package.json"
$PackageLock = Join-Path $Root "package-lock.json"
$DependencyMarker = Join-Path $Root ".cache\dependencies.sha256"
$NpmRc = Join-Path $Root ".npmrc"
$Registry = "https://registry.npmjs.org/"

if (-not (Test-Path -LiteralPath $NodeExe)) {
    throw "Local Node.js was not found. Run ensure-node.ps1 first."
}
if (-not (Test-Path -LiteralPath $NpmCmd)) {
    throw "Local npm was not found. Run ensure-node.ps1 first."
}

function Stop-LocalNodeProcesses {
    try {
        $rootPrefix = $Root.TrimEnd('\') + '\'
        $processes = Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $executableInsideProject = $_.ExecutablePath -and $_.ExecutablePath.StartsWith(
                $rootPrefix,
                [System.StringComparison]::OrdinalIgnoreCase
            )
            $commandInsideProject = $_.CommandLine -and
                $_.CommandLine.IndexOf($Root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                $_.Name -match '^(node|npm|npx|electron|AstraFetch).*'
            $executableInsideProject -or $commandInsideProject
        }

        foreach ($process in $processes) {
            if ($process.ProcessId -ne $PID) {
                Write-Host "Stopping locked local process $($process.ProcessId)..."
                Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        Write-Warning "Could not inspect local processes: $($_.Exception.Message)"
    }
}

function Remove-DirectoryRobust([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    Stop-LocalNodeProcesses

    for ($attempt = 1; $attempt -le 4; $attempt++) {
        try {
            Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
                try { $_.Attributes = 'Normal' } catch { }
            }
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            return
        } catch {
            Write-Host "Cleanup attempt $attempt failed. Retrying..."
            Start-Sleep -Seconds ($attempt * 2)
        }
    }

    $emptyDir = Join-Path $Root ".cache\empty-dir"
    New-Item -ItemType Directory -Force -Path $emptyDir | Out-Null
    & robocopy.exe $emptyDir $Path /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    & cmd.exe /d /c "rmdir /s /q `"$Path`"" | Out-Null

    if (Test-Path -LiteralPath $Path) {
        throw "Could not remove '$Path'. Close Explorer windows, terminals, antivirus scans, and run again."
    }
}

function Repair-PackageLockRegistry {
    if (-not (Test-Path -LiteralPath $PackageLock)) {
        throw "package-lock.json was not found."
    }

    $content = Get-Content -LiteralPath $PackageLock -Raw
    $changed = $false

    # Repair legacy lock files that reference an unavailable package version.
    if ($content -match '"node_modules/@electron-internal/extract-zip"\s*:\s*\{\s*"version"\s*:\s*"1\.0\.5"') {
        Write-Host "Repairing unavailable @electron-internal/extract-zip version..."
        $content = [regex]::Replace(
            $content,
            '("node_modules/@electron-internal/extract-zip"\s*:\s*\{\s*"version"\s*:\s*)"1\.0\.5"',
            '$1"1.0.4"'
        )
        $changed = $true
    }

    if ($changed) {
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($PackageLock, $content, $utf8NoBom)
    }

    & $NodeExe -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));" $PackageLock
    if ([int]$LASTEXITCODE -ne 0) {
        throw "package-lock.json is invalid JSON. Replace it with the original file from the repository."
    }
}

function Clear-ElectronEnvironment {
    $names = @(
        "ELECTRON_SKIP_BINARY_DOWNLOAD",
        "npm_config_electron_skip_binary_download",
        "NPM_CONFIG_ELECTRON_SKIP_BINARY_DOWNLOAD",
        "ELECTRON_OVERRIDE_DIST_PATH",
        "npm_config_electron_override_dist_path",
        "NPM_CONFIG_ELECTRON_OVERRIDE_DIST_PATH",
        "ELECTRON_CUSTOM_DIR",
        "ELECTRON_CUSTOM_FILENAME",
        "npm_config_electron_custom_dir",
        "npm_config_electron_custom_filename"
    )

    foreach ($name in $names) {
        Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
}

function Invoke-NpmCi {
    $arguments = @(
        "ci",
        "--registry=$Registry",
        "--userconfig=$NpmRc",
        "--no-audit",
        "--no-fund",
        "--foreground-scripts",
        "--fetch-retries=5",
        "--fetch-retry-mintimeout=10000",
        "--fetch-retry-maxtimeout=120000",
        "--fetch-timeout=300000",
        "--prefer-online"
    )

    & $NpmCmd @arguments | Out-Host
    if ($null -eq $LASTEXITCODE) {
        return 0
    }
    return [int]$LASTEXITCODE
}

function Test-NodePackages {
    $requiredFiles = @(
        (Join-Path $ElectronRoot "package.json"),
        (Join-Path $NodeModules "electron-builder\package.json"),
        (Join-Path $NodeModules "@electron\fuses\package.json")
    )

    foreach ($file in $requiredFiles) {
        if (-not (Test-Path -LiteralPath $file)) {
            return $false
        }
    }
    return $true
}

function Get-ElectronExecutable {
    if (Test-Path -LiteralPath $ElectronPathFile) {
        $relativePath = (Get-Content -LiteralPath $ElectronPathFile -Raw -ErrorAction SilentlyContinue).Trim()
        if ($relativePath) {
            return Join-Path $ElectronDist $relativePath
        }
    }
    return Join-Path $ElectronDist "electron.exe"
}

function Test-ElectronRuntime {
    $electronExe = Get-ElectronExecutable
    $requiredFiles = @(
        $electronExe,
        (Join-Path $ElectronDist "resources.pak"),
        (Join-Path $ElectronDist "icudtl.dat")
    )

    foreach ($file in $requiredFiles) {
        if (-not (Test-Path -LiteralPath $file)) {
            return $false
        }
    }

    try {
        if ((Get-Item -LiteralPath $electronExe).Length -lt 1000000) {
            return $false
        }
    } catch {
        return $false
    }

    return $true
}

function Invoke-DownloadWithRetry {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$OutFile,
        [int]$Attempts = 3
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
            Write-Host "Downloading $([System.IO.Path]::GetFileName($OutFile)) (attempt $attempt of $Attempts)..."
            Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile -Headers @{
                "User-Agent" = "AstraFetch-Setup/1.0.1"
                "Accept" = "application/octet-stream"
            }

            if (-not (Test-Path -LiteralPath $OutFile)) {
                throw "Downloaded file was not created."
            }
            if ((Get-Item -LiteralPath $OutFile).Length -lt 100) {
                throw "Downloaded file is unexpectedly small."
            }
            return
        } catch {
            if ($attempt -ge $Attempts) {
                throw
            }
            Write-Warning "Download attempt $attempt failed: $($_.Exception.Message)"
            Start-Sleep -Seconds ($attempt * 3)
        }
    }
}

function Install-ElectronRuntimeDirect {
    if (Test-ElectronRuntime) {
        Write-Host "Electron runtime is ready."
        return
    }

    if (-not (Test-Path -LiteralPath $ElectronPackageJson)) {
        throw "Electron package.json was not found after npm installation."
    }

    $electronManifest = Get-Content -LiteralPath $ElectronPackageJson -Raw | ConvertFrom-Json
    $electronVersion = [string]$electronManifest.version
    if ([string]::IsNullOrWhiteSpace($electronVersion)) {
        throw "Electron version could not be read from package.json."
    }

    $archiveName = "electron-v$electronVersion-win32-x64.zip"
    $releaseBase = "https://github.com/electron/electron/releases/download/v$electronVersion"
    $archiveUrl = "$releaseBase/$archiveName"
    $checksumsUrl = "$releaseBase/SHASUMS256.txt"
    $tempRoot = Join-Path $Root ".cache\electron-direct-$electronVersion"
    $archivePath = Join-Path $tempRoot $archiveName
    $checksumsPath = Join-Path $tempRoot "SHASUMS256.txt"
    $extractPath = Join-Path $tempRoot "extracted"

    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

    try {
        Write-Host "Preparing Electron $electronVersion from the official GitHub release..."
        Invoke-DownloadWithRetry -Uri $checksumsUrl -OutFile $checksumsPath
        Invoke-DownloadWithRetry -Uri $archiveUrl -OutFile $archivePath

        $expectedLine = Get-Content -LiteralPath $checksumsPath | Where-Object {
            $_ -match ("^[a-fA-F0-9]{64}\s+\*?" + [regex]::Escape($archiveName) + "$")
        } | Select-Object -First 1

        if (-not $expectedLine) {
            throw "Electron SHA-256 entry was not found for $archiveName."
        }

        $expectedHash = (($expectedLine -split '\s+')[0]).ToLowerInvariant()
        $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
        if ($expectedHash -ne $actualHash) {
            throw "Electron SHA-256 verification failed. Expected $expectedHash but received $actualHash."
        }
        Write-Host "Electron SHA-256 verified: $actualHash"

        Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $extractPath | Out-Null
        Write-Host "Extracting Electron runtime..."
        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force

        $extractedExe = Join-Path $extractPath "electron.exe"
        if (-not (Test-Path -LiteralPath $extractedExe)) {
            throw "electron.exe was not found inside the official archive."
        }

        Remove-DirectoryRobust $ElectronDist
        Move-Item -LiteralPath $extractPath -Destination $ElectronDist

        Get-ChildItem -LiteralPath $ElectronDist -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
            try { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue } catch { }
        }

        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($ElectronPathFile, "electron.exe", $utf8NoBom)

        if (-not (Test-ElectronRuntime)) {
            throw "Electron runtime files were extracted, but validation failed."
        }
        Write-Host "Electron runtime installed successfully."
    } finally {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Repair-PackageLockRegistry
Clear-ElectronEnvironment
$CurrentLockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PackageLock).Hash.ToLowerInvariant()

$env:npm_config_registry = $Registry
$env:NPM_CONFIG_REGISTRY = $Registry
$env:npm_config_userconfig = $NpmRc
$env:NPM_CONFIG_USERCONFIG = $NpmRc
$env:npm_config_cache = Join-Path $Root ".cache\npm"
$env:ELECTRON_CACHE = Join-Path $Root ".cache\electron"
$env:ELECTRON_BUILDER_CACHE = Join-Path $Root ".cache\electron-builder"

$env:ELECTRON_MIRROR = $null
$env:NPM_CONFIG_ELECTRON_MIRROR = $null
$env:electron_mirror = $null
$env:npm_config_proxy = $null
$env:npm_config_https_proxy = $null
$env:NPM_CONFIG_PROXY = $null
$env:NPM_CONFIG_HTTPS_PROXY = $null

New-Item -ItemType Directory -Force -Path $env:npm_config_cache | Out-Null
New-Item -ItemType Directory -Force -Path $env:ELECTRON_CACHE | Out-Null
New-Item -ItemType Directory -Force -Path $env:ELECTRON_BUILDER_CACHE | Out-Null

if ($ForceClean) {
    Write-Host "Forced dependency cleanup requested."
    Remove-Item -LiteralPath $DependencyMarker -Force -ErrorAction SilentlyContinue
    Remove-DirectoryRobust $NodeModules
}

if ((Test-Path -LiteralPath $DependencyMarker) -and (Test-NodePackages)) {
    $InstalledLockHash = (Get-Content -LiteralPath $DependencyMarker -Raw -ErrorAction SilentlyContinue).Trim().ToLowerInvariant()
    if ($InstalledLockHash -eq $CurrentLockHash) {
        if (-not (Test-ElectronRuntime)) {
            Write-Host "Electron runtime is missing. Repairing it without reinstalling npm packages..."
            Install-ElectronRuntimeDirect
        }
        Write-Host "Project dependencies are ready."
        exit 0
    }
}

# Do not trust a partial node_modules tree without a matching dependency marker.
# npm can leave top-level package folders behind after ETARGET, EPERM, or a killed
# install. Reusing that tree can produce delayed and misleading runtime failures.
if (-not $ForceClean -and (Test-NodePackages) -and -not (Test-Path -LiteralPath $DependencyMarker)) {
    Write-Host "An incomplete dependency tree was detected. A clean npm install is required."
}

$npmInstalled = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
    Write-Host "Installing project dependencies from $Registry (attempt $attempt of 3)..."
    Remove-DirectoryRobust $NodeModules

    $exitCode = Invoke-NpmCi
    if ($exitCode -eq 0 -and (Test-NodePackages)) {
        $npmInstalled = $true
        break
    }

    if ($exitCode -eq 0) {
        Write-Warning "npm returned exit code 0, but required packages are missing."
    } else {
        Write-Warning "npm ci attempt $attempt failed with exit code $exitCode."
    }

    if ($attempt -eq 2) {
        Write-Host "Cleaning the local npm cache before the final attempt..."
        & $NpmCmd cache clean --force --cache $env:npm_config_cache | Out-Null
    } else {
        & $NpmCmd cache verify --cache $env:npm_config_cache | Out-Null
    }

    Start-Sleep -Seconds ($attempt * 3)
}

if (-not $npmInstalled) {
    throw "npm dependency installation failed after 3 attempts."
}

Install-ElectronRuntimeDirect
Set-Content -LiteralPath $DependencyMarker -Value $CurrentLockHash -Encoding Ascii
Write-Host "Project dependencies installed successfully."
exit 0
