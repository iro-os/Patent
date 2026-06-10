# 야간 5축 멀티에이전트 감사 — 2026-06-11 (01:30 KST)

> Patent AI(특허 AI) — 비전문가가 아이디어 → 변리사-ready 한국 특허문서(출원서/명세서/요약서)를 만들도록.
> 5개 병렬 에이전트(opus)가 형식충실도·생성품질·선행조사·UX·백엔드 축으로 read-only 감사. 각 항목 파일:라인 인용.
> 이 문서는 그날 밤 자율 개선 루프의 근거자료. 배치 우선순위·진행은 `.overnight/PLAN.md`.

---

## 1) KIPO 형식·문서 충실도

핵심: 본문 뷰 ↔ DOCX는 단일 모델(`buildDocumentModel`)을 공유해 두 출력 간 어긋남은 거의 없음 — 진짜 문제는 그 모델이 KIPO 식별번호 규칙·출원서·선행기술문헌 형식에서 틀어진 것.

- **[P0] 식별번호 오프셋** — `lib/spec/document-model.ts:85-101` — 발명의 명칭이 `num:++counter`로 【0001】을 받아 전 문서가 KIPO 대비 +1 밀림. KIPO 규칙: 명칭=무번호, 기술분야=【0001】(모범명세서 3건 모두 동일). Fix: 명칭 `num:null`, counter는 기술분야부터. **S**
- **[P0] 출원서(별지14) 미모델링/미출력** — `lib/kipo/sections.ts:174` `KIPO_APPLICATION_FIELDS` 정의됐으나 어디서도 import 안 됨. UI는 우패널을 "출원서 초안"이라 부르나(`draft-pane.tsx:62,112`) 내용은 명세서. Fix: (a) 라벨을 "명세서 초안"으로 정정[S] 또는 (b) 별지14 최소 표지 추가[M]. **S~M**
- **[P1] 선행기술문헌 형식 불일치** — `sections.ts:189-213` vs `exemplars/data/04_0413·0414.json` — 모범: 【특허문헌】 하위표제 + `(특허문헌 0001) …호` 묶음당 식별번호 1개. 현재: `[문헌N]` 플랫 + 줄마다 식별번호. Fix: 선행기술문헌을 prose 넘버링서 분리, 묶음당 1번호 + `(특허문헌 0001)` 표기. **M**
- **[P1] 발명의 명칭이 헤딩 아닌 번호 단락** — `docx.ts:65-67`, `draft-pane.tsx:433-443` — P0와 함께 명칭=단일 무번호 라인. **S**
- **[P2] 요약서를 명세서 본문 division으로 렌더** — 별지16=별개 서식. `docx.ts:52-58,126` page break + "요약서(별지16호)". **S**
- **[P2] 청구범위 식별번호 연속성** — P1(실제 청구항) 도입 시 counter를 청구범위까지 연속. 지금은 문서화만. **S**
- **[P2] 부호의 설명 줄바꿈 미보존** — `document-model.ts:65-70` splitParas가 줄마다 들여쓰기 단락화. Fix: 들여쓰기 없는 단일 블록 분기. **S**
- **[P2] 타이포그래피 미세차이** — `docx.ts:31-58` 들여쓰기/표제 weight/줄간격을 모범 PDF와 1:1 대조. **M**

TOP3: ①식별번호 오프셋 ②"출원서" 진실성 정리 ③선행기술문헌 형식 통일

---

## 2) 생성 품질 & 변리사-readiness

핵심: 모델을 약하게 쓰고 있음(Opus 4.8 thinking/effort 전무 + 기본값 Sonnet), few-shot이 문단번호·도면부호를 흘림, 기재불비(미완결 실시예·청구항 부재)를 구조적으로 못 막음. 문체 transfer·[N] grounding은 잘 설계됨.

