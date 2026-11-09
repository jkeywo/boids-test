#!/usr/bin/env python3
"""Build with Emscripten 4.0.23. No npm step is required for the site."""
import argparse
import os
import pathlib
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
# Disable unused Flecs application/server addons, including their WASM exports.
FLECS_FLAGS = ['-DFLECS_NO_APP', '-DFLECS_NO_HTTP', '-DFLECS_NO_REST']


def compiler(name):
    found = shutil.which(name)
    if found:
        return found
    local = ROOT / '.tools/emsdk/upstream/emscripten' / (name + ('.bat' if os.name == 'nt' else ''))
    if local.exists():
        return str(local)
    raise SystemExit('Install/activate Emscripten 4.0.23 first; see README.md')


def run(args):
    print(' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), check=True, cwd=ROOT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--test', action='store_true')
    args = parser.parse_args()
    out = ROOT / 'build'
    out.mkdir(exist_ok=True)
    run([compiler('emcc'), '-O3', '-DNDEBUG', *FLECS_FLAGS,
         '-c', 'vendor/flecs.c', '-o', out / 'flecs.o'])
    common = [compiler('em++'), '-std=c++20', '-O3', '-flto', '-DNDEBUG',
              '-sSTACK_SIZE=1048576', *FLECS_FLAGS, '-Ivendor', '-Isrc',
              'src/simulation.cpp', out / 'flecs.o']
    if args.test:
        run(common + ['tests/simulation_test.cpp', '-sENVIRONMENT=node',
                      '-sEXIT_RUNTIME=1', '-sALLOW_MEMORY_GROWTH=1',
                      '-sSTACK_OVERFLOW_CHECK=2', '-o', out / 'simulation_test.js'])
        node = shutil.which('node')
        if not node:
            raise SystemExit('Install Node.js to run the WASM simulation tests.')
        run([node, out / 'simulation_test.js'])
    site = out / 'site'
    site.mkdir(exist_ok=True)
    run(common + ['src/browser.cpp', '--no-entry', '-sMIN_WEBGL_VERSION=2',
                  '-sMAX_WEBGL_VERSION=2', '-sMODULARIZE=1', '-sEXPORT_NAME=createBoids',
                  '-sENVIRONMENT=web', '-sEXPORTED_RUNTIME_METHODS=UTF8ToString', '-sALLOW_MEMORY_GROWTH=1',
                  '-sINITIAL_MEMORY=33554432', '-sFILESYSTEM=0', '-o', site / 'boids.js'])
    for file in (ROOT / 'web').iterdir():
        shutil.copy2(file, site / file.name)


if __name__ == '__main__':
    main()
