"""Own the app's browser window and server so Close can end both reliably."""
import ctypes
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from werkzeug.serving import make_server


def find_browser():
    for root in ('PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'):
        base = os.environ.get(root)
        if not base:
            continue
        for relative in ('Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe'):
            path = Path(base) / relative
            if path.is_file():
                return str(path)
    for name in ('msedge', 'chrome', 'chromium', 'chromium-browser', 'google-chrome'):
        found = shutil.which(name)
        if found:
            return found
    raise RuntimeError('Não foi possível localizar Microsoft Edge ou Google Chrome para abrir o Violet.')


def close_browser(browser):
    if browser.poll() is not None:
        return
    if os.name == 'nt':
        from ctypes import wintypes
        user32 = ctypes.WinDLL('user32', use_last_error=True)
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
        user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]

        @callback_type
        def close_window(window, _):
            process_id = wintypes.DWORD()
            user32.GetWindowThreadProcessId(window, ctypes.byref(process_id))
            if process_id.value == browser.pid:
                user32.PostMessageW(window, 0x0010, 0, 0)  # WM_CLOSE, only this app's process.
            return True

        user32.EnumWindows(close_window, 0)
    else:
        browser.terminate()
    try:
        browser.wait(timeout=3)
    except subprocess.TimeoutExpired:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(browser.pid), '/T', '/F'],
                           capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)
        else:
            browser.kill()
        browser.wait(timeout=5)


def run_desktop(app, port=8765, browser_args=()):
    executable = find_browser()
    # Binding first prevents launching a second window when the app is already running.
    server = make_server('127.0.0.1', port, app, threaded=True)
    stopped = threading.Event()
    app.config['SHUTDOWN_CALLBACK'] = stopped.set
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    browser = None
    # A separate, per-launch profile keeps the app independent of personal browser tabs.
    profile = tempfile.mkdtemp(prefix='violet-browser-')
    profile_path = Path(profile).resolve()
    try:
        worker.start()
        browser = subprocess.Popen([
            executable, f'--app=http://127.0.0.1:{port}/', f'--user-data-dir={profile}',
            '--no-first-run', '--no-default-browser-check', '--disable-background-mode',
            '--edge-skip-compat-layer-relaunch', *browser_args,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        while not stopped.wait(0.2):
            if browser.poll() is not None:
                break
    except KeyboardInterrupt:
        pass
    finally:
        if browser is not None:
            close_browser(browser)
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)
        # Delete only the unique temporary profile created above.
        if profile_path.parent == Path(tempfile.gettempdir()).resolve() and profile_path.name.startswith('violet-browser-'):
            shutil.rmtree(profile_path, ignore_errors=True)
