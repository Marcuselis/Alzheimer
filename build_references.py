import csv
import os
import re
import zipfile
from collections import defaultdict
from xml.etree import ElementTree as ET


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

CTG_CSV_PATH = os.path.join(DATA_DIR, "ctg-studies.csv")
DOCX_FILES = [
    (os.path.join(DATA_DIR, "trc270098-sup-0002-tables1.docx"), "Phase 3"),
    (os.path.join(DATA_DIR, "trc270098-sup-0003-tables2.docx"), "Phase 2"),
    (os.path.join(DATA_DIR, "trc270098-sup-0004-tables3.docx"), "Phase 1"),
]

COUNTRY_REF_CSV = os.path.join(BASE_DIR, "country_reference.csv")
MOLECULE_REF_CSV = os.path.join(BASE_DIR, "molecule_reference.csv")
MOLECULE_ALIAS_CSV = os.path.join(BASE_DIR, "molecule_alias.csv")


# ----------------------------
# Country normalization helpers
# ----------------------------

NORDIC_COUNTRIES = {
    "Denmark",
    "Finland",
    "Iceland",
    "Norway",
    "Sweden",
}

EU_COUNTRIES = {
    "Austria",
    "Belgium",
    "Bulgaria",
    "Croatia",
    "Cyprus",
    "Czechia",
    "Denmark",
    "Estonia",
    "Finland",
    "France",
    "Germany",
    "Greece",
    "Hungary",
    "Ireland",
    "Italy",
    "Latvia",
    "Lithuania",
    "Luxembourg",
    "Malta",
    "Netherlands",
    "Poland",
    "Portugal",
    "Romania",
    "Slovakia",
    "Slovenia",
    "Spain",
    "Sweden",
}


def clean_token(s: str) -> str:
    if s is None:
        return ""
    s = s.strip().strip('"').strip("'")
    # Remove trailing punctuation artifacts
    s = re.sub(r"\s+", " ", s)
    return s


def extract_countries_from_locations(loc_value: str) -> set:
    """
    CT.gov 'Locations' column appears as:
    "Site 1, City, State, ZIP, Country|Site 2, City, State, ZIP, Country"
    We take the last comma-separated token from each site as the country-like token.
    """
    countries = set()
    if not loc_value:
        return countries
    for site in loc_value.split("|"):
        site = site.strip()
        if not site:
            continue
        parts = [p.strip() for p in site.split(",") if p.strip()]
        if not parts:
            continue
        country_token = clean_token(parts[-1])
        if country_token:
            countries.add(country_token)
    return countries


def normalize_country(raw: str):
    """
    Normalize raw country-like token to canonical English country.
    Returns (canonical_country, needs_review (bool), note (str)).
    """
    token = clean_token(raw)
    upper = token.upper()

    # Common CT.gov / export variants
    mapping = {
        "UNITED STATES": "United States",
        "USA": "United States",
        "U.S.A.": "United States",
        "U.S.": "United States",
        "US": "United States",
        "RUSSIAN FEDERATION": "Russia",
        "RUSSIA": "Russia",
        "KOREA, REPUBLIC OF": "South Korea",
        "REPUBLIC OF KOREA": "South Korea",
        "SOUTH KOREA": "South Korea",
        "KOREA, SOUTH": "South Korea",
        "CZECH REPUBLIC": "Czechia",
        "CZECHIA": "Czechia",
        "TAIWAN, CHINA": "Taiwan",
        "TAIWAN (CHINA)": "Taiwan",
        "TURKEY (TÜRKIYE)": "Turkey",
        "TURKEY (TÜRKİYE)": "Turkey",
        "U.K.": "United Kingdom",
        "UK": "United Kingdom",
    }

    key = upper
    if key in mapping:
        return mapping[key], False, ""

    # Strip parenthetical like "Turkey (Türkiye)"
    if "(" in token and ")" in token:
        base = token.split("(", 1)[0].strip()
        if base.upper() in mapping:
            return mapping[base.upper()], False, ""
        token_no_paren = base
    else:
        token_no_paren = token

    # Known canonical names (including non-EU/non-Nordic)
    known = {
        # Nordics
        "Denmark",
        "Finland",
        "Iceland",
        "Norway",
        "Sweden",
        # EU (ensure canonical spellings)
        "Austria",
        "Belgium",
        "Bulgaria",
        "Croatia",
        "Cyprus",
        "Czechia",
        "Estonia",
        "France",
        "Germany",
        "Greece",
        "Hungary",
        "Ireland",
        "Italy",
        "Latvia",
        "Lithuania",
        "Luxembourg",
        "Malta",
        "Netherlands",
        "Poland",
        "Portugal",
        "Romania",
        "Slovakia",
        "Slovenia",
        "Spain",
        # Others commonly appearing in CT.gov locations
        "Argentina",
        "Australia",
        "Brazil",
        "Canada",
        "Chile",
        "China",
        "Colombia",
        "Hong Kong",
        "India",
        "Iran",
        "Israel",
        "Japan",
        "Mexico",
        "Netherlands",
        "New Zealand",
        "Puerto Rico",
        "Serbia",
        "Singapore",
        "South Africa",
        "South Korea",
        "Switzerland",
        "Taiwan",
        "Turkey",
        "Ukraine",
        "United Kingdom",
        "United States",
    }

    if token_no_paren in known:
        return token_no_paren, False, ""

    # Ambiguous "Korea" token
    if token_no_paren.upper() == "KOREA":
        return token_no_paren, True, "Ambiguous 'Korea' token (could be North or South Korea)"

    # Anything else: treat as-is but flag for review
    return token_no_paren, True, f"Unrecognized or potentially non-country location token: '{raw}'"


