$ErrorActionPreference='Stop'
$root='C:/Users/KY/.codex/worktrees/responsive-cross-device/Stallorder-Platform'
Set-Location -LiteralPath $root
$e=Join-Path $root '.superpowers/sdd/2026-10-01-awesome-optimization/batch-5'
if (!$env:B5_ROOT_SOURCE) { throw 'SOURCE_BINDING_REQUIRED' }
node --input-type=module -e "import {captureFrozenResponsiveSource} from './scripts/responsive-build-provenance.mjs';import assert from 'node:assert/strict';assert.equal(captureFrozenResponsiveSource().sourceIdentity.sourceSha256,process.env.B5_ROOT_SOURCE)"
if ($LASTEXITCODE -ne 0) { throw 'SOURCE_DRIFT' }
if (@(Get-NetTCPConnection -State Listen -LocalPort 3026 -ErrorAction SilentlyContinue).Count -ne 0) { throw 'APP_MUST_BE_STOPPED' }
if (@(Get-Process emulator,qemu-system-x86_64,java -ErrorAction SilentlyContinue).Count -ne 0) { throw 'NATIVE_CONSUMER_PRESENT' }
$free=[math]::Floor((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)
if ($free -lt 6000) { throw "INSUFFICIENT_BUILD_RAM_MIB $free" }
if ((Get-FileHash -LiteralPath (Join-Path $e 'native-a2-generated-index.json') -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'bd839e540adb5c2ab38398ded706aa7368efccca18073be166a66e6adfde655b') { throw 'GENERATED_INDEX_DRIFT' }
$nativeBuildInputs=Get-Content (Join-Path $e 'native-a2-generated-index.json') -Raw | ConvertFrom-Json
foreach($file in $nativeBuildInputs) { $actual=(Get-FileHash -LiteralPath (Join-Path (Join-Path $e 'native-a2') $file.path) -Algorithm SHA256).Hash.ToLowerInvariant(); if ($actual -ne $file.sha256) { throw "GENERATED_INPUT_DRIFT $($file.path)" } }
$env:JAVA_HOME='C:/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot'
$env:ANDROID_HOME='C:/Users/KY/AppData/Local/Android/Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:EXPO_NO_TELEMETRY='1'; $env:EXPO_NO_DOTENV='1'; $env:EXPO_OFFLINE='1'
$env:EXPO_PUBLIC_APP_ENV='local'; $env:EXPO_PUBLIC_API_BASE_URL='http://127.0.0.1:3026'
$env:NODE_OPTIONS='--max-old-space-size=1536'; $env:CMAKE_BUILD_PARALLEL_LEVEL='1'
$env:CI='1'; $env:VERCEL=''; $env:VERCEL_ENV=''
if ((Get-FileHash -LiteralPath (Join-Path $e 'native-a2-build-bindings.json') -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'a839d6b06c23198c01bcd6cd36d6ada1845b8fad3a360e394a8d9a970baa609f') { throw 'BUILD_BINDINGS_DRIFT' }
$bindings=Get-Content (Join-Path $e 'native-a2-build-bindings.json') -Raw | ConvertFrom-Json
foreach($file in $bindings.files) { $actual=(Get-FileHash -LiteralPath (Join-Path $root $file.path) -Algorithm SHA256).Hash.ToLowerInvariant(); if ($actual -ne $file.sha256) { throw "BUILD_INPUT_DRIFT $($file.path)" } }
$start=(Get-Date).ToUniversalTime().ToString('o')
@{source=$env:B5_ROOT_SOURCE;freeMiB=$free;wrapperPid=$PID;start=$start;gradleHeapMiB=1536;nodeHeapMiB=1536;workers=1;architecture='x86_64';variant='release-local-debug-key';appOff=$true;emulatorOff=$true} | ConvertTo-Json | Set-Content (Join-Path $e 'native-a2-build-start.json')
Set-Location -LiteralPath (Join-Path $e 'native-a2/android')
& ./gradlew.bat --no-daemon --max-workers=1 '-Dorg.gradle.parallel=false' '-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=384m' '-Pkotlin.compiler.execution.strategy=in-process' '-PreactNativeArchitectures=x86_64' :app:assembleRelease *> (Join-Path $e 'native-a2-build.log')
$code=$LASTEXITCODE
@{exitCode=$code;start=$start;end=(Get-Date).ToUniversalTime().ToString('o');wrapperPid=$PID} | ConvertTo-Json | Set-Content (Join-Path $e 'native-a2-build.exit.json')
if ($code -eq 0) { Get-FileHash -LiteralPath './app/build/outputs/apk/release/app-release.apk' -Algorithm SHA256 | Select-Object Path,Hash | ConvertTo-Json | Set-Content (Join-Path $e 'native-a2-binary.json') }
exit $code
