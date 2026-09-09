# Invenio — Carpe Diem artist showcase

A fast, static website that shows the **whole** Carpe Diem collection (every artist and
work marked *Show on Website* in Airtable) with filters, artist pages, "find similar,"
and a client **favorites + share-link** feature. No record caps, no monthly fee.

It reads from Airtable **once per refresh** (not per visitor), re-hosts the images, and
serves everything as plain files — so it can never rate-limit and never breaks when
Airtable's image links expire.

## How it works

```
Airtable (source of truth)
      │   sync.py  (runs in GitHub Actions: daily + on-demand)
      ▼
_site/  →  data.json + img/*.webp + the app  →  GitHub Pages (the live URL)
```

- **Add/edit artists in Airtable exactly like today.** Tick *Show on Website* to publish.
- The site refreshes **automatically every morning**, and you can hit **Run now** anytime.
- Nothing writes back to Airtable. The token is read-only.

## One-time setup (≈10 minutes)

1. **Airtable token** — Airtable → *Builder Hub* → *Personal access tokens* → **Create token**.
   Scopes: `data.records:read` and `schema.bases:read`. Access: the **Carpe Diem MASTER** base. Copy it.
2. **Create a GitHub repo** (free) and upload this folder's contents.
3. Repo → *Settings* → *Secrets and variables* → *Actions* → **New repository secret**, twice:
   - `AIRTABLE_TOKEN` = the token from step 1.
   - `SITE_PASSWORD` = the gallery password clients will type to view the site.
4. Repo → *Settings* → *Pages* → *Source* = **GitHub Actions**.
5. Repo → *Actions* → **Build & deploy Invenio** → **Run workflow**.
   First run pulls all works + images (a few minutes). When it finishes, your live URL is
   under *Settings → Pages*.

That's it. After this, it self-updates daily; use **Run workflow** for an instant refresh.
To change the password later, edit the `SITE_PASSWORD` secret and re-run the workflow.

## Password protection

If `SITE_PASSWORD` is set, the data file is **AES-GCM encrypted** before it's published —
so artist contact details can't be scraped off the static host without the password.
Visitors type the password once; it unlocks in their browser. (Leave the secret unset to
publish a fully public site with no password.)

## What's shown

Everything from the Softr site: name, location (country/state), primary medium, style,
price range, open-for-licensing, artist website, email, Instagram, contact URL, notes,
sources, and the artwork images. **Confidence** is shown subtly, and only when it's Medium
or Low. All fields are also usable as filters where relevant. To hide any field, edit the
`detailsBlock` function in `assets/app.js`.

## Files

| File | Purpose |
|------|---------|
| `index.html`, `assets/` | the website (design + app logic) |
| `sync.py` | pulls Airtable → builds `_site/` (data + optimized images) |
| `.github/workflows/deploy.yml` | daily + manual refresh and deploy |
| `requirements.txt` | Python deps for the sync |

## Run a refresh locally (optional)

```bash
pip install -r requirements.txt
AIRTABLE_TOKEN=pat_xxx python3 sync.py     # builds ./_site
cd _site && python3 -m http.server 8000    # preview at localhost:8000
```
