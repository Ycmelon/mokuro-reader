#!/usr/bin/env python3
"""Generate static/frequency.zip, the bundled Yomitan frequency dictionary.

Jitendex flattens every JMdict priority class (ichi1, news1, nf13, spec1, …)
into a single "★ priority form" tag, which loses the information needed to rank,
say, 分かる above 分かつ (both merely "★" in Jitendex). 10ten keeps the granular
markers and folds them into a numeric priority score; we replicate that here.

For every kanji/kana headword we compute 10ten's priority sum (see
word-match-sorting.ts: getPriorityScore / getPrioritySum) from words.ljson's `p`
markers and emit it as a Yomitan v3 term_meta "freq" row keyed by the headword.
The reader uses the per-entry maximum of these as a sort key, so common words win
ties that Jitendex's flat score cannot.

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


# Aggregate the maximum priority sum seen for each headword string.
best = {}


def consider(text, markers):
    if not text or not markers:
        return
    v = priority_sum(markers)
    if v <= 0:
        return
    if v > best.get(text, 0):
        best[text] = v


with open(SRC, encoding='utf-8') as f:
    for line in f:
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        for arr, metas in (('k', 'km'), ('r', 'rm')):
            heads = e.get(arr) or []
            metalist = e.get(metas) or []
            for i, head in enumerate(heads):
                m = metalist[i] if i < len(metalist) and isinstance(metalist[i], dict) else {}
                consider(head, m.get('p'))

# Round to 2 dp to keep the file compact; ordering is preserved.
rows = [[text, 'freq', round(value, 2)] for text, value in best.items()]

date = datetime.date.today().isoformat()
index = {
    'title': f'JMdict Frequencies [{date}]',
    'format': 3,
    'revision': f'freq-{date}',
    'sequenced': False,
    'author': 'Generated from JMdict/10ten priority data',
    'description': "Priority scores derived from JMdict's ichi/news/spec/wordfreq markers "
    '(via the 10ten dataset), used to rank common words first.',
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
