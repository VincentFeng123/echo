"""Build No Clicking tapes (loose mode): one small JSON file per puzzle.

In play, a step counts when either Wikipedia page links the other, or one names the other in its text; the game
checks that live against Wikipedia (see "the referee" in game.html), so a tape only needs:
  - the start and the target, checked here not to be one step apart already,
  - par: the moves the real rabbit hole took (at least 3), so the game is "beat the rabbit",
  - the rabbit's route, each hop labelled the way the referee would see it, with the sentence that ties it,
  - the target's neighbours (pages one step from it), best known first, for TRACKING.

  python3 build_tapes.py [slug ...]     writes puzzles/<slug>.json and puzzles/<slug>.check.json (test guesses)
  python3 build_tapes.py --broad        writes broad.json, the pages too general to be a step
"""
import gzip, hashlib, json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wp
from pagelinks import read, sentences

HERE = os.path.dirname(os.path.abspath(__file__))
NETWORK = "/Users/vincentfeng/whiterabbit/scripts/seed-network/out/network.json"

TAPES = {
    "pretzel": {"start": "Pretzel", "target": "Caramelization", "hole": "d8464137-bd05-4c8d-b9c8-28670ce5b948"},
    "oramics": {"start": "Doctor Who theme music", "target": "Oramics", "hole": "b5149c1c-7569-4dec-99b2-4889332d7513"},
    "domesday": {"start": "BBC Domesday Project", "target": "Arctic World Archive", "hole": "bee1a585-1830-4d79-a8ca-4d1ff534da7d",
                 "sample": ["Digital obsolescence", "Digital preservation", "Arctic World Archive"]},
}
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
BROAD = re.compile(r"^(?:\d{1,4}s?(?: (?:BC|BCE|AD|CE))?|\d{1,2}(?:st|nd|rd|th) (?:century|millennium)(?: BC)?|(?:" + MONTHS +
                   r")(?: \d{1,2})?|\d{1,2} (?:" + MONTHS + r")|\d{4} in .+|.+ in \d{4}s?|(?:List|Lists|Timeline|Outline|Index|Glossary) of .+)$")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def base(t):
    return re.sub(r"\s*\([^)]*\)\s*$", "", t)


def parsed(title):
    """Links and paragraphs of a page, from the shared parse cache when it's there."""
    pc = os.path.join(wp.CACHE, "parsed", hashlib.sha1(title.encode()).hexdigest() + ".json.gz")
    if os.path.exists(pc):
        with gzip.open(pc, "rt") as f:
            return json.load(f)
    p = read(wp.html(title))
    x = {"links": p.links, "paras": p.paras}
    os.makedirs(os.path.dirname(pc), exist_ok=True)
    with gzip.open(pc, "wt") as f:
        json.dump(x, f)
    return x


def text(title):
    j = wp.api(action="query", prop="extracts", titles=title, explaintext="1", redirects="1")
    return j["query"]["pages"][0].get("extract", "")


ALIASES = {}


def aliases(title):
    if title not in ALIASES:
        ALIASES[title] = wp.redirects_of(title)
    return ALIASES[title]


def names(txt, title):
    """Does this text name the page (its title, title without "(...)", or one of its redirects)? Same test as the game."""
    for n in [title, base(title)] + aliases(title)[:48]:
        # a one-word name counts only written as a name ("Germany"), not as an ordinary word ("music")
        if len(n) >= 4 and re.search(r"(?<![\w])" + re.escape(n) + r"(?![\w])", txt, 0 if " " not in n else re.I):
            return n
    return None


def connect(a, b):
    """How the referee sees a step from a to b: link, back, names, named or None (the game's check, run offline)."""
    pl = [a, b] + aliases(a)[:24] + aliases(b)[:24]
    got = {}
    for j in wp.api_all(action="query", prop="links", titles=a + "|" + b, pltitles="|".join(pl[:50]), pllimit="max"):
        for p in j.get("query", {}).get("pages", []):
            got.setdefault(p["title"], set()).update(l["title"] for l in p.get("links", []))
    if got.get(a, set()) & ({b} | set(aliases(b))):
        return "link"
    if got.get(b, set()) & ({a} | set(aliases(a))):
        return "back"
    if names(text(a), b):
        return "names"
    if names(text(b), a):
        return "named"
    return None


