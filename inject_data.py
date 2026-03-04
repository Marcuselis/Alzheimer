import json
import os

# Paths
source_json = '../Alzheimer_v2/data/generated/trials.json'
target_html = './Analyst_Workstation_v3.html'

if not os.path.exists(source_json):
    print(f"Source JSON not found at {source_json}")
    exit(1)

with open(source_json, 'r') as f:
    data = json.load(f)

# Minify data for HTML
json_data = json.dumps(data)

with open(target_html, 'r') as f:
    html = f.read()

# Replace placeholder
html = html.replace('REPLACE_ME_WITH_JSON', json_data)

with open(target_html, 'w') as f:
    f.write(html)

print("Successfully injected data into Analyst_Workstation_v3.html")
# Cleanup script itself after use
os.remove(__file__)
