param(
  [Parameter(Position=0)][ValidateSet('setup','up','configure','check','team','start','status','export','pair','stop','help')][string]$Action = 'help',
  [string]$Machine = 'openmausbot'
)
$ErrorActionPreference = 'Stop'
if ($Action -eq 'help') {
  Write-Output 'Usage: .\deploy\nekoneko\nekoneko.ps1 setup|up|configure|check|team|start|status|export|pair|stop'
  Write-Output 'Podman machine: openmausbot; dedicated data/project: nekoneko-guide; app: http://localhost:29880'
  exit 0
}
if ($Machine -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid machine name.' }
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
  & $launcher @args
  if ($LASTEXITCODE -ne 0) { throw 'Podman Compose command failed.' }
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
    & $podmanExe machine ssh $Machine "cd $quotedDir && sh setup.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Dedicated data setup failed.' }
    return
  }
  if (-not $selected) { throw 'Run setup first.' }
  if (-not $selected.Running) {
    & $podmanExe machine start $Machine
    if ($LASTEXITCODE -ne 0) { throw 'Machine start failed.' }
  }
  switch ($Action) {
    'up' { Invoke-Compose up -d --build }
    'configure' {
      $secret = Read-Host 'Z.ai Coding Plan API key (hidden input)' -AsSecureString
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
      try {
        $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        $payload = @{ key = $key } | ConvertTo-Json -Compress
        $command = "cd $quotedDir/../podman && PODMAN_COMPOSE_PROVIDER=podman-compose podman compose --env-file .env.nekoneko -f compose.yaml exec -T omb node /opt/nekoneko/configure.mjs"
        $payload | & $podmanExe machine ssh $Machine $command
        if ($LASTEXITCODE -ne 0) { throw 'GLM setup failed.' }
      } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        $payload = $null; $key = $null; $secret = $null
      }
      Invoke-Compose restart omb
    }
    'check' { Invoke-Compose exec -T omb node /opt/nekoneko/configure.mjs check }
    'pair' { Invoke-Compose exec -T omb node dist-server/openmausbot.js pair }
    'stop' {
      $runningApp = & $podmanExe machine ssh $Machine 'podman ps --filter label=com.docker.compose.project=nekoneko-guide --filter label=com.docker.compose.service=omb --format "{{.Names}}"'
      if ($LASTEXITCODE -ne 0) { throw 'Could not check the dedicated app state.' }
      if ($runningApp) { Invoke-Compose exec -T omb node /opt/nekoneko/team.mjs stop-desktops }
      Invoke-Compose stop
    }
    'export' {
      Invoke-Compose exec -T omb node /opt/nekoneko/team.mjs export
      $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
      $output = Join-Path $repo 'nekoneko-output'
      New-Item -ItemType Directory -Path $output -Force | Out-Null
      $quotedOutput = Quote-Posix ($linuxDir + '/../../nekoneko-output')
      & $podmanExe machine ssh $Machine ('cp -R "$HOME/nekoneko-guide/nekoneko-export/." ' + $quotedOutput)
      if ($LASTEXITCODE -ne 0) { throw 'Export copy failed.' }
      Write-Output "Exported HTML, PNGs and hashes to $output"
    }
    default { Invoke-Compose exec -T omb node /opt/nekoneko/team.mjs $Action }
  }
} finally {
  $env:OMB_PODMAN_MACHINE = $oldMachine
  $env:OMB_PODMAN_ENV_FILE = $oldEnvFile
}
