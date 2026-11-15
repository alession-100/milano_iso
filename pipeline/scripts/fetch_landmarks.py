"""Fetch and save the raw responses used by build_landmarks.py (T-1.5). Needs network.

Subcommands:
  search               Wikidata wbsearchentities for each landmark query (it, en).
  entities QID...      Wikidata entity JSON for the given QIDs.
  overpass QID...      Overpass: OSM elements tagged wikidata=<QID> (tags and centre only).
  contains NODE_ID...  Overpass: building ways/relations containing the node (is_in, pivot), tags only.
  osm TYPE/ID ...      OSM API full geometry (way/relation: /full, node: itself).
Politeness: generic User-Agent, at most 1 request per second.
The QID choice is made by a human reading the saved search responses (see choices.md).
"""

import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "reports" / "artifacts" / "T-1.5" / "responses"
UA = "milano-iso-landmarks/0.1"
QUERIES = {
    "duomo": "Duomo di Milano",
    "castello": "Castello Sforzesco",
    "velasca": "Torre Velasca",
    "pirelli": "Grattacielo Pirelli",
    "bosco_verticale": "Bosco Verticale",
    "centrale": "Stazione di Milano Centrale",
    "allianz": "Torre Allianz",
    "generali": "Torre Generali",
    "pwc": "Torre PwC",
    "meazza": "Stadio Giuseppe Meazza",
    "galleria": "Galleria Vittorio Emanuele II",
    "scala": "Teatro alla Scala",
    "palazzo_reale": "Palazzo Reale Milano",
    "palazzo_marino": "Palazzo Marino",
    "assicurazioni_generali": "Palazzo delle Assicurazioni Generali Cordusio",
}
_last = [0.0]


def get(url, data=None):
    wait = 1.05 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read()
            break
        except urllib.error.HTTPError as e:
            # Rate limit: back off (honouring Retry-After) and slow down; never rotate identity.
            if e.code not in (429, 502, 503, 504) or attempt == 3:
                raise
            time.sleep(max(10, int(e.headers.get("Retry-After", "10") or 10)))
    _last[0] = time.time()
    return body


def save(name, body):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_bytes(body)
    print("saved", name, len(body))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "search":
        for key, q in QUERIES.items():
            for lang in ("it", "en"):
                p = {
                    "action": "wbsearchentities",
                    "search": q,
                    "language": lang,
                    "uselang": lang,
                    "limit": "8",
                    "format": "json",
                }
                url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(p)
                save(f"search_{key}_{lang}.json", get(url))
    elif cmd == "searchq":  # extra search: KEY LANG TEXT...
        key, lang, text = args[0], args[1], " ".join(args[2:])
        p = {"action": "wbsearchentities", "search": text, "language": lang, "uselang": lang}
        p.update({"limit": "8", "format": "json"})
        url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(p)
        save(f"search_{key}_{lang}.json", get(url))
    elif cmd == "entities":
        for q in args:
            url = f"https://www.wikidata.org/wiki/Special:EntityData/{q}.json"
            save(f"wikidata_{q}.json", get(url))
    elif cmd == "overpass":
        for q in args:
            ql = f'[out:json][timeout:60];nwr["wikidata"="{q}"];out tags center;'
            data = urllib.parse.urlencode({"data": ql}).encode()
            save(f"overpass_{q}.json", get("https://overpass-api.de/api/interpreter", data))
    elif cmd == "contains":  # building=* areas that contain a node (rule of T-1.5a)
        for nid in args:
            ql = (
                f"[out:json][timeout:60];node({nid});is_in->.a;"
                '(way(pivot.a)["building"];rel(pivot.a)["building"];);out tags center;'
            )
            data = urllib.parse.urlencode({"data": ql}).encode()
            save(f"contains_node_{nid}.json", get("https://overpass-api.de/api/interpreter", data))
    elif cmd == "osm":
        for ref in args:
            typ, i = ref.split("/")
            path = f"{typ}/{i}" if typ == "node" else f"{typ}/{i}/full"
            save(f"osm_{typ}_{i}.json", get(f"https://api.openstreetmap.org/api/0.6/{path}.json"))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
