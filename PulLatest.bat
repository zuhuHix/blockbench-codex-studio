@echo off
setlocal
cd /d "%~dp0"

echo [1/4] Checking repository...
git rev-parse --is-inside-work-tree >nul 2>&1 || goto :not_repo

echo [2/4] Fetching and fast-forwarding main...
git fetch --prune origin || goto :failed
git switch main || goto :failed
git merge --ff-only origin/main || goto :not_fast_forward

echo [3/4] Installing dependencies...
call npm install || goto :failed

echo [4/4] Building Blockbench Codex Studio...
call npm run build || goto :failed

echo.
echo Update and build completed successfully.
echo Load this plugin file in Blockbench:
echo %CD%\apps\blockbench-plugin\dist\blockbench_codex_studio.js
goto :done

:not_repo
echo ERROR: %CD% is not a Git repository.
goto :failed_pause

:not_fast_forward
echo ERROR: main cannot be fast-forwarded safely.
echo Your commits and files were left untouched. Resolve the branch divergence first.
goto :failed_pause

:failed
echo.
echo ERROR: Update or build failed. No local changes were discarded.

:failed_pause
echo.
pause
exit /b 1

:done
echo.
pause
exit /b 0