def tie(a, b, kind):
    """The sentence that ties a hop: where one page links or names the other, cut around that spot."""
    src, other = (a, b) if kind in ("link", "names") else (b, a)
    if kind in ("link", "back"):
        for para in parsed(src)["paras"]:
            for s0, e0 in sentences(para):
                hit = next(((s, e) for s, e, y in para["links"] if (y == other or y in aliases(other)) and s0 <= s and e <= e0), None)
                if hit:
                    return snippet(para["text"], s0, e0, *hit)
    for para in parsed(src)["paras"]:
        n = names(para["text"], other)
        if n:
            m = re.search(re.escape(n), para["text"], re.I)
            for s0, e0 in sentences(para):
                if s0 <= m.start() < e0:
                    return snippet(para["text"], s0, e0, m.start(), m.end())
    return ""


def snippet(text_, s0, e0, s, e, before=55, after=65):
    a, z = max(s0, s - before), min(e0, e + after)
    if a > s0:
        sp = text_.find(" ", a, s)
        a = sp + 1 if sp >= 0 else a
    if z < e0:
        sp = text_.rfind(" ", e, z)
        z = sp if sp > 0 else z
    out = re.sub(r"\[\d+\]", "", text_[a:z].strip())
    return ("…" if a > s0 else "") + out + ("…" if z < e0 else "")


def about(titles):
    """What each page is, for the definitions under page names: its short description and first sentence."""
    out = {}
    for t in titles:
        j = wp.api(action="query", prop="extracts|description", titles=t, exintro="1", explaintext="1", exsentences="2", redirects="1")
        p = j["query"]["pages"][0]
        desc, ext = (p.get("description") or "").strip(), re.sub(r"\s+", " ", p.get("extract") or "").strip()
        first = re.split(r"(?<=[.!?])\s+(?=[A-Z])", ext)[0] if ext else ""
        text = (desc[:1].upper() + desc[1:] + ". " if desc else "") + first
        out[t] = text[:300]
    return out


def hole_route(hole_id):
    net = json.load(open(NETWORK))
    h = next(x for x in net["holes"] if x["id"] == hole_id)
    srcs = sorted(h["sources"], key=lambda s: s["position"])
    by = {s["id"]: s for s in srcs}

    def depth(s):
        n = 0
        while s.get("parentId"):
            s = by[s["parentId"]]
            n += 1
        return n
    leaf = max((s for s in srcs if s["kind"] == "wiki"), key=lambda s: (depth(s), -s["position"]))
    chain, s = [], leaf
    while s:
        if s["kind"] == "wiki" and (not chain or chain[-1]["title"] != s["title"]):
            chain.append({"title": s["title"], "note": s.get("note") or ""})
        s = by.get(s.get("parentId"))
    return h, chain[::-1]


def slugify(title):
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return s[:56].rsplit("-", 1)[0] if len(s) > 56 else s


