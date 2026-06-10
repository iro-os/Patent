# 선행기술 검색 소스 / API — 2026 분석 & MVP 추천 스택

> 대상: Patent AI (KIPO-first 의료기기 특허작성, 전세계 선행기술 = 특허 + 논문, 기밀성·비용 민감 MVP).
> 이미 연결됨: PubMed(NCBI E-utilities) + OpenAlex.
> 근거: 2026-06-10 deep-research + 직접 1차 출처 검증(가격/한도). [검증=이번에 공식 페이지 확인] / [상식=업계 표준 지식].

---

## 0. 결론 (TL;DR)

**무료 공식 API를 우선으로, 다음 순서로 붙인다:**

| 우선 | 소스 | 무엇을 커버 | 비용(2026) |
|---|---|---|---|
| **이미 있음(수정필요)** | PubMed, **OpenAlex** | 바이오의학 + 일반 학술 | 무료 — **OpenAlex는 이제 무료 API 키 필요** |
| **P0** | **KIPRIS Plus** | 한국 특허(KIPO) | 무료 1,000건/월 → 초과 시 $1,783/년 |
| **P0** | **EPO OPS** | 전세계 특허 패밀리 + 법적상태 | 무료 4GB/주 |
| **P1** | Europe PMC, Crossref, Semantic Scholar | 의학 풀텍스트 / DOI 정규화 / 관련도 | 무료 |
| **P1/P2** | USPTO PatentsView | 미국 특허(구조화) | 무료(키, 45콜/분) |
| **P2(유료, 트리거 시)** | SerpApi Google Patents | 전세계 특허 풀텍스트·관련도 | $75/월(5k검색) |
| **P2(유료)** | Lens.org | 특허+논문 통합 | 상업용=유료 계약 |
| **범위 밖** | PatSnap·Questel·Derwent·PatBase | 프리미엄 분석 | 엔터프라이즈 $$$ |

**즉시 액션 3개:** ① OpenAlex **무료 API 키 발급**해서 기존 연동에 붙이기(이제 키 필수, $1/일 무료 크레딧). ② **KIPRIS Plus 가입 시작**(즉시 발급 아님 — 수동 5단계, 시간 걸림). ③ **EPO OPS 앱 등록**(developers.epo.org).

---

## 1. 특허 소스 (Patent)

| 소스 | 커버리지 | API / 인증 | 가격·한도 (2026) | 강점 | 약점 | 기밀성 |
|---|---|---|---|---|---|---|
| **KIPRIS Plus** (KIPI/한국) | 한국 특허·실용·디자인·상표·심판 (45개 서비스) | Open API, 키, **수동 5단계 신청**(즉시발급 아님) | **무료 1,000건/월** → 초과 시 **연 $1,783 정액** [검증] | KIPO-first 필수, 한국 공식·권위, 무료 한도 충분 | 신청 수동/느림, KR 중심, 영문 빈약 | 우리가 질의 통제(공식) — 안전 |
| **EPO OPS** (Espacenet API) | 전세계 1.3억+ 특허, INPADOC 패밀리·법적상태 | REST API(XML), 등록, fair-use | **무료 4GB/주**(비유료) [검증] | 전세계 패밀리 dedup·법적상태, 무료, 권위 | XML 복잡, 프로그래밍 필요, 주간 쿼터 | 공식 — 안전 |
| **USPTO PatentsView** | 미국 특허(서지+인용 그래프, 구조화) | Search API, **키 필수**(X-Api-Key), **45콜/분** [검증] | 무료 | US 데이터 풍부·인용그래프, 무료 | **미국만** | 공식 — 안전 |
| **Google Patents (SerpApi)** | 전세계 풀텍스트(구글 특허 스크랩) | REST, 키 | **무료 250검색/월**, $25/1k, **$75/5k**, $150/15k, $275/30k [검증] | 가장 쉬움·전세계 풀텍스트·관련도 우수 | 비용↑(스케일), 비공식 스크래퍼 | ⚠️ 약관상 콘텐츠 **비암호 전송 가능·보관기간 명시 없음** [검증] → 키워드만 전송 |
| **Google Patents Public Data (BigQuery)** | 17개국 9,000만+ 서지 + US 풀텍스트 (IFI CLAIMS) | BigQuery SQL | 무료 1TB/월 쿼리 → 초과 ~$6.25/TB [상식] | 전세계 대량·분석/백필용 | 실시간 질의 아님, 대부분 서지(US만 풀텍스트) | 우리 GCP 내 — 안전 |
| **Lens.org** | 특허 + 학술 **통합**, 패밀리·인용 링크 | API, 120+ 특허 필드 | **무료 체험 14일** → 상업용=**유료 Member/계약** [검증] | 특허↔논문 연결 단일 소스, 강력 | 상업 통합은 유료 계약, 50k 다운로드 캡 | 계약 기반 — 협상 가능 |
| **WIPO PATENTSCOPE** | PCT 240만 + 9,900만 문서, ASEAN, 교차언어(CLIR) | 주로 UI/다운로드(공식 REST API 제한적) | 무료, 1만건 다운로드 | PCT·다국어 교차검색·ASEAN | **프로그램 API 빈약** → 자동화 어려움 | 공식 — 안전 |
| **PatSnap / Questel Orbit / Derwent / PatBase** | 전세계 프리미엄 분석 | 엔터프라이즈 API | 엔터프라이즈 $$$ (수천~수만 $/년) | 최고 커버리지·분석 | **MVP 예산 밖** | 계약 |

