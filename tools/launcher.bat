@echo off
rem ============================================================
rem  緑ヶ丘調剤薬局 在庫表 ランチャー
rem
rem  在庫表を、ブラウザのタブではなく独立したウィンドウで開きます。
rem  このファイルと「緑ヶ丘_在庫表.html」を同じフォルダーに置いてください。
rem  Chrome も Edge も見つからない場合は、既定のブラウザで開きます。
rem ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d='%~dp0'; $h=Join-Path $d '緑ヶ丘_在庫表.html'; if(-not (Test-Path $h)){ $f=@(Get-ChildItem -Path $d -Filter '*.html'); if($f.Count -gt 0){ $h=$f[0].FullName } }; if(-not (Test-Path $h)){ Write-Host '在庫表のHTMLファイルが同じフォルダーに見つかりません。'; Read-Host 'Enterキーを押すと終了します'; exit }; $u=([System.Uri]$h).AbsoluteUri; $c=@((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'), (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe'), (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')); $e=$null; foreach($p in $c){ if($p -and (Test-Path $p)){ $e=$p; break } }; if($e){ Start-Process $e -ArgumentList ('--app=' + $u), '--window-size=1400,900' } else { Start-Process $h }"
