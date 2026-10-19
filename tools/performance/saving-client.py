"""Identical RCON/save workload for both normal-startup comparison images.

Runs in a disposable client sharing only the private server network namespace
and a read-only mount of that trial's newly created volume.
"""
import json
from pathlib import Path
import threading
import time

# The runner provides the same first-party RCON library for every image.
library = {'__name__': 'comparison_rcon'}
exec(compile(rcon_source, 'comparison-rcon.py', 'exec'), library)
LOG = Path('/subject/factorio-current.log')
PASSWORD = 'disposable-benchmark-password'


def command(text):
    return library['execute'](text, PASSWORD)


def log():
    return LOG.read_text(errors='replace') if LOG.exists() else ''


def run():
    result = {'samples': [], 'probe_seconds': [], 'probe_errors': []}
    done = threading.Event()
    thread = None

    def probe():
        while not done.is_set():
            before = time.perf_counter()
            try:
                command('/time')
                result['probe_seconds'].append(time.perf_counter() - before)
            except Exception as error:
                result['probe_errors'].append(str(error))
                break
            done.wait(.02)

    try:
        for _ in range(600):
            try:
                version = command('/version').strip()
                if '2.0.77' in version:
                    result['version'] = version
                    break
            except (OSError, ValueError, ConnectionError):
                pass
            time.sleep(.1)
        else:
            raise RuntimeError('Fixture server readiness timed out')
        result['ready'] = True
        command('/silent-command game.tick_paused=false')
        thread = threading.Thread(target=probe)
        thread.start()
        time.sleep(.2)
        for _ in range(3):
            offset = len(log())
            before = time.perf_counter()
            command('/server-save Save-benchmark')
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                text = log()[offset:]
                if 'Saving finished' in text or 'Saving progress: 100' in text:
                    break
                time.sleep(.05)
            else:
                raise RuntimeError('Fixture save timeout')
            result['samples'].append({'save_seconds': time.perf_counter() - before,
                                      'log': log()[offset:]})
            time.sleep(.2)
        # Check survival rather than treating a completed child save as success.
        for _ in range(10):
            command('/time')
            time.sleep(.1)
        result['post_save_rcon'] = True
    except Exception as error:
        result['error'] = str(error)
    finally:
        done.set()
        if thread:
            thread.join(timeout=12)
        result['game_log_tail'] = log()[-10000:]
        print(json.dumps(result), flush=True)


run()
