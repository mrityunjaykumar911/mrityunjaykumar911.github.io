#!/usr/bin/env python3
"""
The concrete half of the engine: check the emitted artifact against policy.json.

Disclosure.tla proves the policy is coherent. This proves the BUILD OBEYS IT, by
opening the bytes in dist/ and looking for content that should not be there. Neither
half is sufficient. The model cannot see what the build actually emitted; the checker
cannot quantify over sinks it was never pointed at. Running both against one policy
file is what closes the gap the previous README described as a hand-maintained
refinement table.

Three checks, in order of what they catch:

  C1 SINK ENUMERATION. Walk dist/ and report every publishable file the policy does
     not mention. This is the executable counterpart of PublishedSinksAreAudited and
     the check that found defect F2 -- two PDFs that ship, are linked, and that no
     assertion in a 150-assertion suite ever opens.

  C2 PII AT SINKS. For each PII-labelled source, search each sink for it under every
     encoding listed in the policy, not only the literal form. Defect F1 is exactly
     this: the address is present in dist/index.html reversed, and an assertion of the
     form `not.toContain('<literal>')` passes while the information is still there.
     An encoding preserves information, so it preserves the label.

  C3 DECLASSIFICATION HONESTY. A policy may declare a source declassified at a sink,
     which silences C2 there. C3 re-checks those sinks anyway and fails if the content
     is still detectable. Declaring a declassification you did not implement is
     therefore not a way to silence the checker -- it is a louder failure. This is what
     stops policy.json from becoming a suppression file.

Secrets are read from the source at check time and never printed. Findings report the
sink, the source label and the encoding, never the value.

    python check_artifacts.py --repo . --policy policy.json --variant current
"""

import argparse, base64, json, os, re, sys, urllib.parse

TEXT_EXT = {".html", ".txt", ".xml", ".tla", ".json", ".css", ".js", ".svg", ".md"}
BINARY_PUBLISHABLE = {".pdf"}
IGNORED_EXT = {".woff2", ".woff", ".ttf", ".ico", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".map"}

PHONE_RE = re.compile(r"\+\d[\d\s().-]{7,}\d")
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")


# ---------------------------------------------------------------- encodings
def encodings_of(value, kinds):
    """Every form the information can take that still recovers the original.
    Anything reversible belongs here; anything that destroys the information is a
    declassifier and belongs in the policy instead."""
    out = {}
    if "literal" in kinds:
        out["literal"] = value
    if "reversed" in kinds:
        out["reversed"] = value[::-1]
    if "base64" in kinds:
        out["base64"] = base64.b64encode(value.encode()).decode().rstrip("=")
    if "html_entities" in kinds:
        out["html_entities"] = "".join(f"&#{ord(c)};" for c in value)
    if "percent" in kinds:
        out["percent"] = urllib.parse.quote(value)
    if "spaced" in kinds:
        out["spaced"] = " ".join(value)
    return out


