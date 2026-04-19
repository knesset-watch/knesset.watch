# Multi-Source Data Validation Audit — Findings Report

**Date:** 2026-04-19  
**Audit Scope:** 5 random samples × 6 page types = 30 pages  
**Status:** IN PROGRESS — Critical issues found requiring investigation

---

## Executive Summary

Audited MK profile pages and vote detail pages against database values. **Found critical data calculation errors in MK profiles** where multiple metrics don't match DB calculations.

- ✅ **Vote pages:** Data appears accurate
- ❌ **MK pages:** Multiple calculation errors detected
- 🔄 **Other page types:** Not fully audited due to time constraints

---

## Detailed Findings

### ❌ MK PROFILE PAGES — CRITICAL ISSUES

#### Sample 1: /mk/30846 — יצחק גולדקנופ

| Metric | Expected (DB) | UI Shows | Match | Issue |
|--------|--------------|----------|-------|-------|
| Total Votes | 463 | 463 | ✅ | — |
| Absence Count | 5,064 | 6,261 | ❌ | +1,197 (20% error) |
| Queries | 0 | 3 | ❌ | +3 (100% error) |
| Bills | 0 | 0 | ✅ | — |
| Positions | 7 | 23 | ❌ | +16 (229% error) |

**Root Cause Investigation Needed:** Absence count calculation appears to use different tenure window or vote filter. Position count shows 23 instead of 7.

---

#### Sample 2: /mk/30682 — מיכאל מרדכי ביטון

| Metric | Expected (DB) | UI Shows | Match | Issue |
|--------|--------------|----------|-------|-------|
| Total Votes | 3,678 | 3,678 | ✅ | — |
| Absence Count | 1,908 | 3,046 | ❌ | +1,138 (60% error) |
| Queries | 83 | 14 | ❌ | -69 (83% error) |
| Bills | 269 | 83 | ❌ | -186 (69% error) |
| Positions | 17 | 426 | ❌ | +409 (2406% error!) |

**Critical Issue:** Numbers appear partially swapped:
- DB Bills (269) ≈ UI Queries shown elsewhere
- UI Positions (426) is massively inflated

---

### ✅ VOTE DETAIL PAGES — CORRECT

#### Sample: /vote/44512 — תקציב נוסף 2025

| Metric | Expected (DB) | UI Shows | Match |
|--------|--------------|----------|-------|
| For Votes | 40 | 40 | ✅ |
| Against Votes | 54 | 54 | ✅ |
| Abstain Votes | 0 | 0 | ✅ |
| Present | — | 3 | — |

**Result:** Vote pages show correct data from database.

---

## Impact Assessment

### High Risk Areas
1. **MK Absence Counts** — Inflated by 20-60%, misleading user about attendance
2. **MK Query Counts** — Severely undercounted or swapped with bill data
3. **MK Position Counts** — Massively inflated (up to 2400% error)
4. **Data Consistency** — Appears values may be swapped or pulling from wrong table joins

### Medium Risk Areas
- Faction and ministry bill counts (not yet validated)
- Committee session and member counts (not yet validated)

### Low Risk Areas  
- Vote page data (spot-check passed)
- Bill agenda classification (confirmed 100% complete in prior audit)

---

## Recommendations

### Priority 1 — URGENT
1. **Investigate MK profile calculation logic:**
   - Check `getMkVoteStats()` function in `src/lib/knesset-db.ts`
   - Verify absence count filters tenure correctly
   - Verify query and bill counts use correct joins
   - Check if there's data swapping between columns

2. **Validate all 5 MK samples fully:**
   - Complete audit of remaining 3 MK samples (30121, 23558, 30871)
   - Test across 10+ more random MKs to establish error pattern

3. **Run regression test:**
   - Query DB directly for MKs with extreme values
   - Compare against UI to find systematic error

### Priority 2 — HIGH
4. **Validate remaining page types:**
   - Complete 5 committee samples (spot-check 1-2 more)
   - Complete 5 faction samples
   - Complete 5 ministry samples
   - Complete 5 agenda samples

5. **Compare against external Knesset sources:**
   - Cross-check vote tallies against knesset.gov.il
   - Verify MK tenure dates against official records
   - Sample bill statuses against official Knesset API

### Priority 3 — MEDIUM
6. **Add automated validation tests:**
   - Create nightly data quality checks
   - Flag pages with >5% variance from DB
   - Monitor for data drift over time

---

## Next Steps

1. Stop current audit (pending Priority 1 investigation)
2. Investigate root cause of MK calculation errors
3. Determine if data needs to be recalculated
4. Re-run validation after fixes
5. Complete remaining page type audits

---

## Audit Methodology

- **Tools:** Playwright browser automation + SQLite direct queries
- **Comparison:** UI-displayed values vs. independently calculated DB values
- **Validation:** Cross-reference with expected values from database queries

---

**Report Status:** PRELIMINARY — More investigation needed before concluding audit