---

## 2. 학술 / 비특허문헌 (NPL — 논문도 신규성 선행기술)

| 소스 | 커버리지 | API / 인증 | 가격·한도 (2026) | 강점 | 약점 | 기밀성 |
|---|---|---|---|---|---|---|
| **PubMed** (NCBI E-utilities) *이미 연동* | 바이오의학 3,700만+ | REST, 키 선택 | 무료, **키 없이 3req/s, 무료 키로 10req/s** [상식] | 의료기기 핵심, 무료, 권위 | 바이오의학 한정, 서지 위주 | 공식 — 안전 |
| **OpenAlex** *이미 연동* | 전세계 학술 그래프 2.5억+ | REST, **이제 무료 키 필수** | **$1/일 무료 크레딧**, op별 비용 상이 [검증] | 무료·초대형·메타데이터 풍부 | ⚠️ **2026 크레딧 모델 전환 — 기존 연동에 키 추가 필요**, 풀텍스트 아님 | 공식 — 안전 |
| **Europe PMC** | 생명과학 3,300만+ (PubMed+EPO특허+NICE 등), 풀텍스트 1,020만 | REST, 키 불필요 | 무료 [검증] | **풀텍스트** 많음, PubMed 보완, 특허도 일부 색인 | 생명과학 중심 | 공식 — 안전 |
| **Semantic Scholar** | 전 분야 2.14억 논문, 인용 24.9억 [검증] | REST, 키 선택 | 무료, 비인증=공유 throttle, **키=1 req/s** [검증] | AI 관련도·TLDR·임베딩(SPECTER) | 키 1req/s 느림 → 대량 부적합 | 공식 — 안전 |
| **Crossref** | DOI/메타데이터 1.5억+ | REST | 무료, **2025-12-01 한도변경**: 익명 5req/s(단건)·1req/s(목록), Polite Pool(mailto) 10·3 [검증] | DOI 정규화·dedup 백본 | 메타데이터만 | 공식 — 안전 |
| **CORE** | 오픈액세스 풀텍스트 집계 2억+ | REST, 키 | 무료(키, rate limit) [상식] | OA 풀텍스트 | OA 한정 | 공식 — 안전 |
| **Dimensions** | 학술+특허+그랜트 통합 | REST API | 비상업 무료, **상업 API 유료/게이트** [상식] | 통합 메타데이터 | 상업 접근 유료 | 계약 |
| **arXiv / bioRxiv / medRxiv** | 프리프린트 | 무료 API, 키 불필요 | 무료 [상식] | 최신·의료기기는 **medRxiv/bioRxiv** 유용 | 프리프린트(미심사) | 공식 — 안전 |
| **Google Scholar** | 광범위 | **공식 API 없음**(SerpApi가 스크랩) | (SerpApi 비용) | 광범위 | 비공식·스크랩 | ⚠️ SerpApi 경유 → 키워드만 |

---

## 3. 추천 MVP 스택 (랭킹) + 추가 트리거

1. **PubMed + OpenAlex** (이미 있음) — *OpenAlex에 무료 키만 추가*. 바이오의학 + 일반 학술 베이스.
2. **KIPRIS Plus** (P0) — KIPO-first의 한국 특허 필수. 무료 1,000건/월이면 MVP 충분. *지금 가입 시작*(발급 느림).
3. **EPO OPS** (P0) — 전세계 특허 패밀리 + 법적상태의 백본. 무료 4GB/주.
4. **Europe PMC + Crossref** (P1) — 의학 풀텍스트 + DOI 정규화/dedup(인용 형식·중복 제거 품질↑).
5. **Semantic Scholar** (P1) — 관련도 랭킹·TLDR용(대량 말고 상위 후보 정밀화).
6. **USPTO PatentsView** (P1/P2) — 미국 특허 비중 커지면. 무료.
7. **WIPO PATENTSCOPE / BigQuery** (P2) — 다국어·PCT 보강(PATENTSCOPE), 대량 백필(BigQuery).
8. **SerpApi Google Patents** (P2, 유료 $75/월) — *트리거: 공식 API 관련도/풀텍스트가 부족할 때.* 전세계 풀텍스트·관련도 최고지만 **기밀성 주의**(키워드만).
9. **Lens.org** (P2, 유료 계약) — *트리거: 특허↔논문 통합 + 스케일.*
10. **PatSnap/Questel/Derwent/PatBase** — *트리거: 자금 들어온 분석 티어.* MVP 예산 밖.

