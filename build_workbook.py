import csv
import os
import re
import zipfile
from datetime import date
from xml.sax.saxutils import escape as xml_escape


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

CTG_CSV_PATH = os.path.join(DATA_DIR, "ctg-studies.csv")
COUNTRY_REF_CSV = os.path.join(BASE_DIR, "country_reference.csv")
MOLECULE_REF_CSV = os.path.join(BASE_DIR, "molecule_reference.csv")
MOLECULE_ALIAS_CSV = os.path.join(BASE_DIR, "molecule_alias.csv")

WORKBOOK_PATH = os.path.join(BASE_DIR, "Alzheimer_Landscape.xlsx")


# ----------------------------
# Helpers for XLSX writing
# ----------------------------

def col_idx_to_name(idx: int) -> str:
    """1-based column index to Excel column name (A, B, ..., Z, AA, AB, ...)."""
    name = ""
    while idx > 0:
        idx, rem = divmod(idx - 1, 26)
        name = chr(65 + rem) + name
    return name


def make_sheet_xml(rows):
    """
    rows: list of lists of cell values (all treated as strings).
    Returns worksheet XML as a UTF-8 string.
    """
    sheet_data_parts = []
    for r_idx, row in enumerate(rows, start=1):
        cells_xml = []
        for c_idx, val in enumerate(row, start=1):
            if val is None or val == "":
                continue
            col_name = col_idx_to_name(c_idx)
            cell_ref = f"{col_name}{r_idx}"
            v = xml_escape(str(val))
            cells_xml.append(f'<c r="{cell_ref}" t="str"><v>{v}</v></c>')
        if cells_xml:
            row_xml = f'<row r="{r_idx}">' + "".join(cells_xml) + "</row>"
            sheet_data_parts.append(row_xml)
    sheet_data_xml = "".join(sheet_data_parts)
    worksheet_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        "<sheetData>"
        f"{sheet_data_xml}"
        "</sheetData>"
        "</worksheet>"
    )
    return worksheet_xml


def build_xlsx(sheets):
    """
    sheets: list of (sheet_name, rows) where rows is list-of-lists.
    Writes an .xlsx file to WORKBOOK_PATH using only standard library.
    """
    with zipfile.ZipFile(WORKBOOK_PATH, "w", zipfile.ZIP_DEFLATED) as z:
        # [Content_Types].xml
        content_types = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        ]
        for i in range(1, len(sheets) + 1):
            content_types.append(
                f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            )
        content_types.append("</Types>")
        z.writestr("[Content_Types].xml", "".join(content_types))

        # _rels/.rels
        rels_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="xl/workbook.xml"/>'
            "</Relationships>"
        )
        z.writestr("_rels/.rels", rels_xml)

        # xl/workbook.xml
        sheets_xml_parts = []
        for idx, (name, _) in enumerate(sheets, start=1):
            sheet_name = xml_escape(name)
            sheets_xml_parts.append(
                f'<sheet name="{sheet_name}" sheetId="{idx}" r:id="rId{idx}"/>'
            )
        workbook_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            "<sheets>"
            f'{"".join(sheets_xml_parts)}'
            "</sheets>"
            "</workbook>"
        )
        z.writestr("xl/workbook.xml", workbook_xml)

        # xl/_rels/workbook.xml.rels
        wb_rels_parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        ]
        for idx in range(1, len(sheets) + 1):
            wb_rels_parts.append(
                f'<Relationship Id="rId{idx}" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                f'Target="worksheets/sheet{idx}.xml"/>'
            )
        wb_rels_parts.append("</Relationships>")
        z.writestr("xl/_rels/workbook.xml.rels", "".join(wb_rels_parts))

        # Sheets
        for idx, (_, rows) in enumerate(sheets, start=1):
            sheet_xml = make_sheet_xml(rows)
            z.writestr(f"xl/worksheets/sheet{idx}.xml", sheet_xml)


# ----------------------------
# Domain helpers
# ----------------------------

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

NORDIC_COUNTRIES = {
    "Denmark",
    "Finland",
    "Iceland",
    "Norway",
    "Sweden",
}


