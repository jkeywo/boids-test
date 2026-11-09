"""Publish a coherent set of assets under a content-addressed release URL."""
import hashlib
import json
from pathlib import Path
import re

ASSETS = ('app.js', 'boids.js', 'boids.wasm', 'gpu.js', 'gpu-render.wgsl',
          'gpu-sim.wgsl', 'style.css')


def package_site(site):
    site = Path(site)
    content = {name: (site / name).read_bytes() for name in (*ASSETS, 'index.html')}
    for name in content:
        if name != 'boids.wasm':
            content[name] = content[name].replace(b'\r\n', b'\n')
    # Also support repackaging the existing output without nesting release paths.
    content['index.html'] = re.sub(rb'"assets/[0-9a-f]{24}/(style.css|boids.js|app.js)"',
                                 rb'"\1"', content['index.html'])
    digest = hashlib.sha256()
    for name, data in content.items():
        digest.update(name.encode() + b'\0' + str(len(data)).encode() + b'\0' + data)
    release = digest.hexdigest()[:24]
    prefix = f'assets/{release}/'
    target = site / prefix
    target.mkdir(parents=True, exist_ok=True)
    for name in ASSETS:
        (target / name).write_bytes(content[name])
    html = content['index.html'].decode('utf-8')
    for name in ('style.css', 'boids.js', 'app.js'):
        html = html.replace(f'"{name}"', f'"{prefix}{name}"')
    (site / 'index.html').write_bytes(html.encode('utf-8'))
    (site / 'release.json').write_text(json.dumps({'release': release, 'assets': prefix})+'\n', encoding='utf-8')
    print(f'Packaged release {release}', flush=True)
    return release


if __name__ == '__main__':
    package_site(Path(__file__).resolve().parents[1] / 'build/site')
