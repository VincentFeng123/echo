"""STRICT MODE, set aside on 2026-10-23 when the game moved to loose, live-checked steps (../build_tapes.py).
Kept for a possible hard mode.

Build No Clicking tapes: one JSON file per puzzle, so play needs no live Wikipedia calls.

Each tape records:
  - the start page and every page it links in its article content (rule D: paragraphs, lists, tables,
    infobox, captions, hatnotes, See also, navbox headers; not navbox lists, sidebars or references),
  - the target's doorway: every page linking the target that the player can reach in two moves (and,
    when the target is small enough, every page linking the target plus the pages two moves out that
    link one of those),
  - the real rabbit hole's pages.
For each recorded page it keeps its links, the pages it only lists in a navbox (for CLOSE), the pages it
names without linking (for CLOSE), how far it is from the target, and one real sentence with the next
link blanked (for TRACKING).

Par = fewest moves on that graph with hubs banned, plus 1. A puzzle is admitted when the start doesn't
link the target and there are 20+ routes at par through 5+ different first moves.

  python3 build_puzzles.py [slug ...]      # builds the named puzzles (default: all), writes puzzles/<slug>.json
"""
import base64, gzip, hashlib, json, os, re, sys, time, unicodedata
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # wp.py, pagelinks.py
import wp
from pagelinks import read, sentences, CONTENT

HERE = os.path.dirname(os.path.abspath(__file__))
NETWORK = "/Users/vincentfeng/whiterabbit/scripts/seed-network/out/network.json"
COUNTRIES = "/Users/vincentfeng/whiterabbit/reports/no-clicking-2026-10-22/work/supply/countries.json"

PUZZLES = {
    "nutmeg": {"start": "Nutmeg", "target": "Manhattan", "hole": "5f286514-8a35-468e-847c-83923552c979"},
    "oramics": {"start": "Doctor Who theme music", "target": "Oramics", "hole": "b5149c1c-7569-4dec-99b2-4889332d7513"},
    "domesday": {"start": "BBC Domesday Project", "target": "Arctic World Archive", "hole": "bee1a585-1830-4d79-a8ca-4d1ff534da7d"},
}
SMALL_TARGET = 600        # at or under this many pages linking the target, record the whole doorway two deep
HUB_IN = 50000            # incoming links that make a page too broad to move to
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
DATE_RE = re.compile(
    r"^(?:\d{1,4}s?(?: (?:BC|BCE|AD|CE))?|AD \d{1,4}"
    r"|\d{1,2}(?:st|nd|rd|th) (?:century|millennium)(?: BC| BCE)?"
    r"|(?:" + MONTHS + r")(?: \d{1,2})?|\d{1,2} (?:" + MONTHS + r")"
    r"|\d{4} in [^()]+|[^()]+ in \d{4}s?"
    r"|(?:List|Lists|Timeline|Outline|Index|Glossary) of .+)$")
CITATION = {"ISBN", "International Standard Book Number", "Digital object identifier", "JSTOR", "PubMed", "PubMed Central",
            "Wayback Machine", "Bibcode", "ArXiv", "Semantic Scholar", "OCLC", "WorldCat", "International Standard Serial Number",
            "Library of Congress Control Number", "Hdl (identifier)", "Handle System", "S2CID (identifier)", "CiteSeerX",
            "Internet Archive", "Wikidata", "IMDb", "Google Books"}
