#!/usr/bin/env python3
"""Локальный сервер для проверки сайта: python tools/serve.py"""

from __future__ import annotations

import argparse
import http.server
import os
import socket
import webbrowser


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"  {fmt % args}")


def main():
    parser = argparse.ArgumentParser(description="Локальный запуск «Матушки»")
    parser.add_argument("--port", type=int, default=5500)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)

    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as error:
        print(f"Не удалось занять порт {args.port}: {error}")
        raise SystemExit(1)

    url = f"http://127.0.0.1:{args.port}/"
    print(f"Матушка запущена: {url}")
    print("Остановить: Ctrl+C")

    if not args.no_open:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановлено.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
