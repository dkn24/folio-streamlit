# Folio

Folio is a Streamlit reading room for research papers. It ships with 14 starter papers and five complete, attributed articles. You can search live indexes, browse by topic, bookmark papers, and resume reading at a saved section on a phone or computer.

## Run on Windows

1. Install Python 3.12 from [python.org](https://www.python.org/downloads/). Include the Python launcher when installing it.
2. Extract the entire ZIP. Open the folder containing `streamlit_app.py`.
3. Double-click `start-windows.bat`. On the first run it creates an isolated Python environment and installs the packages in `requirements.txt`. Keep the console open while you read. Press Ctrl+C in it to stop.

To launch manually instead, open PowerShell in that same folder and run:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m streamlit run streamlit_app.py
```

Open the local URL printed in the console, usually **http://localhost:8501**. The first two commands are setup. Use just the last command next time.

## Run on macOS or Linux

From the extracted project folder:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m streamlit run streamlit_app.py
```

To read from your phone on the same private Wi-Fi, start Streamlit on your computer with `--server.address=0.0.0.0` appended to the launch command. Open the printed Network URL on your phone. If your firewall prompts you, allow connections only on your private network. For access away from home, use the hosting option below.

## Find and read a paper

- **Discover** includes a rotating spotlight and topic filters. Search by title, author, DOI or keywords, e.g. “music information retrieval”. Crossref, arXiv and Europe PMC work without a key.
- **My library** separates saved-for-later, reading and finished papers. Opening a paper starts it. The reader saves your location as you scroll. **Aa** changes text size and page colour. **Mark as finished** completes it.
- **For you** uses topics and keywords from papers you save or read. Finishing a paper gives it more weight. Recommendations show the paper that contributed the strongest match when available.
- The reader uses bundled articles, available arXiv HTML, or Europe PMC open-access text. Other records may have only an abstract, index excerpt, or editorial notes. Open the source or select **Reflow linked PDF** when available. **Choose PDF** sends a copy to the running Streamlit server for text extraction. Scanned PDFs require a text layer. Use the original edition for exact equations, tables, and figures.

## Google Scholar results (optional)

Copy `.streamlit/secrets.toml.example` to `.streamlit/secrets.toml`. Add your own SerpApi key, then restart Streamlit:

```toml
SERPAPI_KEY = "your-serpapi-key"
```

Choose **Google Scholar** in the search form. This option uses SerpApi’s third-party Google Scholar integration and its account quota. Search results also include a link to open the query directly in Google Scholar. Keep the secrets file out of source control.

## Storage and caching

By default, each browser saves bookmarks and progress locally. IndexedDB caches retrieved article text and searches. The server caches successful searches for six hours and retrieved editions for up to one day. Open **My library → Library settings → Export backup** to download your bookmarks and reading positions. Importing a backup merges entries and keeps the newer bookmark and reading changes independently. PDF files and cached articles are excluded from this backup.

For automatic sync on a computer running Folio, set a **persistent SQLite file path** in `.streamlit/secrets.toml`, for example:

```toml
FOLIO_DB_PATH = "folio-data/library.sqlite3"
```

Restart the app. In **My library → Library settings**, copy your private library key. Open the same app on your phone and connect with that key. The two devices merge their reading libraries. Treat the key like a password. Anyone who has it can access that library.

For hosted sync, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the credentials for your own Turso database. Folio creates the table on first sync and separates libraries using a hash of each secret key. Prefer this option on Community Cloud, where local server files can be cleared. Device-only storage and JSON backups work without any database.

## Deploy yourself on Streamlit Community Cloud

1. Upload the extracted project files to your GitHub repository. Include `.streamlit/config.toml`, the data, fonts, artwork and web folders. Exclude `.venv/`, local database files and `.streamlit/secrets.toml`.
2. In [Streamlit Community Cloud](https://share.streamlit.io/), choose **Create app**, select the repository and branch, and set **Main file path** to `streamlit_app.py` (include its folder prefix if you put it in a subdirectory).
3. Select Python 3.12 in Advanced settings. Add optional secrets there. Choose **Deploy**.

[Streamlit deployment guide](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy) · [SerpApi Google Scholar documentation](https://serpapi.com/google-scholar-api)

## Project files

- `streamlit_app.py` registers the reading interface, handles its requests, and manages server caches.
- `folio/sources.py`, `reader.py`, and `shelf.py` handle search, text extraction and optional sync.
- `web/` contains the responsive interface and browser-side storage.
- `data/` contains the catalogue and licensed reading editions. Article sources, credit and licence information appear in each bundled edition.
- `static/` contains the illustrations, fonts and font licences.
