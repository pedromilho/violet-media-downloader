import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app


class ImageSavingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.client = app.app.test_client()
        self.headers = {'X-App-Token': app.TOKEN}
        for target, value in [('IMAGE_SETTINGS', self.folder / 'settings.json'),
                              ('image_default_folder', ''), ('image_folders', {})]:
            patcher = patch.object(app, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def post(self, path, **kwargs):
        return self.client.post(path, base_url='http://127.0.0.1:8765', headers=self.headers, **kwargs)

    def test_native_selection_cancellation_and_default(self):
        result = subprocess.CompletedProcess([], 0, json.dumps(str(self.folder)).encode())
        with patch.object(app.subprocess, 'run', return_value=result) as picker:
            chosen = self.post('/api/images/folder', json={})
        self.assertEqual(chosen.status_code, 200)
        self.assertEqual(chosen.json['folder'], str(self.folder))
        self.assertIn('Escolha a pasta para salvar a imagem', picker.call_args.args[0])
        key = chosen.json['key']
        self.assertEqual(self.post('/api/images/default-folder', json={'key': key}).status_code, 200)
        self.assertEqual(json.loads(app.IMAGE_SETTINGS.read_text())['folder'], str(self.folder))
        restored = self.client.get('/api/images/folder', base_url='http://127.0.0.1:8765')
        self.assertEqual(restored.json['folder'], str(self.folder))
        with patch.object(app.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'""')):
            cancelled = self.post('/api/images/folder', json={'key': key})
        self.assertTrue(cancelled.json['cancelled'])
        self.assertEqual(app.image_default_folder, str(self.folder))
        self.assertEqual(self.post('/api/images/default-folder', json={'clear': True}).status_code, 200)
        self.assertEqual(app.image_default_folder, '')

    def test_save_formats_and_preserve_existing_files(self):
        key = app.image_folder_choice(str(self.folder))['key']
        for mime, suffix, contents in [('image/png', 'png', b'\x89PNG\r\n\x1a\n' + b'example' * 1000),
                                       ('image/jpeg', 'jpg', b'\xff\xd8\xffexample'),
                                       ('image/webp', 'webp', b'RIFF1234WEBPexample')]:
            for number in range(2):
                response = self.post(f'/api/images/save?key={key}&name=imagem', data=contents, content_type=mime)
                self.assertEqual(response.status_code, 200)
                expected = f'imagem{ " (1)" if number else ""}.{suffix}'
                self.assertEqual(response.json['filename'], expected)
                self.assertEqual((self.folder / expected).read_bytes(), contents)

    def test_invalid_content_folder_and_missing_token(self):
        key = app.image_folder_choice(str(self.folder))['key']
        self.assertEqual(self.post(f'/api/images/save?key={key}', data=b'not an image', content_type='image/png').status_code, 400)
        self.assertEqual(self.post('/api/images/save?key=unknown', data=b'bad').status_code, 400)
        self.assertEqual(self.post('/api/images/default-folder', json={'key': 'unknown'}).status_code, 400)
        self.assertEqual(self.client.post('/api/images/folder', base_url='http://127.0.0.1:8765').status_code, 403)
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_picker_failure_releases_dialog_lock(self):
        with patch.object(app.subprocess, 'run', side_effect=subprocess.TimeoutExpired('picker', 300)):
            self.assertEqual(self.post('/api/images/folder', json={}).status_code, 408)
        self.assertFalse(app.picker_lock.locked())


if __name__ == '__main__':
    unittest.main()
