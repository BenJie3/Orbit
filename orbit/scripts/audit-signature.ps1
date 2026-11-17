# Auditoria informativa de Authenticode para los binarios de Orbit.
# No firma archivos y no considera una firma de catalogo como firma embebida.
# Salida 0 = pudo ejecutar la auditoria. No significa que exista firma valida.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$files = @(
  (Join-Path $root ('dist/orbit-' + $package.version + '-Setup.exe')),
  (Join-Path $root 'dist/win-unpacked/Orbit.exe')
)
$allValid = $true
foreach ($file in $files) {
  if (!(Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "Falta el archivo de distribucion: $file"
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  $status = [string]$signature.Status
  $signer = if ($signature.SignerCertificate) {
    $signature.SignerCertificate.Subject
  } else { '(sin certificado)' }
  $result = [PSCustomObject]@{
    Archivo = Split-Path -Leaf $file
    Estado = $status
    Firmante = $signer
  }
  $result | Format-List | Out-String | Write-Host
  if ($status -ne 'Valid') {
    $allValid = $false
    Write-Warning ("El archivo {0} NO tiene una firma Authenticode valida: {1}" -f
      (Split-Path -Leaf $file), $status)
  }
}
if ($allValid) {
  Write-Host '[Orbit] Los dos archivos presentan una firma Authenticode valida.'
} else {
  Write-Warning '[Orbit] NO distribuir como firmado. Firma digital pendiente antes del lanzamiento.'
}
