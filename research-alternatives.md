# Alternative Data Sources Research

## Goal
Find supplementary/verification sources for government composition data, particularly ministers.

## Available Sources

### 1. Knesset Website Direct Scraping
**URL:** https://knesset.gov.il/Plenum/Pages/gov_info.aspx
- Lists current government composition
- Shows minister names and portfolios
- May include recent appointments not yet in API
- Requires HTML parsing (Playwright)

### 2. Government of Israel Official Site
**URL:** https://www.gov.il/en/departments/government/current-government
- Official government roster
- Canonical source for minister names/portfolios
- English and Hebrew versions
- Likely more up-to-date than Knesset API

### 3. Knesset Member Directory
**URL:** https://knesset.gov.il/mk/Pages/default.aspx
- Individual MK pages show current positions
- Can be aggregated to find all current ministry holders
- Slower (requires N+1 requests) but comprehensive
- Very reliable data source

### 4. Parliamentary Minutes Archive
**URL:** https://knesset.gov.il/plenum/plenum-sessions/Pages/all_sessions.aspx
- Recent session minutes often mention current government composition
- Can extract minister info from speech introductions
- Labor-intensive but official record

## Recommended Approach

### Tier 1: Quick Win (Best ROI)
**Web Scrape: government.gov.il official roster**
- Fetch official minister list from gov.il
- Parse Hebrew names and portfolio assignments
- Use as verification against Knesset API
- Cross-reference with our database
- Flag any discrepancies

### Tier 2: Backup Validation
**Knesset Website Cross-Check**
- Scrape knesset.gov.il/Plenum/Pages/gov_info.aspx
- Extract minister table
- Compare against API and gov.il sources
- 3-way validation system

### Tier 3: Deep Audit
**MK Page Aggregation**
- Visit top 40 MK pages
- Extract "Current Positions" section
- Build minister roster from individual profiles
- Most reliable but slowest approach

## Implementation Options

### Option A: Manual Backfill (Quick)
```
1. Look up official government 37 roster
2. Identify 6 missing ministers
3. INSERT into mk_position with confirmed details
4. Mark as is_current=1
Time: 30 min
Reliability: High (manual verification)
```

### Option B: Web Scraper (Automated)
```
1. Create scraper for gov.il minister list
2. Parse HTML to extract name/portfolio mappings
3. Look up MK IDs in database
4. Backfill missing records
5. Run weekly as validation job
Time: 2-3 hours
Reliability: Medium (depends on website structure)
Maintenance: Ongoing (sites change)
```

### Option C: Hybrid Validation (Comprehensive)
```
1. Fetch from gov.il (source of truth)
2. Compare against Knesset API
3. Cross-validate with knesset.gov.il/Plenum page
4. Alert on discrepancies
5. Auto-backfill if all sources agree
Time: 4-5 hours
Reliability: Very High (triangulation)
Maintenance: Moderate
```

## Recommendation

**Start with Option A (Manual Backfill)** to immediately fix the 27→33 gap, then implement **Option C (Hybrid Validation)** as a weekly scheduled job to catch future gaps.

This gives you:
- ✅ Immediate fix to minister count
- ✅ Automated ongoing validation
- ✅ Multiple source cross-checking
- ✅ Documented audit trail

