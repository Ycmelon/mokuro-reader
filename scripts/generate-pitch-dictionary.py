#!/usr/bin/env python3
"""Generate static/pitch-accents.zip, the bundled Yomitan pitch-accent dictionary.

Source data is the 10ten Japanese Reader word database (words.ljson), which
carries a per-reading accent field `a` (either an int downstep position, or a
list of {"i": position} for words with multiple accepted accents) derived from
JMdict. We fold that into a Yomitan v3 term_meta_bank "pitch" dictionary keyed by
both the kanji writing(s) and the kana reading, so the reader can look pitch up
whichever form the entry displays.

Usage: clone https://github.com/birchill/10ten-ja-reader next to this repo (or
point SRC at its data/words.ljson) and run `python3 scripts/generate-pitch-dictionary.py`.
"""

import json, zipfile, os, datetime

SRC = os.path.expanduser('~/10ten-ja-reader/data/words.ljson')
OUT = os.path.join(os.path.dirname(__file__), '..', 'static', 'pitch-accents.zip')
CHUNK = 20000

def positions_from_a(a):
    # a: int (single accent) or list of {"i": int}
    if isinstance(a, int):
        return [a]
    if isinstance(a, list):
        out = []
        for e in a:
            if isinstance(e, dict) and isinstance(e.get('i'), int):
                out.append(e['i'])
        return out
    return []

rows = []            # list of [expression, "pitch", {reading, pitches}]
seen = set()         # (expression, reading, tuple(positions)) dedupe
n_read = 0

with open(SRC, encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        readings = e.get('r') or []
        rmeta = e.get('rm') or []
        kanji = e.get('k') or []
        for i, reading in enumerate(readings):
            rm = rmeta[i] if i < len(rmeta) else None
            if not isinstance(rm, dict):
                continue
            a = rm.get('a')
            if a is None:
                continue
            positions = positions_from_a(a)
            if not positions:
                continue
            n_read += 1
            pitches = [{"position": p} for p in positions]
            data = {"reading": reading, "pitches": pitches}
            pos_key = tuple(positions)
            # Emit for the kana headword and for each kanji writing.
            exprs = [reading] + [k for k in kanji if k]
            for expr in exprs:
                key = (expr, reading, pos_key)
                if key in seen:
                    continue
                seen.add(key)
                rows.append([expr, "pitch", data])

date = datetime.date.today().isoformat()
index = {
    "title": f"JMdict Pitch Accents [{date}]",
    "format": 3,
    "revision": f"pitch-{date}",
    "sequenced": False,
    "author": "Generated from JMdict/10ten accent data",
    "description": "Pitch-accent data derived from JMdict readings (via the 10ten dataset).",
    "sourceLanguage": "ja",
    "targetLanguage": "en",
}

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr('index.json', json.dumps(index, ensure_ascii=False, indent=2))
    for idx in range(0, len(rows), CHUNK):
        bank = rows[idx:idx+CHUNK]
        z.writestr(f'term_meta_bank_{idx//CHUNK + 1}.json',
                   json.dumps(bank, ensure_ascii=False))

print(f"readings with accent: {n_read}")
print(f"pitch rows emitted:   {len(rows)}")
print(f"zip size: {os.path.getsize(OUT)/1e6:.2f} MB")
