import json
import os

data_path = 'data/generated/trials.json'
html_path = '../v_3/Analyst_Workstation_v3.html'

if not os.path.exists(data_path):
    print(f"Error: {data_path} not found")
    exit(1)

with open(data_path, 'r') as f:
    data = json.load(f)

with open(html_path, 'r') as f:
    lines = f.readlines()

found = False
for i, line in enumerate(lines):
    if 'const TRIALS =' in line:
        lines[i] = '        const TRIALS = ' + json.dumps(data) + ';\n'
        found = True
        break

if not found:
    print("Error: 'const TRIALS =' not found in HTML")
    exit(1)

with open(html_path, 'w') as f:
    f.writelines(lines)

print("Successfully injected trials data.")