def extract_countries_from_locations(loc_value: str) -> set:
    """
    Mirror logic from build_references.py:
    take last comma-separated token from each 'Locations' site as the country-like token.
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
        country_token = parts[-1].strip().strip('"').strip("'")
        if country_token:
            countries.add(country_token)
    return countries


def normalize_country(raw: str) -> str:
    """
    Use the same normalization rules as in build_references.py, but only
    return the canonical_country string (no review flags).
    """
    if raw is None:
        return ""
    token = raw.strip().strip('"').strip("'")
    token = re.sub(r"\s+", " ", token)
    upper = token.upper()

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
    if upper in mapping:
        return mapping[upper]

    if "(" in token and ")" in token:
        base = token.split("(", 1)[0].strip()
        if base.upper() in mapping:
            return mapping[base.upper()]
        token = base

    return token


# ----------------------------
# Sheet builders
# ----------------------------

def build_sheet_readme():
    today = date.today().isoformat()
    rows = [
        ["Alzheimer Phase I–III Landscape Workbook"],
        [],
        ["Data sources"],
        ["- ClinicalTrials.gov export: ctg-studies.csv"],
        ["- Cummings et al. 2025 + Supporting Tables S1–S3"],
        [f"- Snapshot date: {today}"],
        [],
        ["What this tool does"],
        [
            "• Provides a structured, filterable Excel view of the Alzheimer Phase I–III clinical landscape, "
            "including country coverage, molecules, and CT.gov trials."
        ],
        [
            "• Uses Cummings 2025 supporting tables as the canonical source for molecule names, phases, "
            "CADRO categories, and mechanisms of action."
        ],
        [
            "• Enriches molecules with CT.gov sponsors and geographic coverage where high-confidence links "
            "exist via NCT IDs or close intervention-name matches."
        ],
        [],
        ["What this tool does NOT do"],
        [
            "• It does not fill in missing values that are not present in Cummings tables or CT.gov "
            "(missing fields are left blank rather than guessed)."
        ],
        [
            "• It does not attempt to resolve all ambiguous country tokens or complex combination regimens "
            "beyond the explicit alias rules in LOOKUP_MOLECULE_ALIAS."
        ],
        [
            "• It does not model marketed / post-approval products yet (placeholder KPI only)."
        ],
        [],
        ["How to refresh the data"],
        ["1. Update raw inputs in the data/ folder as needed:"],
        ["   - ctg-studies.csv"],
        ["   - trc270098-sup-0002-tables1.docx (Phase 3 agents)"],
        ["   - trc270098-sup-0003-tables2.docx (Phase 2 agents)"],
        ["   - trc270098-sup-0004-tables3.docx (Phase 1 agents)"],
        [],
        ["2. From the project root, regenerate reference CSVs:"],
        ["   python build_references.py"],
        [],
        ["3. Then rebuild this Excel workbook:"],
        ["   python build_workbook.py"],
        [],
        [
            "Governance note: LOOKUP sheets are intended as read-only reference tables; edits should "
            "generally be made in the source data and regeneration scripts, not directly in Excel."
        ],
    ]
    return rows


def build_sheet_lookup_countries():
    rows = [["canonical_country", "region_priority", "is_nordic", "is_eu"]]
    with open(COUNTRY_REF_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(
                [
                    row.get("canonical_country", ""),
                    row.get("region_priority", ""),
                    row.get("is_nordic", ""),
                    row.get("is_eu", ""),
                ]
            )
    return rows


def build_sheet_lookup_molecules():
    rows = [
        [
            "canonical_molecule",
            "phase_from_cummings",
            "cadro_category",
            "mechanism_of_action",
            "lead_sponsor_from_cummings",
            "matched_ctgov_trials_count",
            "matched_sponsors_ctgov",
            "matched_countries_ctgov",
            "nordic_presence",
            "eu_presence",
        ]
    ]
    with open(MOLECULE_REF_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(
                [
                    row.get("canonical_molecule", ""),
                    row.get("phase_from_cummings", ""),
                    row.get("cadro_category", ""),
                    row.get("mechanism_of_action", ""),
                    row.get("lead_sponsor_from_cummings", ""),
                    row.get("matched_ctgov_trials_count", ""),
                    row.get("matched_sponsors_ctgov", ""),
                    row.get("matched_countries_ctgov", ""),
                    row.get("nordic_presence", ""),
                    row.get("eu_presence", ""),
                ]
            )
    return rows


def build_sheet_lookup_molecule_alias():
    rows = [
        [
            "source_intervention_name",
            "canonical_molecule",
            "match_confidence",
            "rule_or_reason",
        ]
    ]
    with open(MOLECULE_ALIAS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(
                [
                    row.get("source_intervention_name", ""),
                    row.get("canonical_molecule", ""),
                    row.get("match_confidence", ""),
                    row.get("rule_or_reason", ""),
                ]
            )
    return rows


def choose_best_alias_for_trial(interventions, alias_rows):
    """
    Select a single canonical_molecule for a trial based on its interventions and the alias table.
    Preference:
      - Highest confidence: High > Medium > Low
      - Prefer non-COMBINATION over COMBINATION
      - First encountered in that tier
    Returns canonical_molecule or "".
    """
    confidence_rank = {"High": 3, "Medium": 2, "Low": 1}
    best = None
    best_score = -1

    for inter in interventions:
        for a in alias_rows.get(inter, []):
            cm = a["canonical_molecule"]
            conf = a["match_confidence"]
            score = confidence_rank.get(conf, 0)
            if cm == "COMBINATION":
                score -= 0.1  # slight penalty vs. specific molecules
            if score > best_score:
                best_score = score
                best = cm

    return best or ""


def build_sheet_trials_master(molecule_lookup):
    """
    TRIALS_MASTER from CT.gov:
      - Keep: NCT Number, Study Title, Study Status, Phases, Sponsor, Interventions, Locations
      - Add: Countries_Normalized, canonical_molecule, nordic_presence, eu_presence
    """
    # Load alias rows into a dict keyed by source_intervention_name
    alias_by_source = {}
    with open(MOLECULE_ALIAS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            src = row.get("source_intervention_name", "")
            if not src:
                continue
            alias_by_source.setdefault(src, []).append(row)

    header = [
        "NCT Number",
        "Study Title",
        "Study Status",
        "Phases",
        "Sponsor",
        "Interventions",
        "Locations",
        "Countries_Normalized",
        "canonical_molecule",
        "nordic_presence",
        "eu_presence",
    ]
    rows = [header]

    with open(CTG_CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            nct = row.get("NCT Number", "")
            title = row.get("Study Title", "")
            status = row.get("Study Status", "")
            phases = row.get("Phases", "")
            sponsor = row.get("Sponsor", "")
            interventions_raw = row.get("Interventions", "") or ""
            locations = row.get("Locations", "") or ""

            # Countries_Normalized
            raw_countries = extract_countries_from_locations(locations)
            canonical_countries = sorted(
                {normalize_country(c) for c in raw_countries if normalize_country(c)}
            )
            countries_norm = "|".join(canonical_countries)

            # Parse interventions as in build_references
            interventions = [p.strip() for p in interventions_raw.split("|") if p.strip()]

            canonical_molecule = choose_best_alias_for_trial(interventions, alias_by_source)

            # Lookup nordic/eu flags via molecule_reference if possible
            nordic_flag = ""
            eu_flag = ""
            if canonical_molecule and canonical_molecule in molecule_lookup:
                nordic_flag = molecule_lookup[canonical_molecule].get("nordic_presence", "")
                eu_flag = molecule_lookup[canonical_molecule].get("eu_presence", "")

            rows.append(
                [
                    nct,
                    title,
                    status,
                    phases,
                    sponsor,
                    interventions_raw,
                    locations,
                    countries_norm,
                    canonical_molecule,
                    nordic_flag,
                    eu_flag,
                ]
            )

    return rows


def build_sheet_exec_overview(molecule_rows):
    """
    EXEC_OVERVIEW:
      - KPI section with labels and empty value cells (for manual formulas).
      - "Alzheimer Drug Landscape" table: one row per canonical_molecule.
    """
    # KPI labels only; values left blank for manual formulas
    rows = [
        ["KPI", "Value (fill with Excel formulas)"],
        ["Phase I agents", ""],
        ["Phase II agents", ""],
        ["Phase III agents", ""],
        ["Marketed agents", ""],
        ["Companies active in EU", ""],
        ["Companies active in Nordics", ""],
        [],
        ["Alzheimer Drug Landscape"],
    ]

    # Table header
    rows.append(
        [
            "Molecule",
            "Phase",
            "Mechanism (CADRO / MoA)",
            "Lead company",
            "EU presence",
            "Nordic presence",
            "Countries (EU only)",
        ]
    )

    for mol in molecule_rows:
        name = mol["canonical_molecule"]
        phase = mol["phase_from_cummings"]
        cadro = mol.get("cadro_category", "")
        moa = mol.get("mechanism_of_action", "")

        if cadro and moa:
            mech = f"{cadro} – {moa}"
        elif cadro:
            mech = cadro
        else:
            mech = moa

        lead_company = mol.get("lead_sponsor_from_cummings", "")

        eu_presence = "Yes" if mol.get("eu_presence", "").upper() == "TRUE" else "No"
        nordic_presence = "Yes" if mol.get("nordic_presence", "").upper() == "TRUE" else "No"

        all_countries = [c for c in (mol.get("matched_countries_ctgov") or "").split("|") if c]
        eu_only = sorted({c for c in all_countries if c in EU_COUNTRIES})
        eu_countries_str = "|".join(eu_only)

        rows.append(
            [
                name,
                phase,
                mech,
                lead_company,
                eu_presence,
                nordic_presence,
                eu_countries_str,
            ]
        )

    return rows


def build_sheet_eu_focus(molecule_rows):
    rows = [
        [
            "Molecule",
            "Phase",
            "Company",
            "EU presence",
            "Nordic presence",
        ]
    ]
    for mol in molecule_rows:
        if mol.get("eu_presence", "").upper() != "TRUE":
            continue
        name = mol["canonical_molecule"]
        phase = mol["phase_from_cummings"]
        company = mol.get("lead_sponsor_from_cummings", "")
        eu_flag = "Yes"
        nordic_flag = "Yes" if mol.get("nordic_presence", "").upper() == "TRUE" else "No"
        rows.append([name, phase, company, eu_flag, nordic_flag])
    return rows


def build_sheet_nordics(molecule_rows):
    rows = [
        [
            "Molecule",
            "Phase",
            "Company",
            "Nordic presence",
            "EU presence",
        ]
    ]
    for mol in molecule_rows:
        if mol.get("nordic_presence", "").upper() != "TRUE":
            continue
        name = mol["canonical_molecule"]
        phase = mol["phase_from_cummings"]
        company = mol.get("lead_sponsor_from_cummings", "")
        nordic_flag = "Yes"
        eu_flag = "Yes" if mol.get("eu_presence", "").upper() == "TRUE" else "No"
        rows.append([name, phase, company, nordic_flag, eu_flag])
    return rows


def build_empty_sheet(name):
    # Single header row as placeholder
    return [[name]]


def main():
    # Load molecule_reference into a list + lookup dict
    molecule_rows = []
    molecule_lookup = {}
    with open(MOLECULE_REF_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            molecule_rows.append(row)
            cm = row.get("canonical_molecule", "")
            if cm:
                molecule_lookup[cm] = row

    sheets = [
        ("README", build_sheet_readme()),
        ("LOOKUP_COUNTRIES", build_sheet_lookup_countries()),
        ("LOOKUP_MOLECULES", build_sheet_lookup_molecules()),
        ("LOOKUP_MOLECULE_ALIAS", build_sheet_lookup_molecule_alias()),
    ]

    sheets.append(("TRIALS_MASTER", build_sheet_trials_master(molecule_lookup)))
    sheets.append(("EXEC_OVERVIEW", build_sheet_exec_overview(molecule_rows)))
    sheets.append(("EU_FOCUS", build_sheet_eu_focus(molecule_rows)))
    sheets.append(("NORDICS", build_sheet_nordics(molecule_rows)))

    # Future expansion placeholders
    sheets.append(("COMPANIES", build_empty_sheet("COMPANIES")))
    sheets.append(("KEY_PEOPLE", build_empty_sheet("KEY_PEOPLE")))
    sheets.append(("CONTACTS", build_empty_sheet("CONTACTS")))

    build_xlsx(sheets)


if __name__ == "__main__":
    main()

