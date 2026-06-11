# Prior Art Search Vendor Research — Korean Patent API Access & Pricing

**Date:** 2026-06-11
**Audience:** Technical founder, patent-drafting AI startup (특허 AI), KIPO-first
**Scope:** Programmatic API access, pricing, data coverage, integration notes
**Methodology:** WebSearch + WebFetch across primary vendor sites and secondary sources; all claims cited with source URL. Source language noted as KO (Korean) or EN (English). Pricing not publicly listed is flagged explicitly as "contact sales / 견적 문의."

---

## Table of Contents

1. [WIPS / WIPS ON / WIPSON](#1-wips--wips-on--wipson)
2. [KEYWERT (키워트)](#2-keywert-키워트)
3. [KIPRIS Plus (plus.kipris.or.kr)](#3-kipris-plus)
4. [Quick Reference: Other Options](#4-quick-reference-other-options)
5. [Comparison Table](#5-comparison-table)
6. [Recommendation](#6-recommendation)

---

## 1. WIPS / WIPS ON / WIPSON

### Overview

WIPS Corp. (㈜윕스, wipscorp.com) is Korea's largest private patent search and IP data company, founded 1999. It holds approximately 5,000 corporate customers and 100,000+ registered users, and is KIPO-designated as an official patent/trademark/PCT research institution. Its consumer-facing product is **WIPS ON** (wipson.com), Korea's first online patent search service launched 2001.

Product family:
- **WIPS ON** — general online search, ~100,000 users (KO, [wipson.com](https://www.wipson.com/))
- **WINTELIPS** — premium expert analysis, IPC, citation, translation ([wintelips.com](https://www.wintelips.com/))
- **WIPS GLOBAL** — English/Chinese interface, 12+ countries ([wipsglobal.com](https://www.wipsglobal.com/))
- **INTOMARK** — trademark search
- **WIPS PRISM** — AI auto-classification (deep learning, >90% accuracy)
- **PATBRIDGE** — Japanese-language Korean patent search

**Source (EN):** [wipscorp.com search/analysis services](https://www.wipscorp.com/online/page01) — accessed 2026-06-11
**Source (EN):** [WIPO Inspire — WIPS Global](https://inspire.wipo.int/wips-global) — accessed 2026-06-11

### API Availability

**No public developer API has been found.** Exhaustive searches of wipscorp.com, wipson.com, and WIPS Global documentation returned zero results for REST API, SOAP API, or self-service developer portal documentation.

WIPS does operate a **data services division** (wipscorp.com/online/page02) offering:
- Data sales and customized processing
- AI training dataset construction
- Data Voucher support for SMEs and startups
- Database covering 220 million patents plus corporate, industry, and market data

One search result snippet (from a WIPS infrastructure announcement) referenced that "WIPS currently offers API services for data provision," with infrastructure maintenance scheduled for May 22–25, 2026. However, **no public documentation, endpoint reference, or self-service signup for this was found.** This is consistent with an enterprise/bespoke data licensing model, not a self-service REST API.

**Uncertainty flag:** WIPS almost certainly provides data feeds and possibly API-level access under custom enterprise contracts — the brochure mentions "100% client requirements applied" for data processing — but this is not publicly documented. No developer portal exists on wipscorp.com or wipson.com as of 2026-06-11.

**Source (KO):** [WIPS data services page](https://www.wipscorp.com/online/page02) — accessed 2026-06-11
**Source (KO/EN):** [wipson.com service intro](https://www.wipson.com/service/cts/serviceIntro.wips) — accessed 2026-06-11

### Pricing

**Not publicly listed.** The WIPS ON site has a fee guide path (`/usageMng/feeSummary.do`) and a "quote request" (견적 요청) option, both behind login. One source mentioned tiered volume discounts across 50/100/150-unit thresholds for a specific government subsidy program, but this is not general public pricing.

**Contact:** help@wips.co.kr | 02-726-1100 | inquiry form at wipscorp.com/inquiry02

**Verdict: Contact sales / 견적 문의.** No public price sheet found.

### Data Coverage

- Korean patents and utility models (KIPO) — primary strength
- US, EP, JP, CN, WIPO/PCT patents
- Trademark, design, trial/litigation records
- Corporate and market intelligence data
- AI auto-classification (WIPS PRISM)
- Reported ~220 million total patent records

**Source (KO):** [KIPRIS Plus data biz listing for WIPS ON](https://plus.kipris.or.kr/portal/data/enter/DBII_000000000000411/viewdataBiz.do?menuNo=210158) — accessed 2026-06-11

### Integration Notes

- No self-service API; integration would require direct enterprise negotiation
- Contact for data API: help@wips.co.kr or 02-726-1074 / ipdb@wips.co.kr (data division)
- WIPS PRISM (AI auto-classification) may be accessible as a separate data enrichment layer — not confirmed publicly
- WIPS holds KIPO official data licensing, meaning their Korean patent data quality and freshness may exceed what is available via free KIPRIS channels

---

## 2. KEYWERT (키워트)

### Overview

KEYWERT is an AI-based global patent search and analysis platform by **워트인텔리전스 (Wert Intelligence, wertcorp.com)**. Commercially launched 2017, it has 3,000+ corporate customers. It offers AI-generated search formulas, natural language search, automated reports, graph visualization (600+ chart types), and DeepL-powered translation.

Two distinct products:
- **KEYWERT** (keywert.com) — B2B SaaS search + analysis workbench
- **KEYWERT Insight** (ai.keywert.com) — AI-first, natural language patent exploration and specification drafting assistant

**Source (KO):** [keywert.com](https://www.keywert.com/) — accessed 2026-06-11
**Source (KO):** [wertcorp.com KEYWERT service page](https://www.wertcorp.com/kr/service/keywert) — accessed 2026-06-11
**Source (KO):** [KIPRIS Plus data biz listing for KEYWERT](https://plus.kipris.or.kr/portal/data/enter/DBII_000000000000485/viewdataBiz.do?menuNo=210158) — accessed 2026-06-11

### API Availability

**No public API found.** Neither keywert.com, ai.keywert.com, nor wertcorp.com surfaces API documentation, developer portals, or REST endpoint references. The Enterprise plan (15+ users) includes SSO/SAML and IP access management, but these are identity/security integrations, not data APIs.

KEYWERT is listed in the KISTA (Korea Institute of Science and Technology Information) private service hub, but the referenced brochure PDF (biz.kista.re.kr) was binary/unreadable and yielded no API information.

**Uncertainty flag:** Wert Intelligence may offer custom data licensing or integration under NDA for large enterprise clients — this is unverified. Contact: cslab@keywert.com | 02-521-0110.

### Pricing

**KEYWERT Insight** (ai.keywert.com) — publicly listed pricing (KO, accessed 2026-06-11):

| Plan | Monthly (no commitment) | Effective monthly (annual) |
|---|---|---|
| **Light** | ₩158,000/mo | ₩82,500/mo |
| **Pro** | ₩598,800/mo | ₩332,500/mo |
| **Enterprise** | Custom (15+ users) | Contact sales |

- Annual commitment saves up to 47%
- VAT (10%) additional on all plans
- Pro includes 10x more AI tokens than Light; unlimited projects; guest collaboration

**KEYWERT (main platform, keywert.com):** No pricing page found publicly. Assumed contact sales / 견적 문의 for the full B2B analytics workbench.

**Source (KO):** [KEYWERT Insight about page](https://ai.keywert.com/en/about) — accessed 2026-06-11

### Data Coverage

- 300 million+ global patents across 106 countries (abstract coverage)
- 15 countries with deep/structured analysis
- Includes KIPO (Korean patents — noted as ~30% of benchmark test set) and USPTO (~70% of benchmark)
- Litigation and standards data noted
- DeepL translation integrated

**Source (KO):** [wertcorp.com KEYWERT service](https://www.wertcorp.com/kr/service/keywert) — accessed 2026-06-11
**Source (KO):** [KEYWERT Insight about](https://ai.keywert.com/en/about) — accessed 2026-06-11

### Integration Notes

- No self-service API confirmed
- KEYWERT Insight pricing is public and accessible — Light plan at ₩82,500/mo (annual) is the cheapest paid entry point of any Korean vendor found
- The natural language search and AI summarization in Insight overlap directly with patent-drafting AI use cases (prior art retrieval, spec generation)
- Enterprise plan SSO suggests institutional deals exist; B2B API likely negotiable
- KEYWERT Insight appears to cover primarily KIPO + USPTO; global coverage on the main KEYWERT platform is broader

---

## 3. KIPRIS Plus

### Overview

**KIPRIS Plus** (plus.kipris.or.kr) is the official open data portal operated by **한국특허정보원 (KIPI — Korea Institute of Patent Information)**, the government-affiliated body under KIPO. It provides the authoritative, legally official Korean IP data as Open APIs and bulk data. This is the same underlying data source used by the free public KIPRIS search site (kipris.or.kr).

**Source (EN/KO):** [WIPO Inspire — KIPRIS](https://inspire.wipo.int/kipris) — accessed 2026-06-11
**Source (KO):** [KIPRIS Plus portal](https://plus.kipris.or.kr/) — accessed 2026-06-11

### API Availability

**Yes — confirmed public REST API, free tier available.** KIPRIS Plus offers **50 REST API services** covering:

**Domestic IP data:**
- Patents and utility models (공개·등록공보 full text, bibliographic, drawings)
- Designs (디자인)
- Trademarks (상표)
- Trial and dispute records (심판)
- Administrative and correction notice data
- AI training datasets (text and image)

**International IP data:**
- US, EP, JP, CN, WIPO/PCT patents

**Active APIs as of 2026-06-11** (confirmed via status page, all green):
- Patents & Utility Model Public/Registration Gazettes (endpoints under both `kipo-api/kipi/` and `openapi/rest/`)
- Trademark Application News
- Trial Decisions/Documents
- Patent Examination Citation Documents
- Registration Information

Health checks every 10 minutes; all response times under 0.1s.

**Source (KO):** [KIPRIS Plus API list](https://plus.kipris.or.kr/portal/data/service/List.do?subTab=SC001&menuNo=200100&entYn=N) — accessed 2026-06-11
**Source (KO):** [KIPRIS Plus API status page](https://plus.kipris.or.kr/portal/main/apiStatus.do?menuNo=210157) — accessed 2026-06-11

**Authentication:** Service key (API key) obtained via account registration + admin approval at plus.kipris.or.kr. Key managed under "APIKEY Management" section of user dashboard.

**Signup process:**
1. Register account (individual or organization)
2. Browse and add desired API products to cart
3. Submit for admin approval
4. After approval, pay (bank transfer or credit card; note: individual accounts cannot use corporate cards)
5. Download API key from dashboard

**Source (KO):** [KIPRIS Plus sign-up guide](https://plus.kipris.or.kr/portal/main/contents.do?menuNo=210104) — accessed 2026-06-11

Also accessible via **data.go.kr** (Korea Open Data Portal) for development/test use only. Production usage must go through plus.kipris.or.kr directly.

**Source (KO):** [data.go.kr — KIPO patent API note](https://www.data.go.kr/data/15065437/openapi.do?recommendDataYn=Y) — accessed 2026-06-11

### Pricing

**Free tier:** 1,000 API calls per month, resets on the 1st of each month. No credit card required for free tier.

**Paid tier (daily subscription model):**
- Base rate: **₩5,320/day** = **₩1,941,800/year** per API product
- Applies to usage beyond the 1,000 free monthly calls

**Discounts:**
- 50% discount if subscribing to 2 or fewer API products simultaneously
- Additional 50% discount for: individuals, SMEs (중소기업), public institutions, non-profit organizations

**Effective annual cost example (single API, SME, 2-or-fewer products):** ₩1,941,800 × 50% × 50% = **~₩485,450/year (~$350 USD)**

**Note:** Pricing is per API product. If you use multiple APIs (e.g., patent + trademark + trial), each may be billed separately unless bundled under the 2-or-fewer discount.

**Source (KO):** [KIPRIS Plus payment/fee page](https://plus.kipris.or.kr/portal/use/paymentMmg.do?menuNo=210112) — accessed 2026-06-11

### Data Coverage

- **Korean patents and utility models** — authoritative, full-text, official government source
- **Korean designs and trademarks** — official
- **Korean trial and administrative records** — official
- **US, EP, JP, CN, WIPO/PCT** — international data (coverage depth varies)
- Data format: XML (REST)
- Real-time updates

### Integration Notes

- **Best choice for Korean IP data accuracy and legal authority.** Data is the same underlying source as KIPRIS.or.kr
- Development guide (PDF + sample code for Java/Python, SOAP and REST) available at: [개발가이드](https://plus.kipris.or.kr/portal/bbs/view.do?nttId=638&bbsId=B0000001&menuNo=210149) (2024.03 version)
- XML response format requires parsing; no JSON option confirmed
- 1,000 free calls/month resets monthly — adequate for development, tight for production at scale
- Helpdesk: 02-6915-1553 (weekdays 09:00–18:00 KST)
- **Rate limits beyond free tier:** not explicitly stated on public pages; the daily billing model suggests unlimited within paid subscription

---

## 4. Quick Reference: Other Options

| Service | API? | Pricing | KIPO Coverage | Notes |
|---|---|---|---|---|
| **data.go.kr KIPO APIs** | Yes (REST, XML) | Free | Yes — patent, utility, trademark | Intended for dev/test only; production must use KIPRIS Plus. Same data, different delivery channel. Source (KO): [data.go.kr](https://www.data.go.kr/) |
| **Google Patents Public Datasets (BigQuery)** | Yes (BigQuery SQL) | ~$6.25/TB scanned; 1TB/mo free | Yes — 4.81M KR patent records confirmed | CC BY 4.0; data provided by IFI CLAIMS. Good for bulk ML/analytics; not real-time. Source (EN): [GitHub](https://github.com/google/patents-public-data) |
| **Lens.org API** | Yes (REST, JSON) | Free (non-commercial/academic); custom for commercial | Yes — includes KR records from 140M+ global patents | Requires account + access token; rate limits via HTTP headers; commercial plan = contact. Source (EN): [Lens API docs](https://docs.api.lens.org/) |
| **EPO OPS (Open Patent Services)** | Yes (REST, OAuth2) | Free (4 GB/week fair use); paid plans for commercial scale | Indirect — EP/WIPO/INPADOC; KR included via INPADOC family links | Register free at EPO Developer Portal. Green/yellow/red quota indicators. Source (EN): [publicapi.dev](https://publicapi.dev/epo-api) |
| **PatentsView (USPTO)** | Yes (REST, JSON) | Free, open | No — US patents only | Good for US patent data; not relevant for KIPO-first use case |

---

## 5. Comparison Table

| Vendor | API Available? | Pricing | KIPO Data | Global Coverage | Integration Notes |
|---|---|---|---|---|---|
| **WIPS / WIPS ON** | Not publicly — contact sales | Contact sales / 견적 문의 (no public pricing found) | Yes — KIPO-designated, full depth | 220M+ patents, US/EP/JP/CN | Enterprise data licensing only; no self-service developer API; contact ipdb@wips.co.kr |
| **KEYWERT (키워트)** | Not publicly — contact sales | Main platform: 견적 문의; Insight: ₩82,500–₩332,500+/mo (annual) | Yes (KIPO + USPTO confirmed) | 300M+ patents, 106 countries | Insight plan publicly priced; no API endpoint documented; SSO available for Enterprise |
| **KIPRIS Plus** | **Yes — public REST API** | **Free: 1,000 calls/mo; Paid: ~₩5,320/day/API** | **Yes — authoritative, official** | US, EP, JP, CN, WIPO/PCT | 50 APIs, XML format, admin approval required, sample code available |
| **data.go.kr KIPO APIs** | Yes (REST, XML) | Free | Yes | Limited | Dev/test only; production use redirected to KIPRIS Plus |
| **Google Patents BigQuery** | Yes (SQL/BigQuery) | ~$6.25/TB scanned (1TB/mo free) | Yes (4.81M KR records) | Worldwide | Batch/analytics; not real-time; CC BY 4.0 |
| **Lens.org API** | Yes (REST, JSON) | Free (non-commercial); commercial = contact | Yes (KR included) | 140M+ patents worldwide | JSON-friendly; good for citation graph + prior art; commercial pricing opaque |
| **EPO OPS** | Yes (REST, OAuth2) | Free (4 GB/week); commercial = contact | Indirect via INPADOC | EP + WIPO + many national offices | KR reachable via patent family; not a direct KIPO search API |

---

## 6. Recommendation

**Given that KIPRIS Plus (free) is already integrated**, the marginal value of adding a second paid Korean patent source depends on two gaps: (a) data quality/depth beyond what KIPRIS free delivers, and (b) semantic/AI-powered search that KIPRIS's keyword-only XML API cannot provide.

### Recommendation: Start with KEYWERT Insight (Light plan) for AI search; defer WIPS

**KEYWERT Insight Light** at ₩82,500/mo (annual, ~$60 USD/mo) is the only Korean vendor with a **publicly priced, self-service subscription** and an AI-native interface that overlaps directly with patent-drafting AI needs: natural language prior art search, AI summarization, automated specification assistance. For a startup that has already wired KIPRIS Plus + PubMed + OpenAlex, KEYWERT Insight adds:

1. **AI semantic search on top of KIPO + USPTO data** — addresses the "keyword-only" limitation of KIPRIS Plus's XML API
2. **Accessible without a sales call** — Light plan can be activated today with a credit card
3. **Prior art report generation** — directly useful for the patent-drafting pipeline

**Caveats:** KEYWERT Insight has no confirmed programmatic API. For the patent-drafting AI to call it programmatically (rather than a human using the UI), you would need to contact them at cslab@keywert.com to inquire about B2B API access. If they decline or price it prohibitively, treat the Light plan as a reference tool for human QA, not a pipeline integration.

**WIPS / WIPS ON:** Best-in-class Korean patent data quality and the broadest legal/administrative records, but **no publicly accessible API and no public pricing**. Appropriate as a Phase 2 integration once the product has traction and budget for an enterprise data contract (contact ipdb@wips.co.kr). Not recommended for an early-stage MVP API integration.

**Lens.org API:** Worth adding as a free-tier layer for citation graph, NPL (non-patent literature) cross-referencing, and global prior art with JSON-friendly responses. Apply for access at lens.org — non-commercial use is free with an access token. Its 140M+ record corpus + citation links complement KIPRIS's Korea-deep data with global breadth.

**EPO OPS:** Relevant if the product expands to EP/PCT filing support; less critical for KIPO-first. Add it for free when EP coverage becomes needed.

### Suggested integration order

1. **Already done:** KIPRIS Plus (free, official KIPO data, XML)
2. **Next (immediate):** Apply for Lens.org API free tier — adds global coverage + citation graph at $0
3. **Next (if budget allows ~₩82,500/mo):** KEYWERT Insight Light for AI semantic search — confirm programmatic access before committing to annual plan
4. **Later (enterprise stage):** Negotiate WIPS data API for maximum KIPO data depth and legal record coverage

---

*Research conducted by Claude Code agent on 2026-06-11. All prices in KRW unless noted. Exchange rate context: ~1,400 KRW per USD at time of research. All URLs accessed 2026-06-11. Claims without a source URL are flagged as unverified.*
