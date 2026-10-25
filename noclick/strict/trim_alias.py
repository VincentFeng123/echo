"""Keep only aliases of pages a player can stand on (recorded pages, the target, the hole's pages) in built tapes."""
import json, sys
for path in sys.argv[1:]:
    p = json.load(open(path))
    keep = {int(k) for k in p["pages"]} | {p["target"]} | {r["i"] for r in p["hole"]["route"]}
    lines = [l for l in p["alias"].split("\n") if l and int(l.split("\t")[1], 36) in keep]
    before = len(p["alias"])
    p["alias"] = "\n".join(lines)
    json.dump(p, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    print(path, before, "->", len(p["alias"]))
