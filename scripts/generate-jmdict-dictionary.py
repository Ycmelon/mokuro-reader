#!/usr/bin/env python3
"""Build the bundled jmdict dictionary asset (static/jmdict.zip).

Downloads (or reads) the jmdict-simplified English release and JMdict XML, joins
them by the stable ent_seq id, trims each entry to the fields the reader uses,
and repackages the words into a chunked zip:

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
      "k": [[text, [info_tags], common01, [priority]], ...],  # kanji
      "r": [[text, [info_tags], common01, [priority], app01], ...], # kana
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
    python3 scripts/generate-jmdict-dictionary.py --input jmdict-eng.json \
        --jmdict-xml JMdict_e.gz
"""

import argparse
import gzip
import io
import json
import os
import sys
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from typing import BinaryIO, Iterator

RELEASE_API = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest"
JMDICT_XML_URL = "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz"
CHUNK_SIZE = 10000
MIN_JOIN_COVERAGE = 0.999
OUT_PATH_DEFAULT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "jmdict.zip"
)

PRIORITY_MAP = {
    "ichi1": "i1",
    "ichi2": "i2",
    "news1": "n1",
    "news2": "n2",
    "spec1": "s1",
    "spec2": "s2",
    "gai1": "g1",
    "gai2": "g2",
}


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


@contextmanager
def open_jmdict_xml(input_path: str | None) -> Iterator[BinaryIO]:
    if input_path:
        log(f"Reading {input_path}…")
        raw = open(input_path, "rb")
        compressed = input_path.lower().endswith(".gz")
    else:
        log(f"Downloading JMdict XML from {JMDICT_XML_URL}…")
        raw = urllib.request.urlopen(JMDICT_XML_URL, timeout=120)
        compressed = True

    stream: BinaryIO = gzip.GzipFile(fileobj=raw) if compressed else raw
    try:
        yield stream
    finally:
        if stream is not raw:
            stream.close()
        raw.close()


def normalize_priority(marker: str) -> str | None:
    if marker in PRIORITY_MAP:
        return PRIORITY_MAP[marker]
    if len(marker) == 4 and marker.startswith("nf") and marker[2:].isdigit():
        return marker
    return None


def load_xml_headwords(input_path: str | None) -> dict[int, dict]:
    """Stream JMdict XML into the per-ent_seq fields needed by the bundle."""
    priorities: dict[int, dict] = {}
    unknown_markers: set[str] = set()

    with open_jmdict_xml(input_path) as stream:
        context = ET.iterparse(stream, events=("start", "end"))
        _, root = next(context)
        for event, elem in context:
            if event != "end" or elem.tag != "entry":
                continue

            ent_seq = elem.findtext("ent_seq")
            if ent_seq is None:
                elem.clear()
                root.clear()
                continue

            kanji: dict[str, list[str]] = {}
            for k_ele in elem.findall("k_ele"):
                text = k_ele.findtext("keb")
                if text is None:
                    continue
                markers: list[str] = []
                for pri in k_ele.findall("ke_pri"):
                    marker = normalize_priority(pri.text or "")
                    if marker is None:
                        unknown_markers.add(pri.text or "")
                    else:
                        markers.append(marker)
                kanji[text] = markers

            readings: dict[str, tuple[list[str], int]] = {}
            for r_ele in elem.findall("r_ele"):
                text = r_ele.findtext("reb")
                if text is None:
                    continue
                markers = []
                for pri in r_ele.findall("re_pri"):
                    marker = normalize_priority(pri.text or "")
                    if marker is None:
                        unknown_markers.add(pri.text or "")
                    else:
                        markers.append(marker)
                app = 0 if r_ele.find("re_nokanji") is not None else 1
                readings[text] = (markers, app)

            priorities[int(ent_seq)] = {"k": kanji, "r": readings}
            elem.clear()
            root.clear()

    if unknown_markers:
        log("Ignoring unknown JMdict priority markers: " + ", ".join(sorted(unknown_markers)))
    log(f"Read priority metadata for {len(priorities):,} JMdict entries")
    return priorities


def trim_headwords(items: list, xml_headwords: dict, readings: bool = False) -> list:
    out = []
    for it in items:
        text = it["text"]
        common = 1 if it.get("common") else 0
        if readings:
            priority, app = xml_headwords.get(text, ([], 1))
            out.append([text, it.get("tags", []), common, priority, app])
        else:
            priority = xml_headwords.get(text, [])
            out.append([text, it.get("tags", []), common, priority])
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


def trim_word(word: dict, xml_entry: dict | None) -> dict:
    xml_entry = xml_entry or {"k": {}, "r": {}}
    return {
        "i": int(word["id"]),
        "k": trim_headwords(word.get("kanji", []), xml_entry["k"]),
        "r": trim_headwords(word.get("kana", []), xml_entry["r"], readings=True),
        "s": [trim_sense(s) for s in word.get("sense", [])],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", help="Local jmdict-eng .json or .json.zip (skips download)")
    ap.add_argument("--jmdict-xml", help="Local JMdict_e XML or .gz (skips XML download)")
    ap.add_argument("--output", default=OUT_PATH_DEFAULT)
    args = ap.parse_args()

    source = load_source(args.input)
    words = source["words"]
    revision = source.get("version") or source.get("dictDate") or ""
    xml_headwords = load_xml_headwords(args.jmdict_xml)

    word_ids = {int(word["id"]) for word in words}
    missing_ids = sorted(word_ids - xml_headwords.keys())
    coverage = (len(word_ids) - len(missing_ids)) / len(word_ids) if word_ids else 1.0
    log(f"JMdict ent_seq join coverage: {coverage:.3%} ({len(missing_ids):,} misses)")
    if missing_ids:
        log("Missing ent_seq ids: " + ", ".join(map(str, missing_ids)))
    if coverage < MIN_JOIN_COVERAGE:
        raise RuntimeError(
            f"JMdict ent_seq join coverage {coverage:.3%} is below {MIN_JOIN_COVERAGE:.1%}"
        )

    log(f"Trimming {len(words):,} words (revision {revision})…")

    trimmed = [trim_word(w, xml_headwords.get(int(w["id"]))) for w in words]

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        index = {
            "format": "mokurod-jmdict-2",
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
