#!/usr/bin/env python3
"""
Генератор демонстрационных треков для «Матушки».

Создаёт три коротких инструментальных фрагмента (WAV, 12 секунд) —
по одному на демо-артиста. Нужны только для проверки плеера и волны.
Настоящие треки кладутся в audio/ в формате mp3, а этот скрипт можно удалить.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import struct
import wave

SR = 22050
DURATION = 12.0

CONFIGS = [
    {
        "file": "audio/demo/berezovyi-svet.wav",
        "seed": 7,
        "bpm": 74,
        "chords": [
            [146.83, 174.61, 220.00],  # Dm
            [130.81, 164.81, 196.00],  # C
            [116.54, 146.83, 174.61],  # Bb
            [110.00, 130.81, 164.81],  # Am
        ],
        "pluck": [0.55, 0.40, 0.30],
        "drone": 73.42,
        "brightness": 0.9,
    },
    {
        "file": "audio/demo/severnyi-veter.wav",
        "seed": 21,
        "bpm": 88,
        "chords": [
            [110.00, 130.81, 164.81],  # Am
            [98.00, 123.47, 146.83],   # G
            [87.31, 110.00, 130.81],   # F
            [82.41, 103.83, 123.47],   # E
        ],
        "pluck": [0.62, 0.34, 0.22],
        "drone": 55.00,
        "brightness": 1.0,
    },
    {
        "file": "audio/demo/anna-vetrova.wav",
        "seed": 42,
        "bpm": 96,
        "chords": [
            [98.00, 123.47, 146.83],   # G
            [110.00, 138.59, 164.81],  # A
            [123.47, 155.56, 185.00],  # Bm
            [146.83, 185.00, 220.00],  # D
        ],
        "pluck": [0.52, 0.42, 0.34],
        "drone": 98.00,
        "brightness": 1.15,
    },
]


def add_pluck(buf, start, freq, amp, brightness):
    """Мягкий щипковый звук с затуханием."""
    begin = int(start * SR)
    length = int(2.6 * SR)
    vib_rate = 4.1

    for i in range(length):
        idx = begin + i
        if idx >= len(buf):
            break

        t = i / SR
        attack = min(1.0, t / 0.014)
        decay = math.exp(-t * 2.1)
        env = attack * decay
        if env < 0.0005:
            break

        vibrato = 1.0 + 0.0022 * math.sin(2 * math.pi * vib_rate * t)
        w = 2 * math.pi * freq * vibrato * t
        sample = math.sin(w)
        sample += 0.42 * brightness * math.sin(2 * w) * math.exp(-t * 3.4)
        sample += 0.18 * brightness * math.sin(3 * w) * math.exp(-t * 5.2)

        buf[idx] += sample * env * amp


def add_pad(buf, start, duration, freqs, amp):
    """Тёплая подложка-аккорд."""
    begin = int(start * SR)
    length = int(duration * SR)

    for i in range(length):
        idx = begin + i
        if idx >= len(buf):
            break

        t = i / SR
        attack = min(1.0, t / 0.9)
        release = min(1.0, max(0.0, (duration - t) / 0.8))
        env = attack * release
        if env <= 0:
            continue

        sample = 0.0
        for k, freq in enumerate(freqs):
            drift = 1.0 + 0.0015 * math.sin(2 * math.pi * (0.13 + k * 0.05) * t)
            sample += math.sin(2 * math.pi * freq * drift * t)
            sample += 0.25 * math.sin(2 * math.pi * freq * 2.0 * t)
        buf[idx] += (sample / (len(freqs) * 1.25)) * env * amp


def add_drone(buf, freq, amp):
    """Низкий гул, чтобы звучало плотнее."""
    for i in range(len(buf)):
        t = i / SR
        fade = min(1.0, t / 1.5) * min(1.0, max(0.0, (DURATION - t) / 1.8))
        buf[i] += math.sin(2 * math.pi * freq * t) * amp * fade


def render(config):
    rng = random.Random(config["seed"])
    buf = [0.0] * int(SR * DURATION)

    add_drone(buf, config["drone"], 0.075)

    bar_len = 60.0 / config["bpm"] * 4
    bars = math.ceil(DURATION / bar_len)

    for bar in range(bars):
        chord = config["chords"][bar % len(config["chords"])]
        bar_start = bar * bar_len

        add_pad(buf, bar_start, min(bar_len + 0.6, DURATION - bar_start), chord, 0.16)

        # Арпеджио: восьмые ноты по нотам аккорда с октавой сверху.
        step = bar_len / 8
        pattern = [0, 1, 2, 1, 3, 2, 1, 0]

        for k, note_index in enumerate(pattern):
            freq = chord[note_index % 3] * (2.0 if note_index >= 3 else 1.0)
            if rng.random() < 0.22:
                continue
            amp = config["pluck"][k % len(config["pluck"])]
            amp *= rng.uniform(0.82, 1.0)
            add_pluck(
                buf,
                bar_start + k * step,
                freq,
                amp,
                config["brightness"],
            )

    # Фейды и мягкое ограничение.
    fade_in = int(0.35 * SR)
    fade_out = int(1.4 * SR)
    for i in range(fade_in):
        buf[i] *= i / fade_in
    for i in range(fade_out):
        buf[len(buf) - fade_out + i] *= 1.0 - (i / fade_out)

    peak = max(abs(x) for x in buf) or 1.0
    scale = 0.82 / peak

    return [
        max(-1.0, min(1.0, math.tanh(x * scale * 1.05) * 0.98))
        for x in buf
    ]


def write_wav(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    frames = b"".join(
        struct.pack("<h", int(sample * 32767)) for sample in samples
    )
    with wave.open(path, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        wav.writeframes(frames)


def main():
    parser = argparse.ArgumentParser(description="Демо-треки для «Матушки»")
    parser.add_argument(
        "--root",
        default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        help="Корень проекта",
    )
    args = parser.parse_args()

    for config in CONFIGS:
        path = os.path.join(args.root, config["file"])
        print(f"Генерация {config['file']} ...", flush=True)
        samples = render(config)
        write_wav(path, samples)
        size = os.path.getsize(path) / 1024
        print(f"  готово: {size:.0f} КБ, {DURATION:.0f} с")


if __name__ == "__main__":
    main()
