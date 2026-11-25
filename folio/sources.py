import html as entities
import re
from concurrent.futures import ThreadPoolExecutor
from itertools import zip_longest
from urllib.parse import urlsplit

import requests
from lxml import etree, html

TIMEOUT = (3.5, 8)
HEADERS = {"User-Agent": "FolioResearchReader/1.0"}
TOPICS = {
    "Machine learning": (
        "neural",
        r"machine learning|deep learning|artificial intelligence|neural|transformers?|language models?|reinforcement learning",
    ),
    "Physics": (
        "astronomy",
        r"physics|quantum|astronom|gravit|black holes?|cosmolog|photon|relativity|optics",
    ),
    "Biology": (
        "botany",
        r"biolog|ecolog|biodivers|botan|evolution|genom|cellular|protein|morphogenesis|clinical",
    ),
    "Mathematics": (
        "maths",
        r"mathemati|topolog|geometr|theorem|algebra|calculus|number theory|graph theory|statistic",
    ),
    "Computer science": (
        "computing",
        r"computer|computing|algorithm|cryptograph|software|programming|distributed|database|informatics|cybersecurity|information retrieval",
    ),
    "Cognitive science": (
        "cognition",
        r"cognit|psycholog|percept|working memory|neuroscien|decision making|behaviou?ral",
    ),
}
ARXIV_ID = re.compile(r"(?:\d{4}\.\d{4,5}|[A-Za-z][\w.-]+/\d{7})(?:v\d+)?$")
DOI = re.compile(r"10\.\d{4,9}/[^\s]+", re.I)
PMC = re.compile(r"PMC\d{1,12}$", re.I)


def plain(value):
    return re.sub(
        r"\s+", " ", entities.unescape(re.sub(r"<[^>]*>", " ", str(value or "")))
    ).strip()


def safe_url(value):
    try:
        loc = urlsplit(str(value or ""))
        return (
            loc.geturl()
            if loc.scheme in ("https", "http") and loc.hostname and not loc.username
            else ""
        )
    except (TypeError, ValueError):
        return ""


def get(url, *, params=None, limit=6_000_000, headers=None):
    with requests.get(
        url,
        params=params,
        headers={**HEADERS, **(headers or {})},
        timeout=TIMEOUT,
        stream=True,
    ) as response:
        response.raise_for_status()
        chunks = bytearray()
        for block in response.iter_content(64_000):
            chunks.extend(block)
            if len(chunks) > limit:
                raise ValueError("Source document is too large.")
        return bytes(chunks)


def json_get(url, params):
    import json

    return json.loads(get(url, params=params))


def tagged(paper, query, hints=()):
    hints = [plain(x) for x in hints if isinstance(x, str)][:20]
    content = " ".join(
        [
            paper["title"],
            paper.get("venue", ""),
            *hints,
            paper.get("abstract", "")[:600],
        ]
    )
    detected = [
        t for t, (_, pattern) in TOPICS.items() if re.search(pattern, content, re.I)
    ]
    if not detected:
        detected = [
            t for t, (_, pattern) in TOPICS.items() if re.search(pattern, query, re.I)
        ]
    paper["topics"] = detected or hints[:1] or ["Research"]
    paper["art"] = TOPICS.get(paper["topics"][0], ("computing", ""))[0]
    paper["keywords"] = hints
    paper["description"] = (paper.get("abstract") or paper.get("snippet") or "")[:320]
    return paper


