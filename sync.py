#!/usr/bin/env python3
"""
Invenio sync — pulls the Carpe Diem MASTER base from Airtable, re-hosts artwork
images locally (so nothing depends on Airtable's expiring attachment URLs), and
writes a self-contained static site into ./_site .

If SITE_PASSWORD is set, the data file is AES-GCM encrypted (data.enc) and the
plaintext data.json is NOT deployed — so artist contact details can't be scraped
off the static host without the gallery password. Images stay as static files
(served from unguessable record-id URLs, but not themselves behind the password).

Run locally:   AIRTABLE_TOKEN=pat_xxx [SITE_PASSWORD=xxx] python3 sync.py
Read-only. Nothing here writes back to Airtable.
"""
import os, sys, json, re, io, time, base64, pathlib, shutil, urllib.parse
import requests
from PIL import Image, ImageOps

TOKEN   = os.environ.get("AIRTABLE_TOKEN")
BASE    = os.environ.get("AIRTABLE_BASE", "appGd5sDGCDrk0mBU")
PASSWORD= os.environ.get("SITE_PASSWORD", "").strip()
OUT     = pathlib.Path(os.environ.get("OUT_DIR", "_site"))
IMG_DIR = OUT / "img"
CACHE   = pathlib.Path(".cache")
THUMB_MAX, FULL_MAX, Q = 640, 1500, 82
MAX_CAROUSEL = 12

T_ARTISTS  = "tblX8QknZiu1K4XJ5"
T_WORKS    = "tblCH0uDzIjDfmIXE"
T_PROJECTS = "tbldiUWZbGduoEpoQ"
T_SAVED    = "tbl33AKqBJGbBNoXm"
WRITE_TOKEN = os.environ.get("AIRTABLE_WRITE_TOKEN", "").strip()
# Field IDs the browser needs to talk to Projects/Saved Items directly (favorites feature).
# Scope note: WRITE_TOKEN (if set) is a separate, narrower-purpose token from the main
# read-only AIRTABLE_TOKEN above — it's meant only for the Projects/Saved Items flow.
if WRITE_TOKEN and not PASSWORD:
    print("  ! WARNING: AIRTABLE_WRITE_TOKEN is set but SITE_PASSWORD is not — refusing to "
          "embed the write token, since it would ship in plaintext data.json for anyone to read. "
          "Set SITE_PASSWORD to enable the Projects feature.", file=sys.stderr)
    WRITE_TOKEN = ""
PROJECTS_CFG = {
    "enabled": bool(WRITE_TOKEN),
    "writeToken": WRITE_TOKEN or None,
    "baseId": BASE,
    "tables": {"projects": T_PROJECTS, "savedItems": T_SAVED},
    "fields": {
        "projectName": "fldxrHgpGLWIsiDdf",
        "ownerEmail": "fldGtsgj8SZ3nt0VS",
        "shareId": "fld4OwmJhwdQ7xVWJ",
        "siName": "fldrd32saPF7EIsUA",
        "siProject": "fldUNGXpBa2t9OY88",
        "siArtists": "fldqQ2uXVaV7KILDt",
        "siArtworks": "fld3GgDNFxOXVIGUP",
        "siType": "fld95zViJVuo7rb1w",
        "siProjectShareId": "fldH50uqgBc9kfPFC",
    },
}
F = dict(
    name="flddgzLmXxkVRG0qh", location="fld4y2HHDe2Wje6hs",
    medium="fld3o55Uyb5hSpPNq", style="fldjXHDiBJwAVOhLq",
    price="fldFHc5RjFqanL094", licensing="fldioRq6bGB06K2MM",
    licensing_price="fldYv07EoQ4bWVfI5",
    show="fldWGXnZXUys5TP5Z", works="fldUnGdv74Qyq7BLJ",
    website="fldGhGYkf2AbbNcBU", instagram="fld1gXFq37Ewy0Ag0",
    email="fld72xX5WXJRNYj5B", contact_url="fldP3MbEAMOUD6XD8",
    notes="fldNptqTWlOpEff9N", sources="fld17ukgOAPywUBwo",
    confidence="fldET86FbTlm1qXNl",
    w_image="fld5kMvkXepzRJ52U", w_artist="fldZj7IOBoZL9VFfk",
)

if not TOKEN:
    sys.exit("ERROR: set AIRTABLE_TOKEN (a read-only Airtable personal access token).")

S = requests.Session(); S.headers.update({"Authorization": f"Bearer {TOKEN}"})

def air_list(table, fields=None):
    url = f"https://api.airtable.com/v0/{BASE}/{table}"
    params = {"pageSize": 100, "returnFieldsByFieldId": "true"}
    if fields: params["fields[]"] = fields
    offset = None
    while True:
        p = dict(params)
        if offset: p["offset"] = offset
        for attempt in range(5):
            r = S.get(url, params=p, timeout=40)
            if r.status_code == 429:
                time.sleep(2 * (attempt + 1)); continue
            r.raise_for_status(); break
        data = r.json()
        for rec in data.get("records", []):
            yield rec
        offset = data.get("offset")
        if not offset: break
        time.sleep(0.22)

def clean_title(fname):
    if not fname: return "Untitled"
    stem = urllib.parse.unquote(fname).rsplit(".", 1)[0]
    stem = re.sub(r"[_+]+", " ", stem).strip()
    stem = re.sub(r"\s+", " ", stem)
    if (len(stem) > 42 or "$" in stem or re.search(r"\d{3,}", stem)
            or re.search(r"\d+\s*[x×]\s*\d+", stem, re.I)):
        return "Untitled"
    return (stem[:1].upper() + stem[1:]) if stem else "Untitled"

