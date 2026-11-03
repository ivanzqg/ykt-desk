$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
node app/server.mjs