def crossref(query):
    data = json_get(
        "https://api.crossref.org/works",
        {
            "query.bibliographic": query,
            "rows": 18,
            "filter": "type:journal-article,type:proceedings-article,type:posted-content",
            "select": "DOI,title,author,issued,container-title,URL,abstract,subject",
        },
    )
    result = []
    for x in data["message"]["items"]:
        if not x.get("DOI") or not x.get("title"):
            continue
        doi = x["DOI"].lower()
        authors = [
            " ".join(filter(None, (a.get("given"), a.get("family") or a.get("name"))))
            for a in x.get("author", [])
        ]
        paper = dict(
            id="doi:" + doi,
            doi=doi,
            title=plain(x["title"][0]),
            authors=[n for n in authors if n][:35],
            year=(x.get("issued", {}).get("date-parts") or [[""]])[0][0],
            venue=plain((x.get("container-title") or ["Crossref"])[0]),
            url="https://doi.org/" + doi,
            abstract=plain(x.get("abstract")),
            source="Crossref",
        )
        result.append(tagged(paper, query, x.get("subject", [])))
    return result


def europe(query):
    data = json_get(
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
        {
            "query": f"({query}) AND OPEN_ACCESS:Y",
            "format": "json",
            "resultType": "core",
            "pageSize": 12,
        },
    )
    result = []
    for x in data.get("resultList", {}).get("result", []):
        pmcid, doi = x.get("pmcid"), str(x.get("doi") or "").lower()
        if not x.get("title") or not (pmcid or doi):
            continue
        authors = [
            a.get("fullName") or a.get("collectiveName")
            for a in x.get("authorList", {}).get("author", [])
        ]
        venue = (
            x.get("journalTitle")
            or x.get("journalInfo", {}).get("journal", {}).get("title")
            or "Europe PMC"
        )
        result.append(
            tagged(
                dict(
                    id="doi:" + doi if doi else "pmc:" + pmcid,
                    title=plain(x["title"]).rstrip("."),
                    authors=[n for n in authors if n][:35],
                    year=x.get("pubYear", ""),
                    venue=venue,
                    doi=doi,
                    pmcid=pmcid,
                    abstract=plain(x.get("abstractText")),
                    url="https://europepmc.org/articles/" + pmcid
                    if pmcid
                    else "https://doi.org/" + doi,
                    source="Europe PMC",
                ),
                query,
                x.get("keywordList", {}).get("keyword", []),
            )
        )
    return result


def arxiv(query):
    terms = re.findall(r"[\w.-]+", query)[:14]
    if not terms:
        return []
    response = get(
        "https://export.arxiv.org/api/query",
        params={
            "search_query": " AND ".join(f'all:"{word}"' for word in terms),
            "max_results": 12,
            "sortBy": "relevance",
        },
    )
    ns = {"a": "http://www.w3.org/2005/Atom"}
    root = etree.fromstring(
        response, parser=etree.XMLParser(resolve_entities=False, no_network=True)
    )
    if etree.QName(root).localname != "feed":
        raise ValueError("arXiv feed unavailable.")
    papers = []
    for e in root.findall("a:entry", ns):
        field = lambda name: plain(e.findtext("a:" + name, "", ns))
        identifier = field("id").rpartition("/abs/")[2]
        if not ARXIV_ID.fullmatch(identifier):
            if "api/errors" in field("id"):
                raise ValueError("arXiv temporarily unavailable.")
            continue
        base = re.sub(r"v\d+$", "", identifier)
        cats = [el.get("term", "") for el in e.findall("a:category", ns)]
        topics = []
        for cat in cats:
            topic = (
                "Machine learning"
                if cat in ("cs.LG", "cs.CV", "cs.AI", "cs.CL", "stat.ML")
                else "Computer science"
                if cat.startswith("cs.")
                else "Mathematics"
                if cat.startswith(("math.", "stat."))
                else "Biology"
                if cat.startswith("q-bio")
                else "Physics"
                if cat.split(".")[0]
                in (
                    "astro-ph",
                    "physics",
                    "quant-ph",
                    "gr-qc",
                    "hep-th",
                    "cond-mat",
                    "nlin",
                )
                else ""
            )
            if topic and topic not in topics:
                topics.append(topic)
        papers.append(
            tagged(
                dict(
                    id="arxiv:" + base,
                    arxiv=base,
                    title=field("title"),
                    authors=[
                        plain(v)
                        for v in e.xpath("a:author/a:name/text()", namespaces=ns)
                    ][:35],
                    year=field("published")[:4],
                    venue="arXiv",
                    url="https://arxiv.org/abs/" + base,
                    htmlUrl="https://arxiv.org/html/" + identifier,
                    pdfUrl="https://arxiv.org/pdf/" + base,
                    abstract=field("summary"),
                    source="arXiv",
                ),
                query,
                topics + cats,
            )
        )
    return papers


