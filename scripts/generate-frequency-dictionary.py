#!/usr/bin/env python3
"""Generate static/frequency.zip, the bundled Yomitan frequency dictionary.

Jitendex flattens every JMdict priority class (ichi1, news1, nf13, spec1, …)
into a single "★ priority form" tag, which loses the information needed to rank,
say, 分かる above 分かつ (both merely "★" in Jitendex). 10ten keeps the granular
markers and folds them into a numeric priority score; we replicate that here.

Faithful to Yomitan/10ten, priority is scored **per reading element** and keyed
per (writing, reading) headword — not per bare string. This matters for shared
readings: よく is the common reading of 欲 (greed) and 良く (well), but a *rare*
reading of 翼 (whose common reading is つばさ). A per-string max would let 翼
borrow 54.7 from its つばさ reading and outrank 良く when the kana よく is clicked
(both Yomitan and 10ten rank 良く above 翼 there). Emitting the reading's own
priority against each of its writings — and *nothing* for 翼/よく, which carries
no markers — reproduces their ordering: the reader looks up freq by the matched
(writing, reading) pair, so 翼-via-よく scores 0.

Each row is Yomitan's reading-scoped freq shape:

    [writing, "freq", {"reading": reading, "frequency": score}]

Writing elements with their own priority markers are also emitted as bare
frequency rows:

    [writing, "freq", score]

The reader only applies those rows when the writing itself was matched. For
kana-only words (no kanji, or a `nokanji` reading) the writing is the reading
itself. Reading→kanji restrictions (10ten's `app` bitmask) are respected so a
reading is only paired with the kanji it actually applies to.

Usage: clone https://github.com/birchill/10ten-ja-reader next to this repo (or
point SRC at its data/words.ljson) and run
`python3 scripts/generate-frequency-dictionary.py`.
"""

import json, zipfile, os, datetime

SRC = os.path.expanduser('~/10ten-ja-reader/data/words.ljson')
OUT = os.path.join(os.path.dirname(__file__), '..', 'static', 'frequency.zip')
CHUNK = 20000

# Mirrors 10ten's PRIORITY_ASSIGNMENTS.
PRIORITY_ASSIGNMENTS = {
    'i1': 50, 'i2': 20, 'n1': 40, 'n2': 20,
    's1': 32, 's2': 20, 'g1': 30, 'g2': 15
}


def priority_score(p):
    if p in PRIORITY_ASSIGNMENTS:
        return PRIORITY_ASSIGNMENTS[p]
    if p.startswith('nf'):
        try:
            wordfreq = int(p[2:])
        except ValueError:
            return 0
        if 0 < wordfreq < 48:
            return 48 - wordfreq / 2
    return 0


def priority_sum(markers):
    scores = sorted((priority_score(p) for p in markers), reverse=True)
    if not scores:
        return 0.0
    total = scores[0]
    for i, s in enumerate(scores[1:], start=1):
        total += s / (10 ** i)
    return total


# Aggregate maximum priority per matched headword element. `best_pairs` carries
# reading-element priority for (writing, reading) matches; `best_writings`
# carries kanji/writing-element priority for direct writing matches.
best_pairs = {}
best_writings = {}


def consider_pair(expression, reading, value):
    if not expression or value <= 0:
        return
    key = (expression, reading)
    if value > best_pairs.get(key, 0):
        best_pairs[key] = value


def consider_writing(expression, value):
    if not expression or value <= 0:
        return
    if value > best_writings.get(expression, 0):
        best_writings[expression] = value


def applicable_kanji(kanji, app):
    """Kanji a reading applies to, honouring 10ten's `app` restriction bitmask.

    Absent → every kanji; 0 → nokanji (kana-only usage); otherwise a bitmask of
    kanji indices (bit j set ⇒ the j-th kanji)."""
    if app is None:
        return list(kanji)
    if app == 0:
        return []
    return [k for j, k in enumerate(kanji) if app & (1 << j)]


with open(SRC, encoding='utf-8') as f:
    for line in f:
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        kanji = e.get('k') or []
        kmeta = e.get('km') or []
        for i, writing in enumerate(kanji):
            m = kmeta[i] if i < len(kmeta) and isinstance(kmeta[i], dict) else {}
            consider_writing(writing, priority_sum(m.get('p') or []))

        readings = e.get('r') or []
        rmeta = e.get('rm') or []
        for i, reading in enumerate(readings):
            m = rmeta[i] if i < len(rmeta) and isinstance(rmeta[i], dict) else {}
            value = priority_sum(m.get('p') or [])
            if value <= 0:
                continue
            targets = applicable_kanji(kanji, m.get('app')) if kanji else []
            if targets:
                for k in targets:
                    consider_pair(k, reading, value)
            else:
                # Kana-only word, or a nokanji reading: key by the reading.
                consider_pair(reading, reading, value)

# Round to 2 dp to keep the file compact; ordering is preserved.
rows = [
    [expression, 'freq', {'reading': reading, 'frequency': round(value, 2)}]
    for (expression, reading), value in best_pairs.items()
]
rows.extend(
    [expression, 'freq', round(value, 2)]
    for expression, value in best_writings.items()
)

date = datetime.date.today().isoformat()
index = {
    'title': f'JMdict Frequencies [{date}]',
    'format': 3,
    'revision': f'freq-{date}',
    'sequenced': False,
    'author': 'Generated from JMdict/10ten priority data',
    'description': "Per-reading priority scores derived from JMdict's ichi/news/spec/wordfreq "
    'markers (via the 10ten dataset), keyed per (writing, reading) headword so a rare reading '
    "cannot inherit a common homograph's frequency. Used to rank common words first.",
    'sourceLanguage': 'ja',
    'targetLanguage': 'en',
}

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr('index.json', json.dumps(index, ensure_ascii=False, indent=2))
    for idx in range(0, len(rows), CHUNK):
        z.writestr(
            f'term_meta_bank_{idx // CHUNK + 1}.json',
            json.dumps(rows[idx:idx + CHUNK], ensure_ascii=False),
        )

print(f'frequency rows emitted: {len(rows)}')
print(f'zip size: {os.path.getsize(OUT) / 1e6:.2f} MB')
