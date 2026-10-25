"""Read one Wikipedia page (Parsoid HTML) the way the referee does.

Every article link is tagged by where it sits (prose, list, table, infobox, hatnote, caption, See also,
navbox header, navbox list, sidebar, references...), following the research's classifier
(reports/no-clicking-2026-10-22/work/api/bodylinks.py). Body paragraphs are kept as plain text with the
position of each link in them, for TRACKING sentences, the rabbit's route and "mentions it" checks.
"""
import re, urllib.parse
from html.parser import HTMLParser

STRONG = [  # (category, classes): the outermost strong container wins
    ("navbox", {"navbox", "navbox-inner", "navbox-subgroup", "navbox-list", "authority-control"}),
    ("sidebar", {"sidebar", "vertical-navbox"}),
    ("infobox", {"infobox", "taxobox", "biota", "infobox_v2"}),
    ("hatnote", {"hatnote", "dablink", "rellink", "shortdescription"}),
    ("references", {"reflist", "references", "mw-references-wrap", "mw-ref", "reference", "citation", "refbegin"}),
    ("boxes", {"ambox", "metadata", "mbox-small", "portalbox", "portal", "sistersitebox", "side-box", "noprint",
               "plainlinks", "box-More_citations_needed", "quotebox", "navigation-not-searchable"}),
    ("figure", {"thumb", "gallery", "thumbcaption"}),
]
STRONG_TAGS = {"figure": "figure", "figcaption": "figure"}
APPENDIX = {"references", "notes", "notes and references", "citations", "sources", "bibliography", "works cited",
            "literature", "further reading", "external links", "footnotes", "explanatory notes", "general and cited references",
            "cited sources", "general references", "references and notes", "notes and citations", "selected bibliography"}
NS = {"file", "image", "category", "help", "template", "wikipedia", "portal", "special", "talk", "user", "draft",
      "module", "mediawiki", "template talk", "wikipedia talk", "wp", "wikt", "wiktionary", "media", "timedtext", "s", "w"}
VOID = {"br", "img", "link", "meta", "hr", "input", "wbr", "source", "col", "area", "base", "embed", "param", "track"}
# Rule D: the article's own content plus navbox header topics (research recommendation)
CONTENT = {"prose", "list", "table", "infobox", "hatnote", "figure", "see-also", "navbox-head"}
SILENT = {"style", "script", "math"}


def key(t):
    t = urllib.parse.unquote(t).replace("_", " ").strip()
    t = re.sub(r"\s+", " ", t)
    return (t[:1].upper() + t[1:]) if t else t


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.section = "lead"
        self.h2 = None
        self.links = []      # (target as written, category, is_redirect)
        self.paras = []      # {"text": str, "links": [(start, end, target)]}
        self.cur = None      # paragraph being read
        self.anchor = None   # (target, start) of the open link inside the paragraph
        self.mute = 0        # depth inside refs/styles while reading a paragraph

    def strong(self):
        return [c for _, c, _, _ in self.stack if c in ("navbox", "sidebar", "infobox", "hatnote", "references", "boxes", "figure")]

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        a = dict(attrs)
        cls = set((a.get("class") or "").split())
        cat = None
        for c, s in STRONG:
            if cls & s:
                cat = c
                break
        if cat is None and tag in STRONG_TAGS:
            cat = STRONG_TAGS[tag]
        if cat is None and tag == "sup" and "mw-ref" in cls:
            cat = "references"
        if tag == "table":
            cat = cat or "table"
        if tag in ("ul", "ol", "dl"):
            cat = cat or "list"
        if tag == "p":
            cat = cat or "prose"
        if tag == "h2":
            self.h2 = ""
        mute = tag in SILENT or cat == "references" or bool(cls & {"mw-editsection", "noprint"})
        self.stack.append((tag, cat, cls, mute))
        if self.cur is not None and mute:
            self.mute += 1
        if tag == "p" and self.cur is None and not self.strong() and self.section in ("lead", "body"):
            self.cur = {"text": "", "links": []}
            self.mute = 0
        if tag == "a" and "mw:WikiLink" in (a.get("rel") or "").split() and "new" not in cls and "mw-selflink" not in cls:
            t = a.get("title")
            if not t and (a.get("href") or "").startswith("./"):
                t = a["href"][2:]
            if not t:
                return
            t = key(t.split("#")[0].split("?")[0])
            if not t or (":" in t and t.split(":", 1)[0].strip().lower() in NS):
                return
            self.links.append((t, self.where(), "mw-redirect" in cls))
            if self.cur is not None and not self.mute:
                self.anchor = (t, len(self.cur["text"]))

    def where(self):
        strong = self.strong()
        if strong:
            if strong[0] == "navbox" and any(k & {"navbox-title", "navbox-group", "navbox-abovebelow"} for _, _, k, _ in self.stack):
                return "navbox-head"
            return strong[0]
        if self.section == "see also":
            return "see-also"
        if self.section == "appendix":
            return "appendix"
        inner = [c for _, c, _, _ in self.stack if c in ("table", "list", "prose")]
        if "table" in inner:
            return "table"
        if "list" in inner:
            return "list"
        if "prose" in inner:
            return "prose"
        return "other"

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag == "h2" and self.h2 is not None:
            h = re.sub(r"\s+", " ", self.h2).strip().lower()
            self.section = "see also" if h == "see also" else "appendix" if h in APPENDIX else "body"
            self.h2 = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                popped = self.stack[i:]
                del self.stack[i:]
                if self.cur is not None:
                    self.mute = max(0, self.mute - sum(1 for x in popped if x[3]))
                    if tag == "a" and self.anchor:
                        t, s = self.anchor
                        e = len(self.cur["text"])
                        if e > s:
                            self.cur["links"].append((s, e, t))
                        self.anchor = None
                    if any(x[0] == "p" for x in popped):
                        txt = self.cur["text"]
                        if len(txt.strip()) > 40:
                            self.paras.append(self.cur)
                        self.cur = None
                        self.anchor = None
                        self.mute = 0
                return

    def handle_data(self, data):
        if self.h2 is not None:
            self.h2 += data
        if self.cur is not None and not self.mute:
            self.cur["text"] += data.replace("\n", " ")


def read(html):
    p = Page()
    if html:
        p.feed(html)
    return p


SENT = re.compile(r"(?<=[.!?])[\"”’)]*\s+(?=[A-Z\"“(‘0-9])")
ABBR = re.compile(r"(?:\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt|Ft|Gen|Col|Capt|Lt|Rev|Prof|No|Vol|vs|etc|c|ca|e\.g|i\.e|U\.S|U\.K|Inc|Ltd|Co|Corp|Bros|approx|fl|b|d)\.|\b[A-Z]\.)$")


def sentences(para):
    """Split a paragraph into (start, end) sentence spans, not breaking after common abbreviations."""
    text = para["text"]
    spans, s = [], 0
    for m in SENT.finditer(text):
        if ABBR.search(text[max(0, m.start() - 8):m.start()]):
            continue
        spans.append((s, m.start()))
        s = m.end()
    spans.append((s, len(text)))
    return [(a, b) for a, b in spans if b - a > 0]
