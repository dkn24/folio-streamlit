import io
import json
import re
from pathlib import Path

import requests
from lxml import etree, html
from pypdf import PdfReader

from .sources import ARXIV_ID, DOI, PMC, get, json_get, safe_url

BASE = Path(__file__).resolve().parents[1]
CATALOGUE = json.loads((BASE / "data/catalogue.json").read_text())
BY_ID = {p["id"]: p for p in CATALOGUE}
MAX_TEXT = 2_000_000


def node_text(el):
    return " ".join(" ".join(el.itertext()).split())


def document_sections(body, xml=False):
    sections = []
    skips = {
        "script",
        "style",
        "nav",
        "table",
        "ref-list",
        "fig",
        "svg",
        "ref-entry",
        "ack",
        "fn-group",
    }

    def visit(el):
        if not isinstance(el.tag, str):
            return
        tag = etree.QName(el).localname.lower()
        classes = set(el.get("class", "").split())
        if tag in skips or classes.intersection(
            {"ltx_bibliography", "ltx_authors", "ltx_page_header", "ltx_note_content"}
        ):
            return
        heading = tag == "title" if xml else tag in {"h2", "h3", "h4", "h5", "h6"}
        if heading:
            t = node_text(el)
            if t:
                sections.append({"title": t, "paragraphs": []})
            return
        if tag in ("p", "figcaption", "disp-formula") or (
            tag == "li" and not el.xpath(".//p")
        ):
            t = node_text(el)
            if t:
                if not sections:
                    sections.append({"title": "Article", "paragraphs": []})
                sections[-1]["paragraphs"].append(t)
            return
        for child in el:
            visit(child)

    visit(body)
    return [s for s in sections if s["paragraphs"]]


def arxiv_text(identifier):
    assert ARXIV_ID.fullmatch(identifier)
    for url in [
        "https://arxiv.org/html/" + identifier,
        "https://ar5iv.labs.arxiv.org/html/" + identifier,
    ]:
        try:
            doc = html.fromstring(get(url))
            found = doc.xpath(
                "//*[contains(concat(' ',normalize-space(@class),' '),' ltx_document ')]"
            )
            if not found:
                continue
            root = found[0]
            for m in root.xpath(".//math"):
                val = m.get("alttext") or node_text(m)
                m.clear(keep_tail=True)
                m.text = val
            sections = document_sections(root)
            if len(sections) < 2:
                continue
            if sections[0]["title"] == "Article" and root.xpath(
                ".//*[contains(@class,'ltx_abstract')]"
            ):
                sections[0]["title"] = "Abstract"
            return {
                "format": "Full text",
                "sections": sections,
                "source": url,
                "attribution": "Text by the paper’s authors. Figures, tables, and original equation layout are available in the linked edition.",
            }
        except (requests.RequestException, ValueError, etree.Error):
            continue
    return None


def pmc_text(identifier):
    if not PMC.fullmatch(identifier):
        return None
    root = etree.fromstring(
        get(
            "https://www.ebi.ac.uk/europepmc/webservices/rest/"
            + identifier
            + "/fullTextXML"
        ),
        parser=etree.XMLParser(resolve_entities=False, no_network=True),
    )
    bodies = root.xpath("//*[local-name()='article']/*[local-name()='body']")
    if not bodies:
        return None
    sections = document_sections(bodies[0], xml=True)
    if not sections:
        return None
    abstract = [node_text(el) for el in root.xpath(".//article-meta/abstract[1]//p")]
    if abstract:
        sections.insert(0, {"title": "Abstract", "paragraphs": abstract})
    licences = root.xpath(".//permissions/license[1]")
    return {
        "format": "Full text",
        "sections": sections,
        "source": "https://europepmc.org/articles/" + identifier,
        "license": node_text(licences[0])
        if licences
        else "Open-access text supplied by Europe PMC.",
        "renderingNote": "The original edition includes figures, tables, and references.",
    }


def overview(p):
    sections = []
    if p.get("abstract"):
        sections.append({"title": "Abstract", "paragraphs": [p["abstract"]]})
    if p.get("overview"):
        sections.append({"title": "Editorial overview", "paragraphs": p["overview"]})
    if not sections and (p.get("snippet") or p.get("description")):
        sections.append(
            {
                "title": "Index excerpt",
                "paragraphs": [p.get("snippet") or p["description"]],
            }
        )
    return {
        "format": sections[0]["title"] if sections else "Paper details",
        "sections": sections,
        "source": safe_url(p.get("url")),
    }