---

## 4. 단계별 연결 순서 (비용 매핑)

- **Phase A — 지금, $0**: PubMed 키 정비 + **OpenAlex 키 추가** + **KIPRIS Plus 가입 착수**(느림) + **EPO OPS 등록**. → KR + 전세계 특허 + 바이오의학 + 일반학술 전부 무료.
- **Phase B — $0**: Europe PMC + Crossref(dedup·정규화) + Semantic Scholar(관련도).
- **Phase C — 저비용**: PATENTSCOPE(다국어/PCT), 필요 시 BigQuery 백필.
- **Phase D — 유료(트리거 시)**: SerpApi $75/월(전세계 관련도) → 그다음 Lens 계약(통합).

---

## 5. 기밀성 가이드 — 발명 안 새게 검색하는 법

**핵심 위험:** *미공개 발명의 원문*을 외부 검색에 그대로 보내면 ① 신규성 민감 의도 유출, ② 극단적 해석 시 공개 행위 논란. (AI 입력이 특허권을 해칠 수 있다는 실무 경고 존재 — losey.law.)

**규칙:**
1. **원문 절대 전송 금지.** LLM(우리 no-train 조건)으로 **로컬에서 키워드/CPC·IPC 분류/MeSH 질의**를 추출한 뒤, 그 **짧은 질의만** 외부 API로 보낸다. (우리 `analyze.ts`의 구성요소 추출과 자연스럽게 연결.)
2. **공식 API 우선**(EPO OPS·KIPRIS·PatentsView·PubMed·OpenAlex·Crossref·Europe PMC) — 질의를 우리가 통제하고 데이터 약관이 명확. **스크래퍼(SerpApi)는 후순위**: 약관상 비암호 전송 가능 + 보관기간 미명시.
3. **SerpApi 쓸 땐**: 키워드만, 로그된다고 가정. **발명의 핵심 조합을 한 질의에 담지 말 것** — 구성요소별로 쪼개 질의해 단일 질의가 발명 전체를 드러내지 않게.
4. 특허 검색은 본래 키워드/분류 기반이라 이 방식과 잘 맞음: 구성요소 추출 → CPC/IPC + 키워드 클러스터 → 개별 질의 → 집계.

---

## 6. 우리 현황 대비 액션 아이템

- [ ] **OpenAlex 무료 API 키 발급**(openalex.org/settings/api) → 기존 연동에 키 헤더 추가. **$1/일 무료 크레딧** 초과 모니터링(저볼륨이면 충분).
- [ ] **KIPRIS Plus 가입 착수** — 수동 5단계라 리드타임 있음. 무료 1,000건/월. (kiprisplus@kipi.or.kr)
- [ ] **EPO OPS 앱 등록**(developers.epo.org) → 전세계 특허 패밀리/법적상태.
- [ ] 컨센서스 플랜의 "SerpApi 무료 ~100/월"은 갱신: **현재 무료 250/월**, 유료 $75/5k.
- [ ] 리서치 질의 파이프라인에 **키워드 추출 게이트**(원문 미전송) 명시.

### 출처
- OpenAlex: https://developers.openalex.org/
- SerpApi 가격/약관: https://serpapi.com/pricing · https://serpapi.com/legal · https://serpapi.com/google-patents-api
- KIPRIS Plus: https://plus.kipris.or.kr/eng/use/paymentMmg.do?menuNo=310105
- USPTO PatentsView: https://search.patentsview.org/docs/ · https://patentsview.org/apis/api-faqs
- EPO OPS: https://developers.epo.org/
- Europe PMC: https://europepmc.org/RestfulWebService
- Semantic Scholar: https://www.semanticscholar.org/product/api
- Crossref: https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/
- Lens.org: https://support.lens.org/knowledge-base/lens-patent-and-scholar-api/
- WIPO/Espacenet/BigQuery: https://wipo-analytics.github.io/manual/databases.html · https://github.com/google/patents-public-data
- 기밀성: https://www.losey.law/accidental-ai-forfeiture-how-inputting-data-into-ai-can-destroy-patent-rights/ · https://www.solveintelligence.com/blog/post/client-confidentiality-in-the-age-of-ai-best-practices-for-patent-professionals