- **[P0] Opus를 thinking 없이 호출** — `lib/llm/client.ts:67-76` — `thinking`·`output_config.effort` 미설정. 명세서·진보성·청구전략은 다단계 추론 과제라 thinking-off은 품질 직접 손실. Fix: `thinking:{type:'adaptive'}` + `output_config:{effort:'high'}`(요약은 medium). **S**
- **[P0] 프로덕션 기본 모델이 Sonnet** — `lib/llm/client.ts:7` + `.env.local` — `MODEL=…||'claude-sonnet-4-6'`, env도 sonnet(주석만 "opus for production"). Fix: opus-4-8로. **S**
- **[P0] few-shot이 【000N】·도면부호 주입→복제 위험** — `lib/exemplars/index.ts:69-75` — 주입 청크에 문단번호 9개·도면부호 38개. SYSTEM이 복제금지 지시해도 LLM은 모방기. Fix: 주입 직전 `【\d{4}】`·선두 도면부호 정규식 strip. **S**
- **[P1] 청구범위 전략뿐→명세서 미완결(기재불비 노출)** — `sections.ts:145-154`,`document-model.ts:128-148` — §42(4)(1) 뒷받침요건 검증 불가. Fix: "청구범위 미생성—변리사 작성 필요" 명시(단기), 독립항 골격 도출(중기). **M**
- **[P1] 실시예(enabling) 강제장치 없음** — `sections.ts:63-66` guidance 한 줄뿐. Fix: "동작원리·입력→처리→출력·핵심 파라미터 예시범위·best mode·대체 실시예" 체크리스트를 prompt에. **M**
- **[P1] grounding이 [N]만 검사, 환각 수치·도면부호 무방비** — `lib/llm/grounding.ts:26-37`. Fix: prompt에 "디브리프에 없는 수치는 '예시적으로/일 실시예에서' hedge 명문화" + 사후 수치 토큰 플래그. **M**
- **[P2] 예시 매칭 0.03 휴리스틱** — `exemplars/index.ts:35` MIN_OVERLAP 낮음. Fix: 0.06+, 실패시 예시없이(정상). **S**
- **[P2] 첫 턴 max_tokens=3500 빠듯** — `chat.ts:273`. Fix: 첫 턴 5000~6000 + streaming 검토. **S**

TOP3: ①client.ts thinking+effort+opus ②exemplar 번호/도면부호 strip ③enabling 체크리스트 + 청구범위 미생성 경고

근거: KIPO 청구범위 심사기준 §42(4)(1); IPWatchdog/Mr.IP Law 2026 AI-drafting enablement.

---

## 3) 선행기술조사 품질