def build(slug):
    cfg = TAPES[slug]
    t0, live0 = time.time(), wp.LIVE[0]
    hole, chain = hole_route(cfg["hole"])
    cm = wp.canon([cfg["start"], cfg["target"]] + [c["title"] for c in chain])
    S, T = cm[cfg["start"]], cm[cfg["target"]]
    for c in chain:
        c["title"] = cm.get(c["title"]) or c["title"]
    if chain[-1]["title"] != T:
        chain.append({"title": T, "note": "", "headline": True})
    direct = connect(S, T)
    if direct:
        raise SystemExit(f"{slug}: {S} and {T} are already one step apart ({direct})")

    hops = []
    for a, b in zip([c["title"] for c in chain], [c["title"] for c in chain][1:]):
        kind = connect(a, b) or "jump"
        hops.append({"kind": kind, "s": tie(a, b, kind) if kind != "jump" else ""})
    par = max(3, len(chain) - 1)

    # the target's neighbours for TRACKING: what it links in its opening paragraphs first, then the rest, then what links it
    tp = parsed(T)
    first = []
    for para in tp["paras"]:
        for _, _, y in para["links"]:
            first.append(y)
    rest = [t for t, cat, _ in tp["links"] if cat in ("prose", "list", "table", "infobox", "see-also", "figure", "hatnote")]
    back, _ = wp.backlinks(T, cap=20)
    order, seen = [], set()
    raw = list(dict.fromkeys(first + rest))
    cm2 = wp.canon(raw)
    for t in [cm2.get(x) for x in raw] + sorted(back):
        if t and t not in seen and t not in (S, T) and not BROAD.match(t) and "disambiguation" not in t:
            seen.add(t)
            order.append(t)
    near = order[:3000]

    out = {
        "slug": slug, "built": time.strftime("%Y-%m-%d"),
        "start": S, "target": T, "par": par,
        "hole": {"id": hole["id"], "title": hole["title"], "author": hole["author"],
                 "url": "https://whiterabbt.com/r/" + hole["id"] + "/" + slugify(hole["title"]),
                 "route": [{"t": c["title"], "note": c["note"], "headline": bool(c.get("headline"))} for c in chain], "hops": hops},
        "near": near,
        "about": about(list(dict.fromkeys([S, T] + [c["title"] for c in chain]))),
    }
    os.makedirs(os.path.join(HERE, "puzzles"), exist_ok=True)
    path = os.path.join(HERE, "puzzles", slug + ".json")
    with open(path + ".tmp", "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(path + ".tmp", path)
    # guesses for noclick/test.cjs: a chain that works (the rabbit's own when every hop counts)
    sample = [c["title"] for c in chain[1:]] if all(h["kind"] != "jump" for h in hops) else cfg.get("sample", [])
    with open(os.path.join(HERE, "puzzles", slug + ".check.json"), "w") as f:
        json.dump({"route": sample, "static": "Xyzzy plugh gadget", "broad": "1987", "dab": cfg.get("dab")}, f, indent=1)
    log(slug, f"{S} -> {T}: par {par}; hops {[h['kind'] for h in hops]}; {len(near)} neighbours; "
        f"{os.path.getsize(path):,} bytes; {wp.LIVE[0] - live0} live requests; {time.time() - t0:.0f}s")


COUNTRIES = "/Users/vincentfeng/whiterabbit/reports/no-clicking-2026-10-22/work/supply/countries.json"


def broad_list():
    """Pages too general to be a step: Wikipedia's ~1,000 core topics ("Vital articles, level 3") minus its famous
    people, every country, and the continents. Written to broad.json; page.mjs puts it in the page."""
    j = wp.api(action="query", prop="revisions", titles="Wikipedia:Vital articles/Level/3", rvprop="content", rvslots="main", redirects="1")
    txt = j["query"]["pages"][0]["revisions"][0]["slots"]["main"]["content"]
    sec, names_ = None, []
    for line in txt.split("\n"):
        m = re.match(r"^(=+)\s*(.*?)\s*\1\s*$", line)
        if m and len(m.group(1)) == 2:
            sec = re.sub(r"\(.*?\)", "", re.sub(r"\[\[|\]\]", "", m.group(2))).strip()
            continue
        if sec and sec != "People":
            names_ += [l.strip() for l in re.findall(r"\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]", line) if ":" not in l]
    names_ += json.load(open(COUNTRIES)) + ["England", "Scotland", "Wales", "Northern Ireland", "Africa", "Asia", "Europe",
                                            "North America", "South America", "Oceania", "Antarctica", "Australia (continent)"]
    cm = wp.canon(sorted(set(names_)))
    titles = sorted({c for c in cm.values() if c})
    with open(os.path.join(HERE, "broad.json"), "w") as f:
        json.dump({"source": "Wikipedia:Vital articles/Level 3 without People, plus countries and continents", "built": time.strftime("%Y-%m-%d"),
                   "titles": titles}, f, ensure_ascii=False, separators=(",", ":"))
    log("broad.json:", len(titles), "pages too broad to be a step")


if __name__ == "__main__":
    if sys.argv[1:2] == ["--broad"]:
        broad_list()
    else:
        for s in (sys.argv[1:] or list(TAPES)):
            build(s)
