$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $Root ".runtime"
$NodeRoot = Join-Path $RuntimeRoot "node"
$NodeExe = Join-Path $NodeRoot "node.exe"
$DependencyMarker = Join-Path $Root ".cache\dependencies.sha256"
$NodeVersion = "22.23.1"
$ExpectedVersion = "v$NodeVersion"
$ArchiveName = "node-v$NodeVersion-win-x64.zip"
$BaseUrl = "https://nodejs.org/dist/v$NodeVersion"
function Stop-LocalRuntimeProcesses { try { $nodePrefix=$NodeRoot.TrimEnd('\')+'\'; Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($nodePrefix,[System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { if($_.ProcessId-ne$PID){Write-Host "Stopping local runtime process $($_.ProcessId)...";Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue} } } catch { Write-Warning "Could not inspect local runtime processes: $($_.Exception.Message)" } }
function Remove-DirectoryRobust([string]$Path) { if(-not(Test-Path -LiteralPath $Path)){return};Stop-LocalRuntimeProcesses;for($attempt=1;$attempt-le4;$attempt++){try{Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue|ForEach-Object{try{$_.Attributes='Normal'}catch{}};Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop;return}catch{Write-Host "Runtime cleanup attempt $attempt failed. Retrying...";Start-Sleep -Seconds($attempt*2)}};throw "Could not replace the local Node.js runtime. Close project terminals and run again." }
if(Test-Path -LiteralPath $NodeExe){$InstalledVersion="";try{$InstalledVersion=((& $NodeExe --version 2>$null|Select-Object -First 1)-as[string]).Trim()}catch{};if($InstalledVersion-eq$ExpectedVersion){Write-Host "Local Node.js $NodeVersion is ready.";exit 0};Write-Host "Replacing local Node.js runtime with $ExpectedVersion...";Remove-DirectoryRobust $NodeRoot;Remove-Item -LiteralPath $DependencyMarker -Force -ErrorAction SilentlyContinue}
New-Item -ItemType Directory -Force -Path $RuntimeRoot|Out-Null
$TempRoot=Join-Path $RuntimeRoot "node-download";$ArchivePath=Join-Path $TempRoot $ArchiveName;$ChecksumsPath=Join-Path $TempRoot "SHASUMS256.txt";$ExtractPath=Join-Path $TempRoot "extract"
Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue;New-Item -ItemType Directory -Force -Path $TempRoot|Out-Null
Write-Host "Downloading local Node.js $NodeVersion...";Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/$ArchiveName" -OutFile $ArchivePath;Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/SHASUMS256.txt" -OutFile $ChecksumsPath
$ExpectedLine=Get-Content -LiteralPath $ChecksumsPath|Where-Object{$_-match("\s"+[regex]::Escape($ArchiveName)+"$")}|Select-Object -First 1;if(-not$ExpectedLine){throw "Node.js checksum was not found."}
$ExpectedHash=($ExpectedLine-split'\s+')[0].ToLowerInvariant();$ActualHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $ArchivePath).Hash.ToLowerInvariant();if($ExpectedHash-ne$ActualHash){throw "Node.js SHA-256 verification failed."}
Write-Host "Extracting local Node.js...";Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractPath -Force;$ExtractedFolder=Get-ChildItem -LiteralPath $ExtractPath -Directory|Select-Object -First 1;if(-not$ExtractedFolder){throw "Extracted Node.js folder was not found."}
Remove-DirectoryRobust $NodeRoot;Move-Item -LiteralPath $ExtractedFolder.FullName -Destination $NodeRoot;Remove-Item -LiteralPath $TempRoot -Recurse -Force
if(-not(Test-Path -LiteralPath $NodeExe)){throw "Local Node.js installation failed."};$InstalledVersion=((& $NodeExe --version|Select-Object -First 1)-as[string]).Trim();if($InstalledVersion-ne$ExpectedVersion){throw "Unexpected local Node.js version: $InstalledVersion"};Write-Host "Local Node.js $NodeVersion installed successfully."