기밀성 판정(코드): 외부 호출은 PubMed+OpenAlex뿐, 발명 원문은 외부 미전송(규칙#1 충족). 단 `search_query_en`이 길이/분할 없는 자유 질의라 발명 핵심조합을 한 질의에 담을 수 있어 규칙#3 위반 소지.

### A) 키 불필요
- **[P0] 한국어 랭킹·토큰화 무력** — `retrieval/index.ts:97-107,135-152` — `len>=4`+영어 stopword, substring 매칭. KIPO-first인데 한국어 적합도가 노이즈. Fix: 한글 2자+bigram, `concepts.ko`도 랭킹에 포함, NFC. **M**
- **[P0] `search_query_en` 기밀성·품질 가드 부재** — `chat.ts:71,110`→`index.ts:48` — Fix: prompt에 "신규조합·고유명칭·수치 제외" + 외부 전송 직전 단어수 캡(≈12). **S**
- **[P1] facet 질의 분할 약함** — `index.ts:29-38` — Fix: PubMed도 상위 N concept 개별 esearch + facet-hit 가중(기밀성도 개선). **M**
- **[P1] dedupe가 DOI/PMID 못 잡음** — `index.ts:116-131` — Fix: `RetrievedRef.doi` 추가, DOI 1순위 dedupe. **S**
- **[P1] Crossref/Europe PMC 무키 미통합** — Fix: `europepmc.ts` 어댑터 + Crossref DOI 보강. **M**
- **[P2] `ipc_candidates` 생성만, 소비 0** — `chat.ts:283` — coverage 노출 + 특허DB 활성 시 분류필터 배선. **S**
- **[P2] OpenAlex 2026 키 전환 미대응 + 가짜 mailto** — `openalex.ts:6,23` — Fix: `OPENALEX_API_KEY` 헤더 배선, mailto 경고. **S**

### B) 특허DB 스캐폴딩
- **[P1] 공통 retrieval-source 인터페이스 부재** — `index.ts:34` 어댑터 하드코딩. Fix: `PriorArtAdapter{source,isEnabled(),search()}` + 활성 어댑터만 `allSettled` 스윕. KIPRIS/EPO는 `isEnabled=!!process.env.KIPRIS_PLUS_KEY` env 게이트→키 없으면 현 동작 유지, 키 추가 시 무중단 활성(`types.ts:13`에 `'kipris'|'epo'` 이미 있음). coverage 동적화. **M**

TOP3: ①search_query 기밀 가드+캡 ②한국어 토큰화·랭킹 수리 ③PriorArtAdapter+env 게이트 스캐폴딩

---

## 4) 프런트엔드 / UX (비전문가 관점)

뼈대(대화→리서치→본문→DOCX)·안전문구·되돌리기·상태칩은 단단. 결손: 모바일 접근불가, 3-pane 자기설명 부재, 핵심도구 발견성.

- **[P0] 모바일·태블릿서 결과물 접근 불가** — `panes.tsx:21-27`,`invention-sidebar.tsx:227` — 우패널 `hidden lg:block`, 사이드바 `hidden md:flex`. 폰에선 채팅만 보임(초안 확인·내보내기 불가). Fix: 사이드바→Sheet 드로어(햄버거), 우패널→"초안 보기" full-screen Sheet, app-shell 모바일 헤더. **L**
- **[P0] 3-pane에 헤더/라벨 없음→"다음 뭐?"** — `projects/[id]/page.tsx:80-107`,`draft-pane.tsx:218-231` — Fix: 우패널 제목 고정 + 가운데 단계 stepper(①대화②리서치③본문④내보내기, `status`/`STATUS_LABEL` 재사용). **M**
- **[P1] "심층 리서치"가 필수 관문인데 숨음** — `workspace.tsx:300-315`,`draft-pane.tsx:268-281` — 본문/DOCX는 `disabled={!hasRefs}`인데 트리거는 작은 버튼. Fix: 대화 후 가운데 primary CTA "이제 선행기술을 검색해볼까요? →". **M**
- **[P1] 온보딩 "무엇을 얼마나" 예시 없음** — `workspace.tsx:287-291,366-370` — Fix: 클릭형 예시 칩 2~3개 + "완벽 안 해도 됨" 한 줄. **S**
- **[P1] 생성 본문에 disclaimer 없음** — `draft-pane.tsx:283-368` — 경고가 composer 하단·toast에만. Fix: 우패널 문서 헤더 아래 상시 배너 "AI 초안 · 출원 전 변리사 검토 필수". **S**
- **[P2] 첨부가 되는 척하나 파싱 안 됨** — `workspace.tsx:150-153,296-299,391` — Fix: "곧 지원" 뱃지 또는 "핵심 내용을 붙여넣어 주세요" 안내, 본문 내부표식 제거. **S**
- **[P2] textarea aria-label 없음 + native alert** — `workspace.tsx:277`,`new-invention-button.tsx:19,21`,`login/page.tsx:18` — Fix: `aria-label` + `alert()`→`toast.error`, ThinkingIndicator `role=status aria-live`. **S**
- **[P2] 상태 점 범례 목차 탭에만 + 색만으로 구분** — `draft-pane.tsx:260-262,495-500` — Fix: 텍스트 배지, "검토 완료"→"확정함", 범례 공통영역. **S**

TOP3: ①모바일 응급(Sheet) ②길잡이 stepper+리서치 CTA ③본문 상시 신뢰 배너

---

## 5) 백엔드 / 보안 / 아키텍처

전반 견고: 모든 라우트 `auth.getUser()`, 서비스롤 키 미사용→전 DB접근 세션+RLS 강제, 14개 자식테이블 RLS owner-scope, invention 본문 로깅 없음, .env.local gitignore, `must()`·"삭제 전 조립" 패턴 탄탄.

- **[P1] chat 메시지/인텐트 길이 무제한→비용·DoS·프롬프트 오염** — `chat.ts:24-27,129` — 타 입력은 경계(snippet 400, refs 15)인데 `message`·`instruction`·`title`은 무제한. Fix: 진입 시 길이 가드(message≈8000 등). **S**
- **[P1] LLM/검색 라우트 per-user rate limit 부재** — 전 라우트 — 사후 `usage_log`만, 사전차단 없음. Fix: 경량 슬라이딩윈도우 또는 usage_log 일일 상한 게이트. **M**
- **[P1] "zero-retention LLM" 불변식이 코드 미강제** — `client.ts:23-27` + AGENTS.md — 기본 no-train 의존, ZDR deferred(메모리 일치). Fix: 문서를 "기본 no-train+RLS, ZDR deferred"로 정정. **S**(문서)
- **[P2] PATCH/DELETE/clarifying_qa 0-row도 ok:true** — `projects/[id]/route.ts:33,51`,`research/fast:73-79`,`db.ts:21-26` — `must()`가 rowcount 미검사. IDOR 아님(RLS 차단) but 오해 소지. Fix: 소유권 중요 mutation은 `.select('id')` 후 0행→404(revert 라우트가 이미 올바른 패턴). **S**
- **[P2] research/fast 직렬 요약 60s budget 초과 시 status 갇힘** — `research/fast:10,113-127` — 타임아웃은 catch 미실행→`researching` 잠김. Fix: 요약 `Promise.all` 병렬, maxDuration 상향, 진입 시 stuck 보정. **M**
- **[P2] export title 무검증(파일명은 정제됨)** — `export/route.ts:92` — title이 DOCX 본문에. Fix: P1 title 길이제한과 함께. **S**
- **[P2] messages role/kind 서버 화이트리스트 없음** — DB CHECK 제약 추가 권장(additive migration). **S**

TOP3: ①chat/instruction/title 길이 상한 ②LLM 라우트 일일 rate 게이트 ③AGENTS.md ZDR 문구 현실화
