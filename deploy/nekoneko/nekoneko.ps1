param(
  [Parameter(Position=0)][ValidateSet('setup','up','configure','check','team','start','review','status','export','pair','stop','doctor','help')][string]$Action = 'help',
  [string]$Machine = ''
)
$ErrorActionPreference = 'Stop'
$envFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../podman/.env.nekoneko'))
function Read-GuideSettings {
  $values = @{ OMB_PODMAN_MACHINE='openmausbot'; COMPOSE_PROJECT_NAME='nekoneko-article'; OMB_PORT='31799'; OMB_HTTP_PORT='31880'; OMB_GLM_MODEL='glm-5.3' }
  if (Test-Path -LiteralPath $envFile) {
    foreach ($line in [IO.File]::ReadAllLines($envFile)) {
      $trimmed = $line.Trim()
      if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
      if ($trimmed -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') { throw 'Use literal KEY=value lines in .env.nekoneko.' }
      $keyName = $Matches[1]; $settingValue = $Matches[2]
      if ($settingValue.Length -ge 2 -and $settingValue[0] -eq $settingValue[$settingValue.Length-1] -and $settingValue[0] -in @([char]34,[char]39)) { $settingValue = $settingValue.Substring(1,$settingValue.Length-2) }
      if ($settingValue.Contains('$')) { throw 'Use literal settings, not shell/Compose expansion.' }
      if ($settingValue) { $values[$keyName] = $settingValue }
    }
  }
  return $values
}
$settings = Read-GuideSettings
if (-not $Machine) { $Machine = $settings.OMB_PODMAN_MACHINE }
if ($Machine -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid machine name.' }
if ($settings.COMPOSE_PROJECT_NAME -notmatch '^[a-z0-9][a-z0-9_-]*$') { throw 'Invalid project name.' }
if ($Action -eq 'help') {
  Write-Output 'Usage: .\deploy\nekoneko\nekoneko.ps1 setup|up|configure|check|team|start|review|status|export|pair|stop|doctor'
  Write-Output 'Settings: deploy/podman/.env.nekoneko (optional template: deploy/nekoneko/settings.env.example)'
  exit 0
}
if ($Action -in @('setup', 'up')) {
  $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
  $releasePath = Join-Path $PSScriptRoot 'release.json'
  if (-not (Test-Path -LiteralPath $releasePath)) { throw 'Missing article release.json. Copy the complete article helper folder into the official clone.' }
  $release = Get-Content -LiteralPath $releasePath -Raw | ConvertFrom-Json
  if ($release.officialCommit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid officialCommit in release.json.' }
  $actualHead = & git -C $repoRoot rev-parse HEAD
  if ($LASTEXITCODE -ne 0 -or $actualHead -ne $release.officialCommit) { throw 'Use the official clone checked out at release.json officialCommit; this helper does not run the modified fork.' }
  & git -C $repoRoot diff --quiet HEAD --
  if ($LASTEXITCODE -ne 0) { throw 'Official tracked files have changes. Use a clean official clone and add only deploy/nekoneko.' }
}
$podmanCommand = Get-Command podman.exe -ErrorAction SilentlyContinue
$podmanExe = if ($podmanCommand) { $podmanCommand.Source } else { 'C:\Program Files\RedHat\Podman\podman.exe' }
if (-not (Test-Path -LiteralPath $podmanExe)) { throw 'Install Podman and WSL2, then reopen PowerShell.' }
if ($PSScriptRoot -notmatch '^([A-Za-z]):\\(.+)$') { throw 'Clone to a local Windows drive accessible to WSL2.' }
$linuxDir = '/mnt/' + $Matches[1].ToLower() + '/' + $Matches[2].Replace('\','/')
function Quote-Posix([string]$value) { "'" + $value.Replace("'", "'\''") + "'" }
$quotedDir = Quote-Posix $linuxDir
$oldMachine = $env:OMB_PODMAN_MACHINE
$oldEnvFile = $env:OMB_PODMAN_ENV_FILE
$env:OMB_PODMAN_MACHINE = $Machine
$env:OMB_PODMAN_ENV_FILE = '.env.nekoneko'
$launcher = Join-Path $PSScriptRoot '../podman/maus.ps1'
function Invoke-Compose {
  & $launcher -f ../nekoneko/compose.override.yaml @args
  if ($LASTEXITCODE -ne 0) { throw 'Podman Compose command failed. Run doctor for the dedicated project state.' }
}
function Get-RunningApp([switch]$Healthy) {
  $filters = '--filter ' + (Quote-Posix ('label=com.docker.compose.project=' + $settings.COMPOSE_PROJECT_NAME)) + ' --filter label=com.docker.compose.service=omb'
  if ($Healthy) { $filters += ' --filter health=healthy' }
  $result = & $podmanExe machine ssh $Machine ("podman ps $filters --format '{{.Names}}'")
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the dedicated project.' }
  return $result
}
function Wait-GuideReady {
  $deadline = (Get-Date).AddSeconds(180)
  do {
    if (Get-RunningApp -Healthy) { Write-Output 'Dedicated app is healthy.'; return }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw 'App health timed out. Run doctor and inspect the dedicated Compose logs.'
}
try {
  $machineJson = & $podmanExe machine list --format json
  if ($LASTEXITCODE -ne 0) { throw 'Cannot list Podman machines.' }
  $selected = ($machineJson | ConvertFrom-Json) | Where-Object Name -eq $Machine
  if ($Action -eq 'setup') {
    if (-not $selected) {
      & $podmanExe machine init --cpus 4 --memory 10240 --disk-size 60 $Machine
      if ($LASTEXITCODE -ne 0) { throw 'Machine creation failed.' }
    }
    if ($selected -and $selected.VMType -ne 'wsl') { throw 'This guide requires a WSL2 machine.' }
    if (-not $selected -or -not $selected.Running) {
      & $podmanExe machine start $Machine
      if ($LASTEXITCODE -ne 0) { throw 'Machine start failed.' }
    }
    & $podmanExe machine ssh $Machine 'command -v podman-compose >/dev/null || sudo dnf install -y podman-compose'
    if ($LASTEXITCODE -ne 0) { throw 'podman-compose installation failed.' }
    & $podmanExe machine ssh $Machine ('cd ' + $quotedDir + ' && OMB_PODMAN_MACHINE=' + (Quote-Posix $Machine) + ' sh setup.sh')
    if ($LASTEXITCODE -ne 0) { throw 'Dedicated data setup failed.' }
    return
  }
  if (-not $selected -or -not (Test-Path -LiteralPath $envFile) -or -not $settings.OMB_DATA_ROOT) { throw 'Run setup first.' }
  if (-not $selected.Running) {
    & $podmanExe machine start $Machine
    if ($LASTEXITCODE -ne 0) { throw 'Machine start failed.' }
  }
  switch ($Action) {
    'up' { Invoke-Compose up -d --build omb; Wait-GuideReady; Invoke-Compose up -d --no-deps caddy }
    'configure' {
      Wait-GuideReady
      $secret = Read-Host 'Z.ai Coding Plan API key (hidden input)' -AsSecureString
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
      try {
        $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        $payload = @{ key = $key } | ConvertTo-Json -Compress
        $command = "cd $quotedDir/../podman && PODMAN_COMPOSE_PROVIDER=podman-compose podman compose --env-file .env.nekoneko -f compose.yaml -f ../nekoneko/compose.override.yaml exec -T omb node /opt/nekoneko/configure.mjs"
        $payload | & $podmanExe machine ssh $Machine $command
        if ($LASTEXITCODE -ne 0) { throw 'GLM setup failed.' }
      } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        $payload = $null; $key = $null; $secret = $null
      }
      Invoke-Compose restart omb
      Wait-GuideReady
    }
    'check' { Wait-GuideReady; Invoke-Compose exec -T omb node /opt/nekoneko/configure.mjs check }
    'pair' { Wait-GuideReady; Invoke-Compose exec -T omb node dist-server/openmausbot.js pair }
    'stop' {
      try {
        if (Get-RunningApp -Healthy) { Invoke-Compose exec -T omb node /opt/nekoneko/team.mjs stop-desktops }
        elseif (Get-RunningApp) { Write-Warning 'App is unhealthy. Stopping the dedicated Compose project; inspect recorded GUI containers with doctor after recovery.' }
      } finally { Invoke-Compose stop }
    }
    'doctor' {
      [pscustomobject]@{ Machine=$Machine; Project=$settings.COMPOSE_PROJECT_NAME; Data=$settings.OMB_DATA_ROOT; App=$settings.OMB_PUBLIC_URL; Model=$settings.OMB_GLM_MODEL } | Format-List
      Invoke-Compose ps
      if (Get-RunningApp -Healthy) { Invoke-Compose exec -T omb node /opt/nekoneko/team.mjs status }
    }
    'export' {
      Wait-GuideReady
      Invoke-Compose exec -T omb node /opt/nekoneko/team.mjs export
      $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
      $output = Join-Path $repo 'nekoneko-output'
      New-Item -ItemType Directory -Path $output -Force | Out-Null
      $quotedOutput = Quote-Posix ($linuxDir + '/../../nekoneko-output')
      $quotedSource = Quote-Posix ($settings.OMB_DATA_ROOT.TrimEnd('/') + '/nekoneko-export/.')
      & $podmanExe machine ssh $Machine ("cp -R $quotedSource $quotedOutput")
      if ($LASTEXITCODE -ne 0) { throw 'Export copy failed.' }
      Write-Output "Exported HTML, PNGs and hashes to $output"
    }
    default { Wait-GuideReady; Invoke-Compose exec -T omb node /opt/nekoneko/team.mjs $Action }
  }
} finally {
  $env:OMB_PODMAN_MACHINE = $oldMachine
  $env:OMB_PODMAN_ENV_FILE = $oldEnvFile
}