def readable_edition(p):
    seed = BY_ID.get(p["id"])
    if seed and seed.get("localText"):
        return json.loads((BASE / "data/text" / (seed["id"] + ".json")).read_text())
    arxiv_id = str(p.get("arxiv") or "")
    doi = str(p.get("doi") or "")
    meta_url = (seed or {}).get("htmlUrl") or p.get("htmlUrl") or ""
    version = re.fullmatch(r"https://arxiv\.org/html/(.+)", meta_url)
    if version and ARXIV_ID.fullmatch(version[1]):
        arxiv_id = version[1]
    if not arxiv_id and doi.lower().startswith("10.48550/arxiv."):
        arxiv_id = doi[len("10.48550/arxiv.") :]
    pmc = str(p.get("pmcid") or "").upper()
    if ARXIV_ID.fullmatch(arxiv_id):
        ed = arxiv_text(arxiv_id)
        if ed:
            return ed
    if not pmc and DOI.fullmatch(doi) and len(doi) < 250 and '"' not in doi:
        try:
            found = json_get(
                "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
                {"query": f'DOI:"{doi}"', "format": "json", "pageSize": 1},
            )
            pmc = (found.get("resultList", {}).get("result") or [{}])[0].get(
                "pmcid", ""
            )
        except (requests.RequestException, ValueError, AttributeError):
            pass
    if PMC.fullmatch(pmc):
        try:
            ed = pmc_text(pmc)
            if ed:
                return ed
        except (requests.RequestException, ValueError, etree.Error):
            pass
    return overview(p)


def pdf_source(p):
    seed = BY_ID.get(p["id"])
    if seed and seed.get("pdfUrl"):
        return seed["pdfUrl"]
    identifier = str(p.get("arxiv") or "")
    return (
        "https://arxiv.org/pdf/" + identifier if ARXIV_ID.fullmatch(identifier) else ""
    )


def reflow_pdf(contents, source="", local=False):
    if len(contents) > 16_000_000 or b"%PDF-" not in contents[:1024]:
        raise ValueError("Choose a PDF under 16 MB.")
    pdf = PdfReader(io.BytesIO(contents), strict=False)
    if pdf.is_encrypted and not pdf.decrypt(""):
        raise ValueError("This PDF is password-protected.")
    if len(pdf.pages) > 300:
        raise ValueError("This PDF exceeds the reader’s 300-page limit.")
    sections, size = [], 0
    for i, page in enumerate(pdf.pages):
        # Use the PDF's reading order, preserving paragraph breaks and page references.
        extracted = page.extract_text() or ""
        groups = re.split(r"\n\s*\n", extracted.strip())
        paragraphs = []
        for block in groups:
            value = re.sub(r"(?<=[a-z])-\s*\n(?=[a-z])", "", block)
            value = " ".join(value.split())
            if not value:
                continue
            # Some publishers omit paragraph breaks in the text layer.
            if len(value) > 1000:
                fragments = re.split(r"(?<=[.!?])\s+(?=[A-Z(])", value)
                buf = ""
                for line in fragments:
                    buf = (buf + " " + line).strip()
                    if len(buf) >= 650:
                        paragraphs.append(buf)
                        buf = ""
                if buf:
                    paragraphs.append(buf)
            else:
                paragraphs.append(value)
        if paragraphs:
            sections.append({"title": f"Page {i + 1}", "paragraphs": paragraphs})
            size += sum(map(len, paragraphs))
        if size > MAX_TEXT:
            raise ValueError("The PDF text is too large for the reader.")
    if not sections:
        raise ValueError(
            "This PDF contains scanned images. Open the original to read it."
        )
    return {
        "format": "PDF text",
        "sections": sections,
        "source": safe_url(source),
        "renderingNote": (
            "Text extracted from your selected PDF."
            if local
            else "Text extracted from the linked PDF."
        )
        + " Page headings match the original. Refer to the original for figures, columns, and equations.",
    }