CONTINENTS = {"Europe", "Asia", "Africa", "North America", "South America", "Oceania", "Antarctica", "Australia (continent)", "Americas", "Eurasia"}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def norm(s):
    """Same as the game's norm(): case, accents, apostrophes and punctuation don't matter; a leading 'the/a/an' is dropped."""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[’'`´ʻ]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"^(the|a|an) ", "", s)


def b36(n):
    d = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        return "0"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = d[r] + out
    return out


def pack(ids):
    """sorted ids -> delta-coded base-36, comma separated"""
    ids = sorted(set(ids))
    prev, out = 0, []
    for i in ids:
        out.append(b36(i - prev))
        prev = i
    return ",".join(out)


def fnv(s, h):
    for c in s.encode():
        h = ((h ^ c) * 16777619) & 0xffffffff
    return h


def make_bloom(entries, bits=14.4, k=10):
    """A Bloom filter (about 1 false hit in 1,000) the game reads with the same FNV-1a double hashing."""
    m = max(64, (int(len(entries) * bits) // 8 + 1) * 8)
    arr = bytearray(m // 8)
    for e in entries:
        h1, h2 = fnv(e, 2166136261), fnv(e, 0x9747B28C) | 1
        for i in range(k):
            p = ((h1 + i * h2) & 0xffffffff) % m
            arr[p >> 3] |= 1 << (p & 7)
    return {"m": m, "k": k, "b": base64.b64encode(bytes(arr)).decode()}


class Graph:
    """Pages read so far: their rule-D links (canonical titles), navbox-only links, paragraphs."""

    def __init__(self):
        self.pages = {}      # canonical title -> {"d": set, "nav": set, "paras": [...], "written": {...}}
        self.alias = {}      # redirect title as written in a link -> canonical title
        self.pending = set()

    def load(self, title):
        if title in self.pages:
            return self.pages[title]
        # parsing is the slow part, so each page's reading is kept next to its HTML in the cache
        pc = os.path.join(wp.CACHE, "parsed", hashlib.sha1(title.encode()).hexdigest() + ".json.gz")
        if os.path.exists(pc):
            with gzip.open(pc, "rt") as f:
                x = json.load(f)
        else:
            h = wp.html(title)
            if not h:
                return None
            p = read(h)
            x = {"links": p.links, "paras": p.paras}
            os.makedirs(os.path.dirname(pc), exist_ok=True)
            with gzip.open(pc, "wt") as f:
                json.dump(x, f)
        d, nav = set(), set()
        for t, cat, red in x["links"]:
            if red:
                self.pending.add(t)
            if cat in CONTENT:
                d.add(t)
            elif cat in ("navbox", "sidebar"):
                nav.add(t)
        paras = [{"text": q["text"], "links": [tuple(l) for l in q["links"]]} for q in x["paras"]]
        rec = {"d": d, "nav": nav - d, "paras": paras}
        self.pages[title] = rec
        return rec

    def resolve(self):
        """Turn every redirect a page links through into the page it points at."""
        todo = sorted(t for t in self.pending if t not in self.alias)  # sorted, so batches (and their cache) repeat
        if todo:
            m = wp.canon(todo)
            for t in todo:
                self.alias[t] = m.get(t) or t
        self.pending = set()
        for rec in self.pages.values():
            if not rec.get("canon"):
                rec["d"] = {self.alias.get(t, t) for t in rec["d"]}
                rec["nav"] = {self.alias.get(t, t) for t in rec["nav"]} - rec["d"]
                for para in rec["paras"]:
                    para["links"] = [(s, e, self.alias.get(t, t)) for s, e, t in para["links"]]
                rec["canon"] = True


def hole_route(hole_id):
    net = json.load(open(NETWORK))
    h = next(x for x in net["holes"] if x["id"] == hole_id)
    srcs = sorted(h["sources"], key=lambda s: s["position"])
    by = {s["id"]: s for s in srcs}
    wiki = [s for s in srcs if s["kind"] == "wiki"]

    def depth(s):
        n = 0
        while s.get("parentId"):
            s = by[s["parentId"]]
            n += 1
        return n
    # the hole's longest chain of Wikipedia pages, following parentId
    leaf = max(wiki, key=lambda s: (depth(s), -s["position"]))
    chain = []
    s = leaf
    while s:
        if s["kind"] == "wiki":
            chain.append(s)
        s = by.get(s.get("parentId"))
    chain.reverse()
    out = []
    for s in chain:
        if not out or out[-1]["title"] != s["title"]:
            out.append({"title": s["title"], "note": s.get("note") or ""})
    author = next((u for u in net["users"] if u.get("username") == h["author"] or u.get("handle") == h["author"]), {})
    return h, out, author


def snippet(text, s0, e0, s, e, before=55, after=65):
    """The part of a sentence around one link, cut at word boundaries, so the link itself always shows."""
    a, z = max(s0, s - before), min(e0, e + after)
    if a > s0:
        sp = text.find(" ", a, s)
        a = sp + 1 if sp >= 0 else a
    if z < e0:
        sp = text.rfind(" ", e, z)
        z = sp if sp > 0 else z
    out = text[a:z].strip()
    out = re.sub(r"\[\d+\]", "", out)
    return ("…" if a > s0 else "") + out + ("…" if z < e0 else "")


def slugify(title):
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    if len(s) > 56:
        s = s[:56].rsplit("-", 1)[0]
    return s


def build(slug):
    cfg = PUZZLES[slug]
    t0 = time.time()
    live0 = wp.LIVE[0]
    G = Graph()
    hole, chain, author = hole_route(cfg["hole"])
    names = [cfg["start"], cfg["target"]] + [c["title"] for c in chain]
    cm = wp.canon(names)
    S, T = cm[cfg["start"]], cm[cfg["target"]]
    for c in chain:
        c["canon"] = cm.get(c["title"]) or c["title"]
    route = [c["canon"] for c in chain]
    if route[-1] != T:
        route.append(T)
        chain.append({"title": T, "canon": T, "note": "", "headline": True})
    log(slug, "start", S, "target", T, "route", route)
    t_alias = set(wp.redirects_of(T))

    countries = set(json.load(open(COUNTRIES))) | CONTINENTS
    INFO = {}

    def get_info(titles):
        need = [t for t in titles if t not in INFO]
        if need:
            INFO.update(wp.info(need))

    keep = {S, T} | set(route)

    def is_hub(t):
        if t in keep:
            return False
        if DATE_RE.match(t) or t in countries or t in CITATION or t.endswith("(identifier)"):
            return True
        i = INFO.get(t)
        return bool(i and i["in"] is not None and i["in"] >= HUB_IN)

    def is_dab(t):
        i = INFO.get(t)
        return bool(i and i["dab"])

    # 1) the start and everything it links
    G.load(S)
    G.resolve()
    if T in G.pages[S]["d"]:
        raise SystemExit(f"{slug}: the start links the target directly")
    n1 = sorted(G.pages[S]["d"] - {S})
    get_info(n1)
    n1 = [t for t in n1 if not is_hub(t) and not is_dab(t)]
    log(slug, "N1", len(n1), "pages to read")
    for i, t in enumerate(n1):
        G.load(t)
        if i % 50 == 49:
            log(slug, f"  read {i + 1}/{len(n1)} (live {wp.LIVE[0] - live0})")
    G.resolve()
    n2 = set()
    for t in [S] + n1:
        if t in G.pages:
            n2 |= G.pages[t]["d"]
    log(slug, "N2 named", len(n2))

    # 2) the target's doorway
    b1, complete = wp.backlinks(T, cap=150)
    log(slug, "pages linking the target", len(b1), "complete" if complete else "PARTIAL")
    small = complete and len(b1) <= SMALL_TARGET
    if small:
        door = set(b1)
    else:
        door = (n2 & b1)
    door -= set(G.pages)
    get_info(door)
    door = sorted(t for t in door if not is_hub(t) and not is_dab(t))
    log(slug, "doorway pages to read", len(door))
    for i, t in enumerate(door):
        G.load(t)
        if i % 50 == 49:
            log(slug, f"  read {i + 1}/{len(door)} (live {wp.LIVE[0] - live0})")
    G.resolve()
    if small:
        # two deep: pages two moves from the start that link a page linking the target
        # pages linking a doorway page; doorway pages with 5,000+ incoming links (GitHub, say) bring mostly strangers, so skip them
        get_info(b1)
        b2 = set()
        for b in sorted(b1):
            if is_hub(b) or (INFO.get(b, {}).get("in") or 0) > 5000:
                continue
            bl, _ = wp.backlinks(b, cap=12)
            b2 |= bl
        two = (n2 & b2) - set(G.pages)
        get_info(two)
        two = sorted(t for t in two if not is_hub(t) and not is_dab(t))
        log(slug, "two-deep pages to read", len(two))
        for i, t in enumerate(two):
            G.load(t)
            if i % 50 == 49:
                log(slug, f"  read {i + 1}/{len(two)} (live {wp.LIVE[0] - live0})")
        G.resolve()

    # 3) the real hole's own pages
    for t in route:
        if t != T:
            G.load(t)
    G.resolve()
    standing = {t for t in G.pages if t != T}

    # 4) hubs among everything a standing page links (pages linked from 2+ standing pages, plus every standing page)
    count = defaultdict(int)
    for t in standing:
        for y in G.pages[t]["d"]:
            count[y] += 1
    # a giant hub is linked from a good share of any neighbourhood; checking every name would take thousands of lookups
    popular = [t for t, c in count.items() if c >= max(3, len(standing) // 60)] + list(standing)
    log(slug, "checking", len(popular), "names for hubs")
    get_info(popular)
    for t in [x for x in popular if INFO.get(x, {}).get("in") is None and not DATE_RE.match(x)][:40]:
        if count.get(t, 0) >= 8:
            c = wp.linksto_count(t)
            if c is not None:
                INFO[t] = dict(INFO.get(t, {"desc": "", "dab": False}), **{"in": c})
    hubs = {t for t in set(count) | standing if is_hub(t)}

    # 5) distances to the target, hubs banned in between
    links = {t: {y for y in G.pages[t]["d"] if y != t and (y == T or (y not in hubs))} for t in standing}
    rev = defaultdict(set)
    for t, ys in links.items():
        for y in ys:
            rev[y].add(t)
    dist = {T: 0}
    frontier = [T]
    while frontier:
        nxt = []
        for y in frontier:
            for x in rev[y]:
                if x not in dist:
                    dist[x] = dist[y] + 1
                    nxt.append(x)
        frontier = nxt
    shortest = dist.get(S)
    if shortest is None:
        raise SystemExit(f"{slug}: no route on the recorded tape")
    par = shortest + 1

    def routes_at(limit):
        found, firsts = 0, set()
        example = None

        def dfs(x, path):
            nonlocal found, example
            if found > 5000:
                return
            for y in sorted(links.get(x, ())):
                if y in path:
                    continue
                left = limit - len(path)
                if y == T:
                    if left >= 0:
                        found += 1
                        firsts.add(path[1] if len(path) > 1 else y)
                        if example is None or len(path) < len(example) - 1:
                            example = path + [y]
                    continue
                if dist.get(y, 99) <= left:
                    dfs(y, path + [y])
        dfs(S, [S])
        return found, len(firsts), example
    n_short, f_short, ex_short = routes_at(shortest)
    n_par, f_par, _ = routes_at(par)
    log(slug, f"shortest {shortest} ({n_short} routes, {f_short} first moves); par {par}: {n_par} routes within par through {f_par} first moves")

    # 6) the title table holds only pages a player can stand on: start, target, the real hole, recorded pages.
    #    Everything else a recorded page links, lists in a navbox or names goes into a Bloom filter of
    #    "page|kind|name" keys, so the game can still tell OFF THE TAPE, CLOSE and TOO BROAD from STATIC
    #    without carrying 40,000-50,000 names per tape.
    order = [S, T] + [r for r in route if r not in (S, T)]
    for t in sorted(standing):
        if t not in order:
            order.append(t)
    idx = {t: i for i, t in enumerate(order)}

    # aliases: redirects pages link through, and the target's own redirects
    alias = {}
    for a, c in list(G.alias.items()) + [(a, T) for a in t_alias]:
        if c in idx and a != c and norm(a) != norm(c):
            alias[a] = idx[c]

    # 7) names a page mentions without linking (title must be 2+ words or capitalised in the text)
    keymap = defaultdict(set)
    for t in set(count) | set(order):
        k = norm(t)
        if len(k) >= 5 and not DATE_RE.match(t):
            keymap[k].add(t)
    def mentions(rec, own):
        found = set()
        for para in rec["paras"]:
            text = para["text"]
            words = [(m.group(0), m.start()) for m in re.finditer(r"[A-Za-zÀ-ÿ0-9’'&.-]+", text)]
            nw = [norm(w) for w, _ in words]
            for i in range(len(words)):
                if not nw[i]:
                    continue
                k = ""
                for n in range(0, 6):
                    if i + n >= len(words):
                        break
                    k = (k + " " + nw[i + n]).strip() if nw[i + n] else k
                    if k in keymap:
                        if n == 0 and not words[i][0][:1].isupper():
                            continue
                        for t in keymap[k]:
                            if t not in own:
                                found.add(t)
        return found

    # 8) TRACKING: a real sentence from the page with the next link on a best route blanked
    def tracking(t):
        d = dist.get(t)
        if d is None:
            return None
        goods = [y for y in links[t] if dist.get(y, 99) == d - 1]
        best = None
        for para in G.pages[t]["paras"]:
            spans = sentences(para)
            for s0, e0 in spans:
                sent = para["text"][s0:e0]
                for s, e, y in para["links"]:
                    if y in goods and s0 <= s and e <= e0:
                        ln = e0 - s0
                        # the blank should hide the page's own name, not a word that happens to carry the link
                        a = norm(para["text"][s:e])
                        named = a in (norm(y), norm(re.sub(r"\s*\([^)]*\)\s*$", "", y)))
                        score = abs(ln - 150) + (0 if named else 120) + (0 if y != T else -40) + (40 if ln > 320 else 0)
                        if best is None or score < best[0]:
                            text = (sent[:s - s0] + "____" + sent[e - s0:]).strip()
                            text = re.sub(r"\[\d+\]", "", text)
                            best = (score, text, y, para["text"][s:e])
        if best:
            return {"s": best[1], "a": idx[best[2]], "w": best[3]}
        y = sorted(goods, key=lambda y: (y != T, y))[0] if goods else None
        if y is None:
            return None
        return {"s": "", "a": idx[y], "w": ""}

    def keys(t):
        k, b = norm(t), norm(re.sub(r"\s*\([^)]*\)\s*$", "", t))
        return {x for x in (k, b) if x}

    pages, entries = {}, set()
    samples = {"static": "Xyzzy plugh gadget", "broad": "France"}
    for t in sorted(standing, key=lambda x: idx[x]):
        rec = G.pages[t]
        i = idx[t]
        own = rec["d"] | {t}
        for y in rec["d"]:
            if y not in idx and y != t:
                for k in keys(y):
                    entries.add(f"{i}|l|{k}")
        for y in rec["nav"]:
            for k in keys(y):
                entries.add(f"{i}|n|{k}")
        ment = {y for y in mentions(rec, own) if y != t}
        for y in ment:
            entries.add(f"{i}|m|{norm(y)}")
        row = {"l": pack(idx[y] for y in rec["d"] if y in idx and y != t)}
        if t in dist:
            row["d"] = dist[t]
            tr = tracking(t)
            if tr:
                row["t"] = tr
        pages[str(i)] = row
        if t == S:
            plain = lambda y: y not in idx and y not in hubs and not re.search(r"[(),]", y) and len(keymap.get(norm(y), ())) <= 1
            samples["nav"] = next((y for y in sorted(rec["nav"]) if plain(y) and y not in rec["d"]), None)
            samples["mention"] = next((y for y in sorted(ment) if plain(y) and y not in rec["nav"]), None)
    for h in hubs:
        entries.add("h|" + norm(h))
    bloom = make_bloom(entries)
    # sample guesses for the end-to-end test (not shipped in the page)
    s_links = G.pages[S]["d"]
    samples["back"] = next((t for t in sorted(standing) if t not in s_links and t != S and S in G.pages[t]["d"]), None)
    for a in sorted(s_links):
        if a in standing and a not in hubs:
            y = next((y for y in sorted(G.pages[a]["d"]) if y not in idx and y not in hubs and y != S and not re.search(r"[(),]", y) and not DATE_RE.match(y)), None)
            if y:
                samples["off"] = [a, y]
                break
    samples["route"] = ex_short[1:] if ex_short else []

    # 9) the rabbit's route: each hop is a link, a link the other way, a navbox mention, or a jump
    hops = []
    if T in route[1:]:
        G.load(T)  # only to tell "a link the other way" from a plain jump on the hop into the target
        G.resolve()
    for a, b in zip(route, route[1:]):
        ra, rb = G.pages.get(a), G.pages.get(b)
        kind = "jump"
        if ra and b in ra["d"]:
            kind = "link"
        elif ra and b in ra["nav"]:
            kind = "navbox"
        elif rb and a in rb["d"]:
            kind = "back"
        sent = ""
        if ra and kind == "link":
            for para in ra["paras"]:
                for s0, e0 in sentences(para):
                    hit = next(((s, e) for s, e, y in para["links"] if y == b and s0 <= s and e <= e0), None)
                    if hit:
                        sent = snippet(para["text"], s0, e0, *hit)
                        break
                if sent:
                    break
        hops.append({"kind": kind, "s": sent})
    real = [{"i": idx[c["canon"]], "note": c.get("note", ""), "headline": bool(c.get("headline"))} for c in chain]

    out = {
        "slug": slug,
        "built": time.strftime("%Y-%m-%d"),
        "start": 0, "target": 1,
        "shortest": shortest, "par": par,
        "routes": {"shortest": n_short, "shortestFirst": f_short, "par": n_par, "parFirst": f_par,
                   "example": [idx[x] for x in (ex_short or [])]},
        "deep": bool(small),
        "hole": {"id": hole["id"], "title": hole["title"], "author": hole["author"],
                 "url": "https://whiterabbt.com/r/" + hole["id"] + "/" + slugify(hole["title"]),
                 "route": real, "hops": hops, "takeaway": hole.get("takeaway") or ""},
        "titles": "\n".join(order),
        "alias": "\n".join(f"{a}\t{b36(i)}" for a, i in sorted(alias.items())),
        "pages": pages,
        "bloom": bloom,
    }
    os.makedirs(os.path.join(HERE, "puzzles"), exist_ok=True)
    path = os.path.join(HERE, "puzzles", slug + ".json")
    with open(path + ".tmp", "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(path + ".tmp", path)  # the local server reads tapes on every load, so never leave half a file
    with open(os.path.join(HERE, "puzzles", slug + ".check.json"), "w") as f:
        json.dump(samples, f, ensure_ascii=False, indent=1)
    log(slug, f"wrote {path}: {os.path.getsize(path):,} bytes, {len(order):,} titles, {len(pages)} recorded pages, "
        f"{len(entries):,} filter keys, {len(hubs)} hubs, {wp.LIVE[0] - live0} live requests, {time.time() - t0:.0f}s")
    stats = {"slug": slug, "shortest": shortest, "par": par, "routes": out["routes"], "standing": len(pages),
             "titles": len(order), "hubs": len(hubs), "deep": bool(small), "doorway": len(b1),
             "hops": [h["kind"] for h in hops], "route": route}
    print(json.dumps(stats), flush=True)
    return stats


if __name__ == "__main__":
    for s in (sys.argv[1:] or list(PUZZLES)):
        build(s)
