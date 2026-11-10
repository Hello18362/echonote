@echo off
chcp 65001 >nul
setlocal
title EchoNote - 放行手机访问

rem ============================================================
rem  Double-click this file. It asks for admin rights by itself,
rem  then adds two inbound firewall rules (3000 / 3443).
rem  Only needs to run once.
rem ============================================================

rem --- step 1: relaunch as administrator if we are not elevated ---
net session >nul 2>&1
if errorlevel 1 (
  echo 正在请求管理员权限，请在弹窗里点「是」...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
  echo.
  echo 如果没有看到弹窗，请右键本文件，选择「以管理员身份运行」。
  echo.
  pause
  exit /b
)

rem --- step 2: add the rules ---
echo 正在放行端口...
netsh advfirewall firewall delete rule name="EchoNote 3443" >nul 2>&1
netsh advfirewall firewall delete rule name="EchoNote 3000" >nul 2>&1

netsh advfirewall firewall add rule name="EchoNote 3443" dir=in action=allow protocol=TCP localport=3443 profile=any
if errorlevel 1 goto fail
netsh advfirewall firewall add rule name="EchoNote 3000" dir=in action=allow protocol=TCP localport=3000 profile=any
if errorlevel 1 goto fail

echo.
echo ================================================================
echo  已放行 3000 和 3443 端口，与当前网络位置（公用/专用）无关。
echo.
echo  手机打开网站启动时打印的 https:// 地址即可。
echo ================================================================
echo.

rem --- step 3: print what was really added, so a silent failure is visible ---
netsh advfirewall firewall show rule name="EchoNote 3000"
echo.
pause
exit /b

:fail
echo.
echo [X] 添加规则失败。把上面的报错整段发给我。
echo.
pause
exit /b
