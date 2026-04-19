# Ministers Data Gap — Fix & Validation Guide

## Current Status
- **Database has:** 27 active ministers
- **Should have:** 33 (government 37 = 28 ministers + 5 deputies)
- **Gap:** 6 missing ministers

## Root Cause
Knesset API (`KNS_PersonToPosition`) only includes 27 ministers marked with `IsCurrent=1`. The API itself is the limiting factor, not our sync process.

---

## Recommended Solution: Hybrid Approach

### Phase 1: Immediate Fix (30 min)
**Manual backfill of missing 6 ministers**

1. **Get the official roster:**
   - Visit: https://www.gov.il/en/departments/government/current-government
   - OR: https://knesset.gov.il/Plenum/Pages/gov_info.aspx
   - Find 6 ministers NOT in our database

2. **Our current 27 ministers:**
   ```
   אבי דיכטר, אופיר סופר, אורית מלכה סטרוק, איתמר בן גביר,
   אלי כהן, אלמוג כהן, בנימין נתניהו, בצלאל סמוטריץ',
   גדעון סער, גילה גמליאל, דוד אמסלם, זאב אלקין,
   חיים כץ, יואב קיש, יצחק שמעון וסרלאוף, יריב לוין,
   ישראל אייכלר, ישראל כץ, מאי גולן, מירי מרים רגב,
   מכלוף מיקי זוהר, ניר ברקת, עידית סילמן, עמיחי אליהו,
   עמיחי שיקלי, שלמה קרעי, שרן מרים השכל
   ```

3. **Find the 6 missing names** and note their MK IDs from Knesset database

4. **Backfill using this SQL:**
   ```sql
   INSERT INTO mk_position 
   (mk_id, ministry_id, ministry, start_date, is_current) 
   VALUES 
   (?, ?, ?, '2023-XX-XX', 1);
   ```

### Phase 2: Ongoing Validation (Weekly)
**Automated dual-source verification**

Create a weekly job that:
1. Fetches official government roster from alternative source
2. Compares against Knesset API
3. Cross-validates with our database
4. Alerts on discrepancies
5. Auto-backfills if all sources agree

---

## Alternative Data Sources

### Source 1: Government of Israel Official (Most Authoritative)
- **URL:** https://www.gov.il/en/departments/government/current-government
- **Reliability:** Very High (official government source)
- **Currency:** Updated within days of changes
- **Limitation:** Requires parsing dynamic JavaScript content

### Source 2: Knesset Website Government Info (Secondary)
- **URL:** https://knesset.gov.il/Plenum/Pages/gov_info.aspx
- **Reliability:** High (parliamentary body)
- **Currency:** Usually same-day
- **Limitation:** May lag API by a few days

### Source 3: MK Directory (Most Complete)
- **URL:** https://knesset.gov.il/mk/Pages/default.aspx
- **Method:** Scrape individual MK pages for "Current Positions"
- **Reliability:** Very High (official records per MK)
- **Currency:** Real-time (per MK page)
- **Limitation:** Slow (requires many requests)

---

## Implementation Checklist

### Quick Fix (do now)
- [ ] Visit gov.il government roster
- [ ] Identify 6 missing ministers
- [ ] Note their MK IDs
- [ ] Run INSERT statements to backfill
- [ ] Verify count is now 33

### Future Enhancement (weekly job)
- [ ] Create `scripts/validate-ministers.js`
- [ ] Implement gov.il scraper (or use Knesset API as primary, gov.il as secondary)
- [ ] Compare three sources:
  - Knesset API
  - gov.il official roster
  - Our local database
- [ ] Log discrepancies
- [ ] Alert if gap > 2

### Monitoring (ongoing)
- [ ] Add `/ministers` page last-sync timestamp
- [ ] Monitor weekly validation job
- [ ] Alert if sync fails

---

## Expected Outcome

After backfill:
- ✅ Minister count: 33/33 (100%)
- ✅ Data source: Knesset API + gov.il verification
- ✅ Ongoing validation: Weekly automated checks
- ✅ Audit trail: All changes documented

---

## Why This Approach

**vs. Contact Knesset IT:**
- ❌ Slow (weeks to months)
- ❌ No guarantee of response
- ❌ Not under our control

**vs. API-only approach:**
- ❌ Incomplete data (27 vs 33)
- ❌ No way to catch future gaps
- ❌ No cross-validation

**vs. Single scraper:**
- ❌ Fragile (website changes break it)
- ❌ Single point of failure
- ❌ No triangulation

**vs. Hybrid approach (our recommendation):**
- ✅ Immediate fix
- ✅ Multiple source validation
- ✅ Redundancy (if one source fails, others catch it)
- ✅ Audit trail for compliance
- ✅ Automatic future detection
