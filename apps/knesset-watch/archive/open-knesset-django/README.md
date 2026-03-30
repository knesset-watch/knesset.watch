# Open Knesset Archive

Historical work from the Open Knesset project. Reference for the active OK26 app at `apps/ok26/`.

## Folders

### `Open-Knesset/`
The original Open Knesset Django project (Python 2, Knessets ~16–22, ~2009–2015).

**Most useful for reference:**
- `agendas/models.py` — the Agenda model: named policy positions (e.g. "LGBTQ rights") linked to specific votes with a score (-1 to +1, how much the vote aligns with the position) and an importance weight. This is the concept to modernize in OK26.
- `data/votes.tsv.gz` — 9,616 vote titles from older Knessets
- `data/results.tsv.gz` — 366,756 individual MK vote results (vote_id, MK name, party, for/against/abstain)
- `data/members.tsv.gz` — 840 MK profiles
- `tagvotes/` — user tagging of votes/bills with free-form tags

**Not directly reusable:** The data covers K16–K22 only. No K25 data.

### `ok-templates/`
Old Mustache template renderer with a Python dev server. Used to prototype the old UI. Not relevant to current Next.js work.

### `ok-webfront/`
Old Node.js/CoffeeScript web frontend. Different architecture, not relevant.

## Files

### `RESEARCH.md`
Research notes on modernizing Open Knesset — the "MK 360" vision, network graphs, OData entities to use, etc.
