"""Windows real WASAPI regression: python tests/audio/verify.py (after dotnet build).

Uses quiet test tones in separate real processes, including a child process,
without interacting with an installed Discord or changing its audio settings.
"""
import collections
import math
import pathlib
import shutil
import struct
import subprocess
import threading
import time

directory = pathlib.Path(__file__).parent / 'bin/Release/net10.0-windows10.0.19041.0'
executable = directory / 'Telae.Audio.Tests.exe'
excluded_exe = directory / 'TelaeExcludedTone.exe'
shutil.copy2(executable, excluded_exe)
processes = []
chunks = collections.deque(maxlen=64)
errors = []


def start(exe, *args, capture=False):
    process = subprocess.Popen([str(exe), *args], stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                               stderr=subprocess.PIPE if capture else subprocess.DEVNULL,
                               creationflags=subprocess.CREATE_NO_WINDOW)
    processes.append(process)
    return process


def stop(process):
    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
    process.wait(timeout=10)


def amplitude(frequency, data=None):
    data = (b''.join(list(chunks)) if data is None else data)[-38400:]
    assert len(data) >= 38400, 'Filtered recorder did not deliver PCM'
    samples = struct.unpack('<9600f', data)[::2]
    angle = 2 * math.pi * frequency / 48000
    window = [.5 - .5 * math.cos(2 * math.pi * n / (len(samples) - 1)) for n in range(len(samples))]
    real = sum(x * window[n] * math.cos(angle * n) for n, x in enumerate(samples))
    imag = sum(x * window[n] * math.sin(angle * n) for n, x in enumerate(samples))
    return 2 * math.hypot(real, imag) / sum(window)


def check(stage, audible=True):
    time.sleep(1.5)
    assert bridge.poll() is None, f'Recorder stopped: {errors}'
    assert allowed.poll() is None, 'Tone player stopped unexpectedly'
    included, excluded = amplitude(15311), amplitude(17789)
    print(f'PCM peak={max(map(abs, struct.unpack("<9600f", b"".join(list(chunks))[-38400:]))):.6f}', flush=True)
    print(f'{stage}: other app={included:.6f}, excluded app={excluded:.6f}', flush=True)
    assert excluded < .0005, f'Excluded audio leaked during {stage}'
    if audible:
        assert included > .001, f'Other application audio missing during {stage}'
    else:
        assert included < .00015, 'Multiple independent excluded trees must fail closed'


try:
    allowed = start(executable, 'tone', '15311')
    bridge = start(executable, 'capture', capture=True)

    def read_audio():
        while data := bridge.stdout.read(7680):
            chunks.append(data)

    def read_errors():
        for line in bridge.stderr:
            errors.append(line.decode().strip())

    threading.Thread(target=read_audio, daemon=True).start()
    threading.Thread(target=read_errors, daemon=True).start()
    check('without excluded app')
    excluded = start(excluded_exe, 'parent')
    check('excluded app starts with audio in its child')
    # A positive control proves the excluded app is still rendering locally;
    # the filter must not mute Discord's own playback or communication.
    control = start(pathlib.Path('apps/desktop/build/audio-bridge/Telae.AudioBridge.exe'),
                    'capture', '--pid', str(excluded.pid), capture=True)
    assert b'TELAE_FORMAT' in control.stderr.readline()
    control_data = control.stdout.read(192000)
    stop(control)
    assert amplitude(17789, control_data) > .001, 'Excluded app is not playing its test tone locally'
    print('PASS: excluded application still renders locally while absent from the outgoing mix', flush=True)
    stop(excluded)
    check('excluded app closes')
    excluded = start(excluded_exe, 'parent')
    check('excluded app restarts')
    second = start(excluded_exe, 'parent')
    check('two independent excluded trees', audible=False)
    stop(second)
    check('recovers after second tree closes')
    print('PASS: real PCM exclusion, child audio, launch/restart, safe multi-tree handling')
finally:
    for process in reversed(processes):
        if process.poll() is None:
            stop(process)