def load_manifest():
    try: return json.loads((CACHE / "manifest.json").read_text())
    except Exception: return {}
def save_manifest(m):
    CACHE.mkdir(exist_ok=True); (CACHE / "manifest.json").write_text(json.dumps(m))

def process_image(work_id, att, manifest):
    att_id, src = att.get("id"), att.get("url")
    thumb_rel, full_rel = f"img/{work_id}.webp", f"img/{work_id}_full.webp"
    tp, fp = OUT / thumb_rel, OUT / full_rel
    if manifest.get(work_id) == att_id and (CACHE / f"{work_id}.webp").exists():
        shutil.copy(CACHE / f"{work_id}.webp", tp); shutil.copy(CACHE / f"{work_id}_full.webp", fp)
        return {"thumb": thumb_rel, "full": full_rel}
    try:
        r = S.get(src, timeout=60); r.raise_for_status()
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(r.content))).convert("RGB")
        full = im.copy(); full.thumbnail((FULL_MAX, FULL_MAX), Image.LANCZOS)
        full.save(fp, "WEBP", quality=Q, method=5)
        thumb = im.copy(); thumb.thumbnail((THUMB_MAX, THUMB_MAX), Image.LANCZOS)
        thumb.save(tp, "WEBP", quality=Q, method=5)
        CACHE.mkdir(exist_ok=True)
        shutil.copy(tp, CACHE / f"{work_id}.webp"); shutil.copy(fp, CACHE / f"{work_id}_full.webp")
        manifest[work_id] = att_id
        return {"thumb": thumb_rel, "full": full_rel}
    except Exception as e:
        print(f"  ! image failed for {work_id}: {e}", file=sys.stderr); return None

def names(cell):
    if not cell: return []
    if isinstance(cell, list): return [c["name"] if isinstance(c, dict) else c for c in cell]
    return [cell["name"] if isinstance(cell, dict) else cell]
def one(cell):
    n = names(cell); return n[0] if n else None
def txt(cell):
    return cell if isinstance(cell, str) else (one(cell) or None)

def encrypt_blob(plaintext_bytes, password):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    salt, iv = os.urandom(16), os.urandom(12)
    iters = 150000
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iters)
    key = kdf.derive(password.encode())
    ct = AESGCM(key).encrypt(iv, plaintext_bytes, None)
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": iters,
            "salt": base64.b64encode(salt).decode(),
            "iv": base64.b64encode(iv).decode(),
            "ct": base64.b64encode(ct).decode()}

def main():
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()

    print("Fetching artists…")
    artists = {}
    for rec in air_list(T_ARTISTS):
        fl = rec["fields"]
        if not fl.get(F["show"]): continue
        artists[rec["id"]] = {
            "id": rec["id"],
            "name": fl.get(F["name"], "Untitled artist"),
            "location": fl.get(F["location"], ""),
            "mediums": names(fl.get(F["medium"])),
            "styles": names(fl.get(F["style"])),
            "price": one(fl.get(F["price"])),
            "confidence": one(fl.get(F["confidence"])),
            "licensing": bool(fl.get(F["licensing"])),
            "licensingPrice": fl.get(F["licensing_price"]),
            "website": fl.get(F["website"]) or None,
            "instagram": fl.get(F["instagram"]) or None,
            "email": fl.get(F["email"]) or None,
            "contactUrl": fl.get(F["contact_url"]) or None,
            "notes": txt(fl.get(F["notes"])),
            "sources": txt(fl.get(F["sources"])),
            "images": [],
        }
    print(f"  {len(artists)} artists shown on website")

    print("Fetching works + images…")
    works, n = [], 0
    for rec in air_list(T_WORKS, fields=[F["w_image"], F["w_artist"]]):
        fl = rec["fields"]
        art = fl.get(F["w_artist"]) or []
        aid = (art[0]["id"] if isinstance(art[0], dict) else art[0]) if art else None
        if aid not in artists: continue
        atts = fl.get(F["w_image"]) or []
        if not atts: continue
        img = process_image(rec["id"], atts[0], manifest)
        if not img: continue
        works.append({"id": rec["id"], "title": clean_title(atts[0].get("filename")),
                      "artistId": aid, "img": img})
        a = artists[aid]
        if len(a["images"]) < MAX_CAROUSEL: a["images"].append(img["thumb"])
        n += 1
        if n % 100 == 0: print(f"  …{n} works"); save_manifest(manifest)
    save_manifest(manifest)
    print(f"  {len(works)} works with images")

    live = {w["artistId"] for w in works}
    artist_list = [a for a in artists.values() if a["id"] in live]
    data = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "counts": {"artists": len(artist_list), "works": len(works)},
            "protected": bool(PASSWORD),
            "artists": artist_list, "works": works,
            "projects": PROJECTS_CFG}
    payload = json.dumps(data, separators=(",", ":")).encode()

    if PASSWORD:
        (OUT / "data.enc").write_text(json.dumps(encrypt_blob(payload, PASSWORD)))
        if (OUT / "data.json").exists(): (OUT / "data.json").unlink()
        print("  wrote encrypted data.enc (password-gated)")
    else:
        (OUT / "data.json").write_bytes(payload)
        if (OUT / "data.enc").exists(): (OUT / "data.enc").unlink()
        print("  wrote plaintext data.json (no password set)")

    for item in ["index.html", "assets"]:
        src, dst = pathlib.Path(item), OUT / item
        if src.is_dir(): shutil.copytree(src, dst, dirs_exist_ok=True)
        elif src.exists(): shutil.copy(src, dst)
    print(f"Done → {OUT}/  ({len(artist_list)} artists, {len(works)} works, "
          f"{'password-gated' if PASSWORD else 'public'})")

if __name__ == "__main__":
    main()
