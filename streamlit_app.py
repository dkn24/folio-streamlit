"""Run with: python -m streamlit run streamlit_app.py"""

import base64
import binascii
import json
import os
from pathlib import Path

import streamlit as st

from folio import reader, shelf, sources

ROOT = Path(__file__).resolve().parent
st.set_page_config(
    page_title="Folio · Research reading room",
    page_icon="📖",
    layout="wide",
    initial_sidebar_state="collapsed",
)


def setting(key):
    if os.environ.get(key):
        return os.environ[key]
    try:
        return str(st.secrets.get(key, "") or "")
    except FileNotFoundError:
        return ""


@st.cache_data(ttl=21600, max_entries=100, show_spinner=False)
def indexed_search(query, source, _api_key):
    result = sources.search(query, source, _api_key)
    if not result["providers"]:
        raise RuntimeError(
            "The research indexes are temporarily unavailable. Try again or use your saved results."
        )
    return result


@st.cache_data(ttl=86400, max_entries=30, show_spinner=False)
def cached_edition(paper_json):
    return reader.readable_edition(json.loads(paper_json))


@st.cache_data(ttl=86400, max_entries=12, show_spinner=False)
def cached_source_pdf(url):
    return reader.reflow_pdf(sources.get(url, limit=16_000_000), url)


@st.cache_data(show_spinner=False)
def component_files():
    js = "\n".join(
        (ROOT / "web" / name).read_text()
        for name in ("model.js", "views.js", "component.js")
    )
    return (
        js,
        (ROOT / "web/style.css").read_text(),
        (ROOT / "web/shell.css").read_text(),
    )


@st.cache_data(show_spinner=False)
def bundled_editions():
    return {
        p["id"]: json.loads((ROOT / "data/text" / (p["id"] + ".json")).read_text())
        for p in reader.CATALOGUE
        if p.get("localText")
    }


def handle(event, api_key, store_cfg):
    action = str(event.get("kind", ""))
    reply = {"id": str(event.get("id", ""))[:100], "kind": action}
    if action == "search":
        q = " ".join(str(event.get("q", "")).split())[:200]
        source = (
            "Google Scholar"
            if event.get("source") == "Google Scholar"
            else "Open indexes"
        )
        if not q:
            raise ValueError("Enter a title, author, DOI, or topic.")
        if source == "Google Scholar" and not api_key:
            raise ValueError("The Google Scholar provider needs a SerpApi key.")
        reply["value"] = indexed_search(q, source, api_key)
    elif action == "sync":
        if not ((store_cfg[0] and store_cfg[1]) or store_cfg[2]):
            raise ValueError("Shared storage is not configured.")
        reply["value"] = shelf.sync(
            event.get("code"), event.get("entries", []), store_cfg
        )
    elif action in ("edition", "pdf", "import"):
        p = shelf.clean_paper(event.get("paper", {}))
        p = reader.BY_ID.get(p["id"], p)
        if action == "edition":
            reply["value"] = cached_edition(json.dumps(p, sort_keys=True))
        elif action == "pdf":
            url = reader.pdf_source(p)
            if not url:
                raise ValueError(
                    "This paper has no linked PDF. Choose a copy on your device."
                )
            reply["value"] = cached_source_pdf(url)
        else:
            data = event.get("file")
            if not isinstance(data, str) or len(data) > 21_333_336:
                raise ValueError("Choose a PDF under 16 MB.")
            try:
                content = base64.b64decode(data, validate=True)
            except (ValueError, binascii.Error):
                raise ValueError("The selected PDF could not be read.") from None
            reply["value"] = reader.reflow_pdf(content, p.get("url", ""), local=True)
    else:
        raise ValueError("Unknown action.")
    return reply


js, css, shell_css = component_files()
st.html("<style>" + shell_css + "</style>")
view = st.components.v2.component(
    name="folio_reader",
    html='<div class="folio-root"></div>',
    css=css,
    js=js,
    isolate_styles=False,
)
api_key = setting("SERPAPI_KEY")
config = (
    setting("TURSO_DATABASE_URL"),
    setting("TURSO_AUTH_TOKEN"),
    setting("FOLIO_DB_PATH"),
)
shared = bool((config[0] and config[1]) or config[2])


def receive():
    state = st.session_state.get("folio_room")
    event = (
        state.get("request")
        if isinstance(state, dict)
        else getattr(state, "request", None)
    )
    if not isinstance(event, dict) or not event.get("id"):
        return
    if event.get("id") == st.session_state.get("folio_reply", {}).get("id"):
        return
    try:
        reply = handle(event, api_key, config)
    except (ValueError, RuntimeError) as exc:
        # Return only the messages authored by this app. Never expose provider URLs or keys.
        message = str(exc)
        if not message.startswith(
            (
                "Choose a PDF",
                "Enter a title",
                "The research indexes",
                "This PDF",
                "The library key",
                "This paper has no",
                "The selected PDF",
                "Shared storage",
                "The Google Scholar",
                "The PDF text",
            )
        ):
            message = "The source could not complete this request. You can try again."
        reply = {"id": event["id"], "kind": event.get("kind"), "error": message}
    except Exception:
        reply = {
            "id": event["id"],
            "kind": event.get("kind"),
            "error": "The source could not be reached. Try again or open the original.",
        }
    st.session_state["folio_reply"] = reply


view(
    key="folio_room",
    data={
        "catalogue": reader.CATALOGUE,
        "bundled": bundled_editions(),
        "topics": list(sources.TOPICS),
        "scholar": bool(api_key),
        "shared": shared,
        "reply": st.session_state.get("folio_reply"),
    },
    on_request_change=receive,
)
