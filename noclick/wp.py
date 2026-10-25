"""Polite, cached English Wikipedia client for the No Clicking puzzle build.

One request at a time, at most ~1 a second, a descriptive User-Agent, and it backs off on 429/5xx
(honouring Retry-After). Every response is cached gzip-compressed under CACHE, so a rebuild costs
nothing. The cache lives outside the prototype folder so it never ships.
"""
import gzip, hashlib, json, os, re, time, urllib.parse, urllib.request, urllib.error

CACHE = os.environ.get("NOCLICK_CACHE", "/Users/vincentfeng/whiterabbit/reports/no-clicking-2026-10-22/work/noclick-cache")
os.makedirs(CACHE, exist_ok=True)
UA = ("WhiteRabbitNoClickingBuild/0.1 (daily puzzle build; ~1 req/s; https://www.whiterabbt.com; "
      "contact.whiterabbt.com@gmail.com)")
API = "https://en.wikipedia.org/w/api.php"
_last = [0.0]
LIVE = [0]


def fetch(url):
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest() + ".gz")
    if os.path.exists(path):
        with gzip.open(path, "rb") as f:
            b = f.read()
        return None if b == b"\x00404" else b.decode("utf-8")
    backoff = 5
    for _ in range(7):
        wait = 1.0 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        LIVE[0] += 1
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
            with gzip.open(path, "wb") as f:
                f.write(raw)
            if time.time() - t0 > 1.0:
                time.sleep(2)  # slow answer: give the servers a breather
            return raw.decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                ra = e.headers.get("Retry-After")
                s = max(backoff, int(ra) if ra and ra.isdigit() else 0)
                print(f"  [{e.code}] backing off {s}s", flush=True)
                time.sleep(s)
                backoff *= 2
                continue
            if e.code == 404:
                with gzip.open(path, "wb") as f:
                    f.write(b"\x00404")
                return None
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  [net] {e}; retrying in {backoff}s", flush=True)
            time.sleep(backoff)
            backoff *= 2
    raise RuntimeError("gave up on " + url)


def api(**params):
    params = {"format": "json", "formatversion": "2", **params}
    return json.loads(fetch(API + "?" + urllib.parse.urlencode(params)))


def api_all(**params):
    out, cont = [], {}
    while True:
        j = api(**params, **cont)
        out.append(j)
        if "continue" in j:
            cont = j["continue"]
        else:
            return out


def html(title):
    return fetch("https://en.wikipedia.org/w/rest.php/v1/page/" + urllib.parse.quote(title.replace(" ", "_"), safe="") + "/html")


def chunks(xs, n=50):
    xs = list(xs)
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def canon(titles):
    """title as written -> canonical article title (None if missing). Follows redirects."""
    res = {}
    for chunk in chunks(dict.fromkeys(titles)):
        j = api(action="query", titles="|".join(chunk), redirects="1")
        q = j.get("query", {})
        norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
        red = {r["from"]: r["to"] for r in q.get("redirects", [])}
        pages = {p["title"]: p for p in q.get("pages", [])}
        for t in chunk:
            x = norm.get(t, t)
            seen = 0
            while x in red and seen < 3:
                x = red[x]
                seen += 1
            p = pages.get(x)
            res[t] = None if (p is None or p.get("missing") or p.get("invalid") or p.get("ns", 0) != 0) else x
    return res


def backlinks(title, cap=120):
    """Canonical articles that link `title`, directly or through a redirect (the link table: any link)."""
    s, cont, n = set(), {}, 0
    while True:
        j = api(action="query", list="backlinks", bltitle=title, blnamespace="0", bllimit="max", blredirect="1", **cont)
        n += 1
        for b in j.get("query", {}).get("backlinks", []):
            if b.get("redirect"):
                for r in b.get("redirlinks", []):
                    if r.get("ns") == 0:
                        s.add(r["title"])
            else:
                s.add(b["title"])
        if "continue" in j and n < cap:
            cont = j["continue"]
        else:
            s.discard(title)
            return s, "continue" not in j


def redirects_of(title):
    rs = []
    for j in api_all(action="query", prop="redirects", titles=title, rdlimit="max", rdnamespace="0"):
        for p in j.get("query", {}).get("pages", []):
            rs += [r["title"] for r in p.get("redirects", [])]
    return rs


_INFO = {}
INFO_PATH = os.path.join(CACHE, "info.json")


def _info_table():
    """Per-title answers to info(), kept in one file; built once from any cached batch answers."""
    if _INFO:
        return _INFO
    if os.path.exists(INFO_PATH):
        _INFO.update(json.load(open(INFO_PATH)))
        return _INFO
    for name in os.listdir(CACHE):
        if not name.endswith(".gz"):
            continue
        with gzip.open(os.path.join(CACHE, name), "rb") as f:
            b = f.read()
        if b"cirrusdoc" not in b[:400]:
            continue
        _info_parse(json.loads(b))
    return _INFO


def _info_parse(j):
    q = j.get("query", {})
    back = {n["to"]: n["from"] for n in q.get("normalized", [])}
    for p in q.get("pages", []):
        docs = p.get("cirrusdoc") or []
        src = docs[0].get("source", {}) if docs else {}
        rec = {"in": src.get("incoming_links"), "desc": p.get("description") or "", "dab": "disambiguation" in (p.get("pageprops") or {})}
        _INFO[p["title"]] = rec
        _INFO[back.get(p["title"], p["title"])] = rec


def info(titles):
    """incoming link count (CirrusSearch), short description and disambiguation flag per canonical title."""
    table = _info_table()
    need = [t for t in dict.fromkeys(titles) if t not in table]
    for k, chunk in enumerate(chunks(need)):
        _info_parse(api(action="query", prop="cirrusdoc|description|pageprops", titles="|".join(chunk),
                        cdincludes="incoming_links", ppprop="disambiguation"))
        if k % 10 == 9:
            json.dump(_INFO, open(INFO_PATH, "w"))
    json.dump(_INFO, open(INFO_PATH, "w"))
    return {t: table.get(t) for t in titles if table.get(t)}


def _info_unused(titles):
    out = {}
    for chunk in chunks(dict.fromkeys(titles)):
        j = api(action="query", prop="cirrusdoc|description|pageprops", titles="|".join(chunk),
                cdincludes="incoming_links", ppprop="disambiguation")
        q = j.get("query", {})
        back = {n["to"]: n["from"] for n in q.get("normalized", [])}
        for p in q.get("pages", []):
            docs = p.get("cirrusdoc") or []
            src = docs[0].get("source", {}) if docs else {}
            out[back.get(p["title"], p["title"])] = {
                "in": src.get("incoming_links"), "desc": p.get("description") or "",
                "dab": "disambiguation" in (p.get("pageprops") or {})}
    return out


def linksto_count(title):
    j = api(action="query", list="search", srsearch='linksto:"%s"' % title.replace('"', ''), srlimit="1", srinfo="totalhits", srprop="")
    return j.get("query", {}).get("searchinfo", {}).get("totalhits")
