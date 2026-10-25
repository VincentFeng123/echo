"""Summarise a built tape: size, par, routes, how much of the start's neighbourhood is on the tape.

  python3 inspect_tape.py puzzles/oramics.json [...]
"""
import json, sys
from collections import Counter


def ids(s):
    out, v = [], 0
    for x in (s.split(",") if s else []):
        v += int(x, 36)
        out.append(v)
    return out


for path in sys.argv[1:]:
    p = json.load(open(path))
    T = p["titles"].split("\n")
    pages = p["pages"]
    hubs = set(ids(p.get("hubs", "")))
    L = {int(k): set(ids(v["l"])) for k, v in pages.items()}
    S, G = p["start"], p["target"]
    n1 = [i for i in L[S] if i not in hubs]
    on = [i for i in n1 if str(i) in pages]
    d = Counter(v.get("d") for v in pages.values())
    track = sum(1 for v in pages.values() if v.get("t"))
    print(f"{p['slug']}: {T[S]} -> {T[G]}  shortest {p['shortest']} par {p['par']}  deep={p['deep']}")
    raw = json.dumps(p, ensure_ascii=False, separators=(',', ':')).encode()
    import gzip
    print(f"  file {len(raw):,} bytes ({len(gzip.compress(raw, 9)):,} gzipped), {len(T):,} titles, {len(pages)} recorded pages, filter {p['bloom']['m'] // 8:,} bytes")
    print(f"  routes: {p['routes']}  example: {' > '.join(T[i] for i in p['routes']['example'])}")
    print(f"  start links {len(L[S])} pages ({len(n1)} not hubs, {len(on)} recorded); distance to target among recorded: {dict(sorted((k if k is not None else 99, v) for k, v in d.items()))}")
    print(f"  TRACKING on {track} pages")
    print(f"  pages linking the target: {', '.join(T[int(k)] for k, v in pages.items() if v.get('d') == 1)[:600]}")
    print(f"  rabbit's route: {[(T[r['i']], h['kind']) for r, h in zip(p['hole']['route'][1:], p['hole']['hops'])]}")
    print(f"  start TRACKING: {pages[str(S)].get('t')}")
