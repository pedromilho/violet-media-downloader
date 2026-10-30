my personal youtube video downloader with a local image editor.

Open `Iniciar.bat` to launch the app. Use the arrow beside Violet to switch between the downloader and the image editor.

Violet opens in its own Edge/Chrome app window. “Fechar” closes this window and stops the local server; the launcher then exits its terminal. The app uses a separate temporary browser profile, independent of personal browser windows.

The editor supports cropping (drag in the preview or enter pixel coordinates), horizontal/vertical flips, 90° rotations, resizing, undo and restoring the original. Export to PNG, JPG or WebP. Images are processed in the browser; JPG exports flatten transparency onto white.

Saving an image opens the Windows folder picker. Choose “Utilizar como pasta padrão” to reuse that folder across app restarts; the editor also allows changing or removing it. Images are saved locally without overwriting existing files.

Validation: `.venv/Scripts/python.exe -m unittest discover -s tests -v`. Browser checks: `node tests/image-editor.cjs` with Playwright installed or available through `NODE_PATH`.
