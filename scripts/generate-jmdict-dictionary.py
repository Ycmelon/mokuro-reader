#!/usr/bin/env python3
"""Build the bundled jmdict dictionary asset (static/jmdict.zip).

Downloads (or reads) the jmdict-simplified English release, trims each entry to
the fields the reader uses, and repackages the words into a chunked zip:

    index.json          -> { format, title, revision, wordCount }
    term_bank_1.json    -> [ <trimmed word>, ... ]
    term_bank_2.json    -> ...

The trimmed word keeps short keys to stay small (the zip compresses the repeated
keys well). All JMdict -> reader mapping (POS -> deinflection rules, obscurity,
sense grouping) is done in TypeScript at import time so the logic has a single
source of truth; this script only trims and chunks.

Trimmed word shape:
    {
      "i": <int id>,
      "k": [[text, [info_tags], common01], ...],   # kanji
      "r": [[text, [info_tags], common01], ...],   # kana
      "s": [                                        # senses
        {
          "p": [pos], "f": [field], "m": [misc], "d": [dialect], "n": [info],
          "g": [[gloss_text, type_or_null], ...],
          "x": [xref_term, ...],
          "l": [[lang, text_or_null, wasei01], ...]   # language source
        }, ...
      ]
    }

Usage:
    python3 scripts/generate-jmdict-dictionary.py            # download latest
    python3 scripts/generate-jmdict-dictionary.py --input jmdict-eng.json
"""

import argparse
import io
import json
import os
import sys
import urllib.request
import zipfile

RELEASE_API = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest"
CHUNK_SIZE = 10000
OUT_PATH_DEFAULT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "jmdict.zip"
)


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def resolve_asset_url() -> str:
    log("Querying latest jmdict-simplified release…")
    with urllib.request.urlopen(RELEASE_API, timeout=30) as resp:
        release = json.load(resp)
    for asset in release.get("assets", []):
        name = asset["name"]
        # Full English build, zip form.
        if name.startswith("jmdict-eng-") and "common" not in name and name.endswith(".json.zip"):
            log(f"Using asset: {name}")
            return asset["browser_download_url"]
    raise RuntimeError("Could not find a jmdict-eng .json.zip asset in the latest release")


def load_source(input_path: str | None) -> dict:
    if input_path:
        log(f"Reading {input_path}…")
        if input_path.endswith(".zip"):
            with zipfile.ZipFile(input_path) as zf:
                name = next(n for n in zf.namelist() if n.endswith(".json"))
                with zf.open(name) as f:
                    return json.load(f)
        with open(input_path, "rb") as f:
            return json.load(f)

    url = resolve_asset_url()
    log("Downloading… (this is ~15 MB)")
    with urllib.request.urlopen(url, timeout=120) as resp:
        raw = resp.read()
    log(f"Downloaded {len(raw) // (1024 * 1024)} MB; unzipping…")
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        name = next(n for n in zf.namelist() if n.endswith(".json"))
        with zf.open(name) as f:
            return json.load(f)


def trim_headwords(items: list) -> list:
    out = []
    for it in items:
        out.append([it["text"], it.get("tags", []), 1 if it.get("common") else 0])
    return out


def trim_sense(sense: dict) -> dict:
    glosses = [[g["text"], g.get("type")] for g in sense.get("gloss", [])]
    # xrefs: `related` entries are arrays like [term] / [term, reading] / [term, reading, senseIdx].
    xref = []
    for ref in sense.get("related", []):
        if ref and isinstance(ref, list) and isinstance(ref[0], str):
            xref.append(ref[0])
    lsrc = []
    for ls in sense.get("languageSource", []):
        lsrc.append([ls.get("lang", "eng"), ls.get("text"), 1 if ls.get("wasei") else 0])
    return {
        "p": sense.get("partOfSpeech", []),
        "f": sense.get("field", []),
        "m": sense.get("misc", []),
        "d": sense.get("dialect", []),
        "n": sense.get("info", []),
        "g": glosses,
        "x": xref,
        "l": lsrc,
    }


def trim_word(word: dict) -> dict:
    return {
        "i": int(word["id"]),
        "k": trim_headwords(word.get("kanji", [])),
        "r": trim_headwords(word.get("kana", [])),
        "s": [trim_sense(s) for s in word.get("sense", [])],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", help="Local jmdict-eng .json or .json.zip (skips download)")
    ap.add_argument("--output", default=OUT_PATH_DEFAULT)
    args = ap.parse_args()

    source = load_source(args.input)
    words = source["words"]
    revision = source.get("version") or source.get("dictDate") or ""
    log(f"Trimming {len(words):,} words (revision {revision})…")

    trimmed = [trim_word(w) for w in words]

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        index = {
            "format": "mokurod-jmdict-1",
            "title": "JMdict (simplified)",
            "revision": revision,
            "wordCount": len(trimmed),
        }
        zf.writestr("index.json", json.dumps(index, ensure_ascii=False))
        for i in range(0, len(trimmed), CHUNK_SIZE):
            chunk = trimmed[i : i + CHUNK_SIZE]
            n = i // CHUNK_SIZE + 1
            zf.writestr(
                f"term_bank_{n}.json",
                json.dumps(chunk, ensure_ascii=False, separators=(",", ":")),
            )

    size_mb = os.path.getsize(args.output) / (1024 * 1024)
    log(f"Wrote {args.output} ({size_mb:.1f} MB, {len(trimmed):,} words)")


if __name__ == "__main__":
    main()