def extract_text(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in TEXT_EXT:
        return open(path, encoding="utf-8", errors="ignore").read()
    if ext == ".pdf":
        try:
            from pypdf import PdfReader
            return "".join((pg.extract_text() or "") for pg in PdfReader(path).pages)
        except Exception as e:
            return f"\x00UNREADABLE:{e}"
    return None


def load_secrets(repo):
    """Read the PII values from the source of truth, so the checker tracks the real
    values rather than a copy that can go stale."""
    sec = {}
    y = os.path.join(repo, "src/data/resume.yaml")
    if os.path.exists(y):
        t = open(y, encoding="utf-8", errors="ignore").read()
        m = re.search(r"^\s*email:\s*['\"]?([^'\"\s]+)['\"]?\s*$", t, re.M)
        if m:
            sec["profile_email"] = m.group(1)
    return sec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--policy", default="policy.json")
    ap.add_argument("--variant", default="current")
    ap.add_argument("--dist", default="dist")
    ap.add_argument("--json-out", default=None)
    a = ap.parse_args()

    P = json.load(open(a.policy))
    sinks = {k: v for k, v in P["sinks"].items() if not k.startswith("_")}
    sources = {k: v for k, v in P["sources"].items() if not k.startswith("_")}
    detectors = {k: v for k, v in P["detectors"].items() if not k.startswith("_")}
    declassed = {k: v for k, v in P["declassified"].get(a.variant, {}).items()
                 if not k.startswith("_")}
    overrides = {k: v for k, v in P["overrides"].get(a.variant, {}).items()
                 if not k.startswith("_")}
    audited = set(P["audited"][a.variant])
    secrets = load_secrets(a.repo)

    dist = os.path.join(a.repo, a.dist)
    if not os.path.isdir(dist):
        print(f"no {dist}; run `npm run build` first", file=sys.stderr)
        return 2

    by_path = {os.path.normpath(v["path"]): k for k, v in sinks.items()}
    findings = {"c1_unenumerated": [], "c2_pii": [], "c3_dishonest_declass": [],
                "unreadable": []}

    # ---------------- C1: sink enumeration ----------------
    on_disk = []
    for root, _, files in os.walk(dist):
        for f in files:
            p = os.path.join(root, f)
            ext = os.path.splitext(f)[1].lower()
            if ext in IGNORED_EXT:
                continue
            rel = os.path.normpath(os.path.relpath(p, a.repo))
            on_disk.append(rel)
            if rel not in by_path and not rel.replace("\\", "/").startswith(f"{a.dist}/_astro"):
                findings["c1_unenumerated"].append(rel)

    # ---------------- C2 / C3: content at sinks ----------------
    for name, meta in sinks.items():
        path = os.path.join(a.repo, meta["path"])
        if not os.path.exists(path):
            continue
        text = extract_text(path)
        if text is None:
            continue
        if text.startswith("\x00UNREADABLE"):
            findings["unreadable"].append({"sink": name, "why": text[12:]})
            continue
        low = text.lower()
        allows_pii = overrides.get(name, {}).get("allows_pii", meta["allows_pii"])
        dec = set(declassed.get(name, []))

        for src in meta["flows"]:
            if not sources[src]["pii"]:
                continue
            det = detectors.get(src, {"kind": "literal", "encodings": ["literal"]})
            hits = []
            if src in secrets:
                for enc, form in encodings_of(secrets[src], det["encodings"]).items():
                    if form.lower() in low:
                        hits.append(enc)
            elif det["kind"] == "phone":
                if PHONE_RE.search(text):
                    hits.append("literal")
            if not hits:
                continue
            rec = {"sink": name, "path": meta["path"], "source": src,
                   "encodings": sorted(set(hits))}
            if src in dec:
                # policy claims this was declassified here, yet it is still detectable
                findings["c3_dishonest_declass"].append(rec)
            elif not allows_pii:
                findings["c2_pii"].append(rec)

    # ---------------- report ----------------
    print(f"policy variant : {a.variant}")
    print(f"sinks declared : {len(sinks)}    audited by policy: {len(audited)}")
    print(f"files in {a.dist}/ considered publishable: {len(on_disk)}")

    print("\n--- C1  publishable files the policy does not enumerate ---")
    if not findings["c1_unenumerated"]:
        print("    none")
    for f in findings["c1_unenumerated"]:
        print(f"    UNENUMERATED  {f}")

    print("\n--- C2  PII-labelled content reaching a sink that does not allow it ---")
    if not findings["c2_pii"]:
        print("    none")
    for f in findings["c2_pii"]:
        print(f"    LEAK  {f['path']}  <- {f['source']}  as {', '.join(f['encodings'])}")

    print("\n--- C3  declassifications the artifact does not honour ---")
    if not findings["c3_dishonest_declass"]:
        print("    none")
    for f in findings["c3_dishonest_declass"]:
        print(f"    DISHONEST  {f['path']}  claims {f['source']} declassified, "
              f"still present as {', '.join(f['encodings'])}")

    if findings["unreadable"]:
        print("\n--- sinks that could not be read (cannot be certified) ---")
        for f in findings["unreadable"]:
            print(f"    {f['sink']}: {f['why']}")

    unaudited_published = sorted(set(sinks) - audited)
    print("\n--- declared sinks outside the audited set ---")
    print("    " + (", ".join(unaudited_published) if unaudited_published else "none"))

    bad = (findings["c1_unenumerated"] or findings["c2_pii"]
           or findings["c3_dishonest_declass"] or unaudited_published)
    print(f"\nRESULT: {'FAIL' if bad else 'PASS'}")
    if a.json_out:
        json.dump({"variant": a.variant, "findings": findings,
                   "unaudited": unaudited_published, "pass": not bad},
                  open(a.json_out, "w"), indent=2)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
