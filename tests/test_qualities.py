import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yt_dlp

import app


def media(format_id, height=None, size=1000, ext='mp4', audio=False):
    return dict(format_id=format_id, url=f'https://example.com/{format_id}',
                ext=ext, height=height, filesize=size,
                vcodec='none' if audio else 'avc1.640028',
                acodec='mp4a.40.2' if audio else 'none')


class QualityTests(unittest.TestCase):
    def setUp(self):
        self.data = dict(title='Test video', duration=10, formats=[
            media('audio', size=500, ext='m4a', audio=True),
            media('360', 360, 1000), media('720', 720, 2000),
            media('720-alternative', 720, 2200), media('1080', 1080, 3000),
            media('webm', 2160, ext='webm')])
        self.ydl = yt_dlp.YoutubeDL({'quiet': True})
        self.addCleanup(self.ydl.close)

    def test_only_downloadable_unique_mp4_resolutions(self):
        qualities = app.video_qualities(self.data, self.ydl)
        self.assertEqual([q['label'] for q in qualities], ['1080p', '720p', '360p'])
        self.assertEqual(app.video_qualities({}, self.ydl), [])
        self.assertEqual(app.video_qualities({'formats': [media('webm', 720, ext='webm')]}, self.ydl), [])

    def test_exact_resolution_and_missing_quality(self):
        selected = app.selected_streams(self.data, self.ydl, app.mp4_selector('mp4-720'))
        self.assertEqual(selected[0]['requested_formats'][0]['height'], 720)
        self.assertEqual(app.selected_streams(self.data, self.ydl, app.mp4_selector('mp4-480')), [])

    def test_estimates_include_audio_for_each_quality(self):
        qualities = app.video_qualities(self.data, self.ydl)
        sizes = app.size_previews(self.data, self.ydl, qualities)
        self.assertEqual(sizes['mp4-360'], 1500)
        self.assertEqual(sizes['mp4-1080'], 3500)
        self.assertEqual(sizes['mp3-128'], 160000)
        self.data['formats'][1].pop('filesize')
        sizes = app.size_previews(self.data, self.ydl, qualities)
        self.assertIsNone(sizes['mp4-360'])
        self.assertEqual(sizes['mp4-1080'], 3500)

    def test_info_endpoint_exposes_qualities(self):
        with patch.object(self.ydl, 'extract_info', return_value=self.data), \
                patch.object(app.yt_dlp, 'YoutubeDL', return_value=self.ydl):
            response = app.app.test_client().post('/api/info',
                base_url='http://127.0.0.1:8765', headers={'X-App-Token': app.TOKEN},
                json={'url': 'https://youtu.be/abcdefghijk'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['qualities'][0]['value'], 'mp4-1080')
        self.assertEqual(response.json['sizes']['mp4-360'], 1500)

    def test_resolution_download_uses_mp4_pipeline(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(app, 'DOWNLOADS', Path(directory)), \
                patch.object(app.yt_dlp, 'YoutubeDL') as downloader, \
                patch.object(app, 'slots'):
            def extract(*args, **kwargs):
                (Path(directory) / 'test-quality' / 'source.mp4').write_bytes(b'mp4')
                return {'title': 'Test'}
            downloader.return_value.__enter__.return_value.extract_info.side_effect = extract
            app.jobs['test-quality'] = {}
            try:
                app.run_job('test-quality', 'https://youtu.be/abcdefghijk', 'mp4-720')
                self.assertEqual(app.jobs['test-quality']['status'], 'done')
                self.assertTrue(app.jobs['test-quality']['filename'].endswith('.mp4'))
                self.assertEqual(downloader.call_args.args[0]['format'], app.mp4_selector('mp4-720'))
            finally:
                app.jobs.pop('test-quality', None)


if __name__ == '__main__':
    unittest.main()
