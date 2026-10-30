import threading
import unittest
from unittest.mock import patch

import app


class ShutdownTests(unittest.TestCase):
    def post(self):
        return app.app.test_client().post('/api/shutdown', base_url='http://127.0.0.1:8765',
                                          headers={'X-App-Token': app.TOKEN}, json={})

    def test_schedules_desktop_close(self):
        stopped = threading.Event()
        with patch.object(app, 'slots', threading.BoundedSemaphore(2)), \
                patch.dict(app.app.config, SHUTDOWN_CALLBACK=stopped.set), \
                patch.object(app.threading, 'Timer') as timer:
            self.assertEqual(self.post().status_code, 200)
            timer.assert_called_once_with(0.3, stopped.set)
            timer.return_value.start.assert_called_once()

    def test_active_download_prevents_shutdown_without_losing_slot(self):
        slots = threading.BoundedSemaphore(2)
        slots.acquire()
        with patch.object(app, 'slots', slots), patch.object(app.threading, 'Timer') as timer:
            self.assertEqual(self.post().status_code, 409)
            timer.assert_not_called()
            self.assertTrue(slots.acquire(blocking=False))
            self.assertFalse(slots.acquire(blocking=False))


if __name__ == '__main__':
    unittest.main()
