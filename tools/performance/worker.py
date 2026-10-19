"""Runs only inside disposable benchmark containers; never on installation data.

Map export deliberately includes all generated fixture chunks: no player has
explored this synthetic world. The tile/entity export loop is the panel code.
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import signal
import subprocess
import sys
import time
import zipfile
P = pathlib.Path
BIN = '/opt/factorio/bin/x64/factorio'
from importlib.machinery import SourceFileLoader
loader = SourceFileLoader('rcon', '/usr/local/bin/rcon')
spec = importlib.util.spec_from_loader('rcon', loader)
r = importlib.util.module_from_spec(spec)
loader.exec_module(r)
ROOT = P('/factorio')
PASSWORD = 'disposable-benchmark-password'

def emit(value):
    print(json.dumps(value), flush=True)

def command(text):
    return r.execute(text, PASSWORD)

def defaults():
    for name in ['config', 'saves', 'mods', 'script-output']:
        (ROOT / name).mkdir(parents=True, exist_ok=True)
    (ROOT / 'mods/mod-list.json').write_text(json.dumps({'mods': [{'name': name, 'enabled': name == 'base'} for name in ['base', 'quality', 'elevated-rails', 'space-age']]}))
    settings = json.loads(P('/opt/factorio/data/server-settings.example.json').read_text())
    settings.update(name='Disposable performance fixture', visibility={'public': False, 'lan': False}, require_user_verification=False, auto_pause=False, autosave_interval=0, non_blocking_saving=False)
    (ROOT / 'config/server-settings.json').write_text(json.dumps(settings))
    (ROOT / 'config/rconpw').write_text(PASSWORD)

def start(nonblocking=False):
    settings = json.loads((ROOT / 'config/server-settings.json').read_text())
    settings['non_blocking_saving'] = nonblocking
    (ROOT / 'config/server-settings.json').write_text(json.dumps(settings))
    log = (ROOT / 'server-output.log').open('w')
    p = subprocess.Popen([BIN, '--config', '/opt/factorio/config/config.ini', '--start-server', str(ROOT / 'saves/Benchmark.zip'), '--mod-directory', str(ROOT / 'mods'), '--server-settings', str(ROOT / 'config/server-settings.json'), '--rcon-port', '27015', '--rcon-password', PASSWORD], stdout=log, stderr=subprocess.STDOUT)
    for _ in range(600):
        if p.poll() is not None:
            raise RuntimeError((ROOT / 'server-output.log').read_text()[-3000:])
        try:
            if '2.0.77' in command('/version'):
                return (p, log)
        except (OSError, ValueError, ConnectionError):
            pass
        time.sleep(0.1)
    raise RuntimeError('Fixture server readiness timed out')

def stop(p, log):
    p.send_signal(signal.SIGTERM)
    try:
        p.wait(timeout=45)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait()
        raise
    log.close()
    if p.returncode:
        raise RuntimeError('Fixture server exited ' + str(p.returncode))

def wait_save(offset):
    for _ in range(600):
        value = (ROOT / 'server-output.log').read_text()[offset:]
        if 'Saving finished' in value or 'Saving progress: 100' in value:
            return
        time.sleep(0.05)
    raise RuntimeError('Fixture save timeout')

def fixture():
    defaults()
    (ROOT / 'config/map-gen.json').write_text(json.dumps({'seed': 987654321, 'width': 512, 'height': 512, 'water': 0, 'autoplace_controls': {'enemy-base': {'frequency': 0}}}))
    subprocess.run([BIN, '--create', str(ROOT / 'saves/Benchmark.zip'), '--mod-directory', str(ROOT / 'mods'), '--map-gen-settings', str(ROOT / 'config/map-gen.json')], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, check=True)
    p, log = start()
    try:
        lua = 'if not storage.performance_fixture then local s=game.surfaces.nauvis;s.request_to_generate_chunks({0,0},8);s.force_generate_chunk_requests();for _,e in pairs(s.find_entities()) do if e.type~="character" then e.destroy() end end;for y=0,99 do for x=0,99 do local e=s.create_entity{name="steel-furnace",position={x*3-150,y*3-150},force="player"};e.insert{name="iron-ore",count=100};e.insert{name="coal",count=50} end end;game.forces.player.chart_all(s);storage.performance_fixture=true end;game.tick_paused=true;rcon.print("FIXTURE_READY")'
        value = command('/silent-command ' + lua)
        if 'FIXTURE_READY' not in value:
            value = command('/silent-command ' + lua)
        assert 'FIXTURE_READY' in value, value
        offset = len((ROOT / 'server-output.log').read_text())
        command('/server-save Benchmark')
        wait_save(offset)
    finally:
        stop(p, log)
    archive = zipfile.ZipFile(ROOT / 'saves/Benchmark.zip')
    assert archive.testzip() is None
    emit({'fixture_sha256': hashlib.sha256((ROOT / 'saves/Benchmark.zip').read_bytes()).hexdigest(), 'save_bytes': (ROOT / 'saves/Benchmark.zip').stat().st_size, 'entities': 10000, 'seed': 987654321})

def server():
    p, log = start()
    emit({'ready': True})
    try:
        while True:
            time.sleep(0.2)
    finally:
        stop(p, log)

def export():
    p, log = start()
    init = ' '.join(P('/bench/map-init.lua').read_text().split()).replace('if f.is_chunk_charted(s,c) then', 'if true then')
    batch = ' '.join(P('/bench/map-batch.lua').read_text().split())
    iterations = 0
    t = time.monotonic()
    try:
        emit({'ready': True})
        while True:
            value = command('/silent-command ' + init)
            if 'MAP_CHUNKS=' not in value:
                value = command('/silent-command ' + init)
            count = int(value.split('MAP_CHUNKS=')[-1].strip())
            assert count > 0, 'Fixture must contain generated chunks'
            for n in range(1, count + 1, 16):
                value = command('/silent-command ' + batch.replace('MAP_START', str(n)))
                assert 'MAP_BATCH_OK' in value, value
            iterations += 1
            emit({'exports': iterations, 'seconds': time.monotonic() - t, 'chunks': count})
    finally:
        stop(p, log)

def scan_baseline(paths, uid, gid):
    count = 0
    for directory in set(paths):
        for parent, directories, files in os.walk(directory, followlinks=False):
            for file in (P(parent), *(P(parent) / name for name in directories + files)):
                info = file.lstat()
                count += 1
                if (info.st_uid, info.st_gid) != (uid, gid):
                    os.chown(file, uid, gid, follow_symlinks=False)
    return count
candidate_namespace = {'__name__': 'ownership_candidate'}
if 'candidate_source' in globals():
    exec(compile(candidate_source, 'candidate-entrypoint.py', 'exec'), candidate_namespace)

def scan_candidate(paths, uid, gid):
    candidate_namespace['ensure_ownership'](paths, uid, gid)

def storage():
    output = {}
    for label, root in [('volume', P('/factorio/scan')), ('bind', P('/bind/scan'))]:
        paths = [root] + [root / folder for folder in ['saves', 'config', 'mods', 'scenarios', 'script-output']]
        t = time.monotonic()
        for directory in paths[1:]:
            directory.mkdir(parents=True, exist_ok=True)
            for n in range(2000):
                (directory / (str(n) + '.dat')).write_bytes(b'benchmark')
        create = time.monotonic() - t
        values = {'baseline': [], 'candidate': []}
        counts = {}
        for order in [('baseline', 'candidate'), ('candidate', 'baseline')] * 3:
            for mode in order:
                t = time.perf_counter()
                counts[mode] = (scan_baseline if mode == 'baseline' else scan_candidate)(paths, os.getuid(), os.getgid())
                values[mode].append(time.perf_counter() - t)
        counts['candidate'] = len(list(candidate_namespace['ownership_entries'](paths)))
        payload = os.urandom(16 * 1024 * 1024)
        times = []
        for _ in range(3):
            target = root / 'save-write.bin'
            t = time.perf_counter()
            with target.open('wb') as file:
                file.write(payload)
                file.flush()
                os.fsync(file.fileno())
            times.append(time.perf_counter() - t)
        output[label] = {'files': 10000, 'create_seconds': create, 'scan_seconds': values, 'visited': counts, 'write_fsync_16MiB_seconds': times}
    emit(output)

def benchmark():
    import resource
    before = time.monotonic()
    value = subprocess.run([BIN, '--benchmark', str(ROOT / 'saves/Benchmark.zip'), '--benchmark-ticks', '1200', '--benchmark-runs', '1', '--mod-directory', str(ROOT / 'mods')], capture_output=True, text=True, timeout=180)
    assert value.returncode == 0, value.stdout[-2000:] + value.stderr
    lines = [line for line in value.stdout.splitlines() if 'Performed' in line or 'avg:' in line or 'Checksum' in line]
    emit({'wall_seconds': time.monotonic() - before, 'timing': lines, 'peak_kib': resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss})

def savebench():
    import threading
    results = {}
    for mode in [False, True]:
        p, log = start(mode)
        samples = []
        probes = []
        done = threading.Event()

        def probe():
            while not done.is_set():
                before = time.perf_counter()
                try:
                    command('/time')
                    probes.append(time.perf_counter() - before)
                except Exception:
                    break
                done.wait(0.02)
        thread = None
        try:
            command('/silent-command game.tick_paused=false')
            thread = threading.Thread(target=probe)
            thread.start()
            time.sleep(0.2)
            for n in range(3):
                offset = len((ROOT / 'server-output.log').read_text())
                before = time.perf_counter()
                command('/server-save Save-benchmark')
                wait_save(offset)
                duration = time.perf_counter() - before
                samples.append({'save_seconds': duration, 'log': (ROOT / 'server-output.log').read_text()[offset:]})
                time.sleep(0.2)
            results[str(mode)] = {'samples': samples, 'probe_seconds': probes}
        except Exception as error:
            results[str(mode)] = {'error': str(error), 'samples': samples, 'probe_seconds': probes, 'log': (ROOT / 'server-output.log').read_text()[-6000:]}
        finally:
            done.set()
            if thread:
                thread.join(timeout=12)
            try:
                stop(p, log)
            except Exception as error:
                results[str(mode)]['shutdown_error'] = str(error)
    emit(results)
if __name__ == '__main__':
    globals()[sys.argv[1]]()
