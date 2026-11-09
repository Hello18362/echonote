@echo off
chcp 65001 >nul
cd /d "%~dp0"
title EchoNote 服务 - 关掉本窗口即停止

rem 调用留痕，排查看 data\launcher.log
if not exist "data" mkdir "data"
echo [%date% %time%] 脚本被调用 >> "data\launcher.log"

where node >nul 2>&1
if errorlevel 1 (
  echo [X] 没找到 Node.js
  echo     请先安装 Node.js 18 或更高版本: https://nodejs.org
  echo.
  pause
  exit /b
)

set "HAS_CURL=1"
where curl >nul 2>&1
if errorlevel 1 set "HAS_CURL=0"

if "%HAS_CURL%"=="1" (
  curl -s -o nul --max-time 2 http://127.0.0.1:3000/
  if not errorlevel 1 goto already
)

if not exist "node_modules\next" (
  echo [1/2] 首次运行，正在安装依赖，大约 2 分钟...
  call npm install
  if errorlevel 1 goto fail
)

if not exist ".next\BUILD_ID" (
  echo [2/2] 正在构建，大约 1 分钟...
  call npm run build
  if errorlevel 1 goto fail
)

echo 正在启动 EchoNote...
start "" /b node -e "setTimeout(()=>require('child_process').exec('start http://127.0.0.1:3000'),6000)"
node scripts\boot.mjs
echo.
echo 服务已停止。
pause
exit /b

:already
echo 服务已经在运行，直接把地址告诉你。
echo.
node scripts\lan-url.mjs
start "" http://127.0.0.1:3000
echo.
pause
exit /b

:fail
echo.
echo 启动失败，请把上面的报错整段发给我。
pause
exit /b