def scholar(query, key):
    data = json_get(
        "https://serpapi.com/search.json",
        {"engine": "google_scholar", "q": query, "num": 15, "api_key": key},
    )
    if data.get("error"):
        raise ValueError("Google Scholar provider unavailable.")
    papers = []
    for x in data.get("organic_results", []):
        url = safe_url(x.get("link"))
        if not url or not x.get("title") or not x.get("result_id"):
            continue
        meta = x.get("publication_info", {})
        ref = plain(meta.get("summary"))
        year = re.search(r"\b(?:19|20)\d{2}\b", ref)
        venue = re.split(r"\s[-–]\s", ref)
        p = dict(
            id="scholar:" + str(x["result_id"]),
            title=plain(x["title"]),
            authors=[a["name"] for a in meta.get("authors", []) if a.get("name")][:35],
            year=year.group() if year else "",
            venue=re.sub(r",?\s*(?:19|20)\d{2}\s*$", "", venue[1])
            if len(venue) > 1
            else "Google Scholar",
            url=url,
            snippet=plain(x.get("snippet")),
            source="Google Scholar",
        )
        arx = re.search(r"arxiv\.org/(?:abs|pdf|html)/(\d{4}\.\d{4,5})", url)
        if arx:
            p.update(arxiv=arx[1], pdfUrl="https://arxiv.org/pdf/" + arx[1])
        if urlsplit(url).hostname in ("doi.org", "dx.doi.org"):
            p["doi"] = urlsplit(url).path.lstrip("/").lower()
        pmc = re.search(r"PMC\d+", url, re.I)
        if pmc:
            p["pmcid"] = pmc[0].upper()
        papers.append(tagged(p, query))
    return papers


def search(query, source="Open indexes", key=""):
    query = " ".join(query.split())[:200]
    if not query:
        return {"papers": [], "providers": [], "failed": []}
    if source == "Google Scholar":
        if not key:
            raise ValueError("Google Scholar needs a server-side SerpApi key.")
        providers = {"Google Scholar": lambda q: scholar(q, key)}
    else:
        providers = {"Crossref": crossref, "arXiv": arxiv, "Europe PMC": europe}
    results, failed, used = [], [], []
    with ThreadPoolExecutor(max_workers=len(providers)) as pool:
        jobs = {name: pool.submit(func, query) for name, func in providers.items()}
        for name, job in jobs.items():
            try:
                items = job.result()
            except (
                requests.RequestException,
                ValueError,
                KeyError,
                IndexError,
                TypeError,
                etree.Error,
            ):
                failed.append(name)
            else:
                used.append(name)
                results.append(items)
    papers, lookup = [], {}
    for group in zip_longest(*results):
        for p in group:
            if not p:
                continue
            aliases = [
                p["id"],
                "title:" + " ".join(re.findall(r"\w+", p["title"].lower())),
            ]
            if p.get("doi"):
                aliases.append("doi:" + p["doi"].lower())
            old = next((lookup[key] for key in aliases if key in lookup), None)
            if old is None:
                papers.append(p)
                old = p
            else:
                for field in ("abstract", "doi", "arxiv", "pmcid", "htmlUrl", "pdfUrl"):
                    if not old.get(field) and p.get(field):
                        old[field] = p[field]
            for alias in aliases:
                lookup[alias] = old
    return {"papers": papers, "providers": used, "failed": failed}
