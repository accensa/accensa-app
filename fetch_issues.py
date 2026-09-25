import urllib.request
import json

issues = [411, 412, 413, 414]
with open('issues.md', 'w') as f:
    for i in issues:
        url = f'https://api.github.com/repos/accensa/accensa-app/issues/{i}'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            data = json.loads(urllib.request.urlopen(req).read().decode())
            f.write(f'# Issue {i}\n## {data.get("title")}\n{data.get("body")}\n\n' + ('-' * 40) + '\n\n')
        except Exception as e:
            f.write(f'Failed to fetch {i}: {e}\n\n')