def build_country_reference():
    countries_raw = set()

    with open(CTG_CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            locs = row.get("Locations") or ""
            countries_raw.update(extract_countries_from_locations(locs))

    per_canonical = {}
    for raw in sorted(countries_raw):
        canonical, needs_review, note = normalize_country(raw)
        if canonical not in per_canonical:
            per_canonical[canonical] = {
                "canonical_country": canonical,
                "needs_review": needs_review,
                "note": note,
            }
        else:
            # Aggregate review status and notes across all raw variants
            existing = per_canonical[canonical]
            existing["needs_review"] = existing["needs_review"] or needs_review
            if note and note not in existing["note"]:
                existing["note"] = (existing["note"] + " | " if existing["note"] else "") + note

    # Add region tags
    rows = []
    for canonical, info in per_canonical.items():
        is_nordic = canonical in NORDIC_COUNTRIES
        is_eu = canonical in EU_COUNTRIES
        if is_nordic:
            region = "Nordic"
        elif is_eu:
            region = "EU"
        else:
            region = "Other"
        rows.append(
            {
                "canonical_country": canonical,
                "region_priority": region,
                "is_nordic": "TRUE" if is_nordic else "FALSE",
                "is_eu": "TRUE" if is_eu else "FALSE",
                "needs_review": "TRUE" if info["needs_review"] else "FALSE",
                "note": info["note"],
            }
        )

    # Sort: Nordics, then EU, then Others; alphabetical within each
    priority_order = {"Nordic": 0, "EU": 1, "Other": 2}
    rows.sort(key=lambda r: (priority_order.get(r["region_priority"], 3), r["canonical_country"]))

    fieldnames = [
        "canonical_country",
        "region_priority",
        "is_nordic",
        "is_eu",
        "needs_review",
        "note",
    ]
    with open(COUNTRY_REF_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


# ----------------------------
# DOCX table parsing
# ----------------------------

def parse_docx_tables(docx_path):
    """
    Very lightweight DOCX table parser using zipfile + ElementTree.
    Returns a list of tables, where each table is a list of rows,
    and each row is a list of cell text strings.
    """
    tables = []
    with zipfile.ZipFile(docx_path) as z:
        with z.open("word/document.xml") as doc_xml:
            tree = ET.parse(doc_xml)
    root = tree.getroot()
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

    for tbl in root.findall(".//w:tbl", ns):
        parsed_table = []
        for tr in tbl.findall("w:tr", ns):
            row_cells = []
            for tc in tr.findall("w:tc", ns):
                texts = [t.text for t in tc.findall(".//w:t", ns) if t.text]
                cell_text = "".join(texts).strip()
                row_cells.append(cell_text)
            # Skip completely empty rows
            if any(c.strip() for c in row_cells):
                parsed_table.append(row_cells)
        if parsed_table:
            tables.append(parsed_table)
    return tables


def find_column_index(headers, keywords):
    """
    Find first column index whose header contains any of the keywords (case-insensitive).
    """
    if not headers:
        return None
    headers_lower = [h.lower() for h in headers]
    for kw in keywords:
        for idx, h in enumerate(headers_lower):
            if kw in h:
                return idx
    return None


def extract_molecules_from_docx(docx_path, phase_label):
    """
    Extract molecules and associated metadata from a supporting DOCX table.
    We assume the first non-empty table in the document is the main data table.
    """
    tables = parse_docx_tables(docx_path)
    if not tables:
        return []

    table = tables[0]
    if not table:
        return []

    headers = table[0]

    idx_agent = find_column_index(headers, ["agent", "drug", "compound", "intervention"])
    idx_cadro = find_column_index(headers, ["cadro"])
    idx_moa = find_column_index(headers, ["mechanism"])
    idx_nct = find_column_index(headers, ["nct"])
    idx_sponsor = find_column_index(headers, ["sponsor"])

    molecules = []
    for row in table[1:]:
        # pad row length to headers length
        if len(row) < len(headers):
            row = row + [""] * (len(headers) - len(row))

        name = row[idx_agent].strip() if idx_agent is not None and idx_agent < len(row) else ""
        if not name:
            continue

        # Clean canonical molecule name: preserve text but normalize whitespace
        canonical_molecule = re.sub(r"\s+", " ", name).strip()

        cadro = row[idx_cadro].strip() if idx_cadro is not None and idx_cadro < len(row) else ""
        moa = row[idx_moa].strip() if idx_moa is not None and idx_moa < len(row) else ""
        nct_raw = row[idx_nct].strip() if idx_nct is not None and idx_nct < len(row) else ""
        sponsor = row[idx_sponsor].strip() if idx_sponsor is not None and idx_sponsor < len(row) else ""

        # Extract NCT IDs
        nct_ids = []
        if nct_raw:
            for token in re.split(r"[\s,;|/]+", nct_raw):
                token = token.strip()
                if re.fullmatch(r"NCT\d{8}", token):
                    nct_ids.append(token)

        molecules.append(
            {
                "canonical_molecule": canonical_molecule,
                "phase_from_cummings": phase_label,
                "cadro_category": cadro,
                "mechanism_of_action": moa,
                "nct_ids": "|".join(sorted(set(nct_ids))) if nct_ids else "",
                "lead_sponsor_from_cummings": sponsor,
            }
        )

    return molecules


# ----------------------------
# CT.gov linking & aliases
# ----------------------------

def normalize_intervention_name(name: str) -> str:
    """
    Normalize intervention name for comparison:
    - lower-case
    - strip leading intervention type prefixes (DRUG:, BIOLOGICAL:, etc.)
    - remove parentheses contents (formulations)
    - remove common dosage / route descriptors
    """
    if not name:
        return ""
    # strip prefix like "DRUG: "
    if ":" in name:
        parts = name.split(":", 1)
        if parts[0].strip().isupper():
            name = parts[1]
    name = name.strip()
    # remove parentheses content (e.g., "(subcutaneous)")
    name = re.sub(r"\([^)]*\)", "", name)
    # remove dosage (very simple)
    name = re.sub(r"\b\d+(\.\d+)?\s*(mg/kg|mg|mcg|ug|µg|g)\b", "", name, flags=re.IGNORECASE)
    # remove multiple spaces, punctuation artifacts
    name = re.sub(r"[®™]", "", name)
    name = re.sub(r"\s+", " ", name)
    return name.strip().lower()


def is_combination_name(name: str) -> bool:
    if not name:
        return False
    # crude check for combos
    return "+" in name or re.search(r"\band\b", name, flags=re.IGNORECASE) is not None


def similarity(a: str, b: str) -> float:
    # very lightweight similarity: based on token overlap
    ta = set(a.split())
    tb = set(b.split())
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union if union else 0.0


def build_molecule_and_alias_references():
    # ---- Load CT.gov trials ----
    with open(CTG_CSV_PATH, newline="", encoding="utf-8") as f:
        ctg_reader = list(csv.DictReader(f))

    # Map NCT -> trial row
    trials_by_nct = {}
    for row in ctg_reader:
        nct = (row.get("NCT Number") or "").strip()
        if nct:
            trials_by_nct[nct] = row

    # Precompute interventions per trial and a master list of unique intervention tokens
    all_intervention_tokens = set()
    interventions_by_nct = {}

    for row in ctg_reader:
        nct = (row.get("NCT Number") or "").strip()
        inter_raw = row.get("Interventions") or ""
        tokens = []
        for part in inter_raw.split("|"):
            part = part.strip()
            if not part:
                continue
            tokens.append(part)
            all_intervention_tokens.add(part)
        if nct:
            interventions_by_nct[nct] = tokens

    # ---- Load molecules from Cummings tables ----
    molecules = []
    for docx_path, phase_label in DOCX_FILES:
        if not os.path.exists(docx_path):
            continue
        molecules.extend(extract_molecules_from_docx(docx_path, phase_label))

    # Index: canonical_molecule -> row dict
    # (Assume names are unique; if duplicates occur they will be appended separately.)

    # ---- Prepare linking structures ----
    # For each molecule index, store matched NCTs, sponsors, countries
    matched_trials_for_molecule = defaultdict(set)  # canonical_molecule -> set of NCTs
    matched_sponsors_for_molecule = defaultdict(set)
    matched_countries_for_molecule = defaultdict(set)

    alias_rows = []

    # Country cache: reuse same parser & canonicalization as country_reference
    with open(CTG_CSV_PATH, newline="", encoding="utf-8") as f:
        ctg_reader_for_country = list(csv.DictReader(f))

    ctg_trials_for_country = {row.get("NCT Number", "").strip(): row for row in ctg_reader_for_country}

    def add_countries_from_trial(nct_number: str, target_set: set):
        row = ctg_trials_for_country.get(nct_number)
        if not row:
            return
        locs = row.get("Locations") or ""
        raw_countries = extract_countries_from_locations(locs)
        for rc in raw_countries:
            canonical, _, _ = normalize_country(rc)
            if canonical:
                target_set.add(canonical)

    # ---- Step 1: NCT-based linking and high-confidence aliases ----
    for mol in molecules:
        canonical_molecule = mol["canonical_molecule"]
        nct_ids = [n for n in (mol.get("nct_ids") or "").split("|") if n]
        for nct in nct_ids:
            trial = trials_by_nct.get(nct)
            if not trial:
                continue
            matched_trials_for_molecule[canonical_molecule].add(nct)

            sponsor = (trial.get("Sponsor") or "").strip()
            if sponsor:
                matched_sponsors_for_molecule[canonical_molecule].add(sponsor)
            collab = (trial.get("Collaborators") or "").strip()
            if collab:
                for c in collab.split("|"):
                    c = c.strip()
                    if c:
                        matched_sponsors_for_molecule[canonical_molecule].add(c)

            add_countries_from_trial(nct, matched_countries_for_molecule[canonical_molecule])

            # Aliases from intervention names in this NCT (high confidence only when closely matching)
            for inter in interventions_by_nct.get(nct, []):
                base_name = inter.strip()
                norm_inter = normalize_intervention_name(base_name)

                if is_combination_name(base_name):
                    alias_rows.append(
                        {
                            "source_intervention_name": base_name,
                            "canonical_molecule": "COMBINATION",
                            "match_confidence": "Low",
                            "rule_or_reason": "CT.gov combination intervention (contains '+' or 'and')",
                        }
                    )
                    continue

                norm_mol = normalize_intervention_name(canonical_molecule)
                if norm_inter and norm_inter == norm_mol:
                    alias_rows.append(
                        {
                            "source_intervention_name": base_name,
                            "canonical_molecule": canonical_molecule,
                            "match_confidence": "High",
                            "rule_or_reason": "Exact normalized name match via NCT linkage",
                        }
                    )

    # ---- Step 2: Fuzzy name-based linking for molecules without NCT IDs ----
    # Build a pre-normalized map of intervention tokens
    normalized_interventions = []
    for token in all_intervention_tokens:
        base_name = token.strip()
        if is_combination_name(base_name):
            # record combination aliases but don't use for molecule mapping
            alias_rows.append(
                {
                    "source_intervention_name": base_name,
                    "canonical_molecule": "COMBINATION",
                    "match_confidence": "Low",
                    "rule_or_reason": "CT.gov combination intervention (contains '+' or 'and')",
                }
            )
            continue
        norm = normalize_intervention_name(base_name)
        if not norm:
            continue
        normalized_interventions.append((token, norm))

    for mol in molecules:
        canonical_molecule = mol["canonical_molecule"]
        if matched_trials_for_molecule.get(canonical_molecule):
            # Already linked via NCT IDs; do not override with fuzzy matching
            continue

        nct_ids = [n for n in (mol.get("nct_ids") or "").split("|") if n]
        if nct_ids:
            # Has NCT IDs but they did not match ctg-studies; skip fuzzy to avoid overreach
            continue

        norm_mol = normalize_intervention_name(canonical_molecule)
        if not norm_mol:
            continue

        # Search for similar intervention names
        for source_name, norm_src in normalized_interventions:
            sim = similarity(norm_mol, norm_src)
            if sim >= 0.95:
                confidence = "High"
            elif sim >= 0.85:
                confidence = "Medium"
            elif sim >= 0.7:
                confidence = "Low"
            else:
                continue

            alias_rows.append(
                {
                    "source_intervention_name": source_name,
                    "canonical_molecule": canonical_molecule,
                    "match_confidence": confidence,
                    "rule_or_reason": f"Fuzzy normalized name match (similarity={sim:.2f})",
                }
            )

            # Only use high-confidence matches to populate molecule_reference linkage
            if confidence == "High":
                # Find all NCT trials that contain this intervention token
                for row in ctg_reader:
                    if source_name in (row.get("Interventions") or ""):
                        nct = (row.get("NCT Number") or "").strip()
                        if not nct:
                            continue
                        matched_trials_for_molecule[canonical_molecule].add(nct)

                        sponsor = (row.get("Sponsor") or "").strip()
                        if sponsor:
                            matched_sponsors_for_molecule[canonical_molecule].add(sponsor)
                        collab = (row.get("Collaborators") or "").strip()
                        if collab:
                            for c in collab.split("|"):
                                c = c.strip()
                                if c:
                                    matched_sponsors_for_molecule[canonical_molecule].add(c)

                        add_countries_from_trial(nct, matched_countries_for_molecule[canonical_molecule])

    # ---- Build molecule_reference.csv rows ----
    molecule_rows = []
    for mol in molecules:
        canonical_molecule = mol["canonical_molecule"]
        matched_ncts = sorted(matched_trials_for_molecule.get(canonical_molecule, set()))
        matched_sponsors = sorted(matched_sponsors_for_molecule.get(canonical_molecule, set()))
        matched_countries = sorted(matched_countries_for_molecule.get(canonical_molecule, set()))

        nordic_presence = any(c in NORDIC_COUNTRIES for c in matched_countries)
        eu_presence = any(c in EU_COUNTRIES for c in matched_countries)

        molecule_rows.append(
            {
                "canonical_molecule": canonical_molecule,
                "phase_from_cummings": mol["phase_from_cummings"],
                "cadro_category": mol.get("cadro_category", ""),
                "mechanism_of_action": mol.get("mechanism_of_action", ""),
                "nct_ids": mol.get("nct_ids", ""),
                "lead_sponsor_from_cummings": mol.get("lead_sponsor_from_cummings", ""),
                "matched_ctgov_trials_count": str(len(matched_ncts)),
                "matched_sponsors_ctgov": "|".join(matched_sponsors),
                "matched_countries_ctgov": "|".join(matched_countries),
                "nordic_presence": "TRUE" if nordic_presence else "FALSE",
                "eu_presence": "TRUE" if eu_presence else "FALSE",
            }
        )

    # Sort molecules by phase then name for readability
    phase_order = {"Phase 3": 0, "Phase 2": 1, "Phase 1": 2}
    molecule_rows.sort(key=lambda r: (phase_order.get(r["phase_from_cummings"], 3), r["canonical_molecule"].lower()))

    molecule_fieldnames = [
        "canonical_molecule",
        "phase_from_cummings",
        "cadro_category",
        "mechanism_of_action",
        "nct_ids",
        "lead_sponsor_from_cummings",
        "matched_ctgov_trials_count",
        "matched_sponsors_ctgov",
        "matched_countries_ctgov",
        "nordic_presence",
        "eu_presence",
    ]
    with open(MOLECULE_REF_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=molecule_fieldnames)
        writer.writeheader()
        writer.writerows(molecule_rows)

    # ---- Build molecule_alias.csv ----
    alias_fieldnames = [
        "source_intervention_name",
        "canonical_molecule",
        "match_confidence",
        "rule_or_reason",
    ]

    # Deduplicate alias rows
    seen_alias = set()
    deduped_alias_rows = []
    for row in alias_rows:
        key = (
            row["source_intervention_name"],
            row["canonical_molecule"],
            row["match_confidence"],
            row["rule_or_reason"],
        )
        if key in seen_alias:
            continue
        seen_alias.add(key)
        deduped_alias_rows.append(row)

    with open(MOLECULE_ALIAS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=alias_fieldnames)
        writer.writeheader()
        writer.writerows(deduped_alias_rows)


def main():
    build_country_reference()
    build_molecule_and_alias_references()


if __name__ == "__main__":
    main()

