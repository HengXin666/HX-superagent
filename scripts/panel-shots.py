#!/usr/bin/env python3
"""Stage 0 light/dark comparison, step 2: screenshot the HTML from scripts/panel-shots.dump.tsx in Chromium.

jsdom does not load the ?raw stylesheets, so this puts the panel's sheets back in the order the panel ships them
(ui/theme.css, ui/tokens.css, ui/ui.css, client.css). Dark is the host's marker, data-ds-dark-theme on <body>.
No host tokens are set, so every color is theme.css's fallback palette. Needs: pip install playwright; playwright install chromium.
Usage: python3 scripts/panel-shots.py [html dir, default .artifacts/panel-shots] [png dir, default docs]
"""
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

src = Path(sys.argv[1] if len(sys.argv) > 1 else '.artifacts/panel-shots')
out = Path(sys.argv[2] if len(sys.argv) > 2 else 'docs')
client = Path('src/client')
css = '\n'.join((client / f).read_text() for f in ['ui/theme.css', 'ui/tokens.css', 'ui/ui.css', 'client.css'])
# Full-page shots: the page region scrolls inside a fixed height in the host, so let it grow here.
css += '\nhtml, body { margin: 0; height: auto } .dt-page { height: auto !important; overflow: visible !important }'
css += '\nbody { background: var(--hx-c-bg-base); font-family: "Noto Sans CJK SC", sans-serif }'

with sync_playwright() as p:
    browser = p.chromium.launch()
    for page in ['settings', 'execution', 'console']:
        html = re.sub(r'<style>.*?</style>', '', (src / f'{page}.html').read_text(), flags=re.S)
        for mode in ['light', 'dark']:
            # Mark <body> before the sheets go in: theme.css mentions <body> in a comment.
            doc = html if mode == 'light' else html.replace('<body', '<body data-ds-dark-theme=""', 1)
            doc = doc.replace('</head>', f'<style>{css}</style></head>', 1)
            tab = browser.new_page(viewport={'width': 1440, 'height': 900}, color_scheme='light')
            tab.set_content(doc)
            tab.wait_for_timeout(300)
            tab.screenshot(path=str(out / f'stage0-{page}-{mode}.png'), full_page=True)
            tab.close()
    browser.close()
