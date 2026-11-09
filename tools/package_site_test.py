import tempfile
from pathlib import Path
import unittest
from package_site import ASSETS, package_site


class ReleaseTests(unittest.TestCase):
    def test_coherent_release_and_stable_repackaging(self):
        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp)
            for name in ASSETS:
                (site / name).write_bytes(b'wasm' if name.endswith('.wasm') else b'content\r\n')
            (site / 'index.html').write_bytes(b'<link href="style.css"><script src="boids.js"></script><script src="app.js"></script>\r\n')
            first = package_site(site)
            html = (site / 'index.html').read_text()
            for name in ('style.css', 'boids.js', 'app.js'):
                self.assertIn(f'assets/{first}/{name}', html)
            for name in ASSETS:
                self.assertTrue((site / 'assets' / first / name).exists())
            self.assertEqual(first, package_site(site))
            for name in ASSETS:
                if not name.endswith('.wasm'):
                    (site / name).write_bytes(b'content\n')
            self.assertEqual(first, package_site(site))
            (site / 'boids.wasm').write_bytes(b'new-wasm')
            second = package_site(site)
            self.assertNotEqual(first, second)
            self.assertNotIn(first, (site / 'index.html').read_text())
            self.assertEqual(b'wasm', (site / 'assets' / first / 'boids.wasm').read_bytes())
            self.assertEqual(b'new-wasm', (site / 'assets' / second / 'boids.wasm').read_bytes())


if __name__ == '__main__':
    unittest.main()
