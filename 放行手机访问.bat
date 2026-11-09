@echo off
chcp 65001 >nul
title EchoNote - 放行手机访问

rem 手机连不上电脑时，十有八九是 Windows 防火墙把入站挡了。
rem 这个脚本加两条入站放行规则，只需要执行一次。
rem 用法：右键本文件 -> 以管理员身份运行

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo [X] 需要管理员权限。
  echo.
  echo     请关闭本窗口，然后在文件上点右键，
  echo     选择「以管理员身份运行」。
  echo.
  pause
  exit /b
)

echo 正在放行端口...
netsh advfirewall firewall delete rule name="EchoNote 3443" >nul 2>&1
netsh advfirewall firewall delete rule name="EchoNote 3000" >nul 2>&1

netsh advfirewall firewall add rule name="EchoNote 3443" dir=in action=allow protocol=TCP localport=3443 profile=any
netsh advfirewall firewall add rule name="EchoNote 3000" dir=in action=allow protocol=TCP localport=3000 profile=any
if errorlevel 1 goto fail

echo.
echo ================================================================
echo  已放行 3000 和 3443 端口。
echo.
echo  现在回手机上重新打开那个 https:// 地址试试。
echo  如果还不行，确认手机和电脑之间真的有链路（USB 共享网络 /
echo  同一个路由器），并且启动网站.bat 打印的地址和手机上输入的一致。
echo ================================================================
echo.
pause
exit /b

:fail
echo.
echo [X] 添加规则失败。把上面的报错整段发给我。
pause
exit /b
