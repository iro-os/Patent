# P0 빌드 스펙 — 명세서 본문 생성·편집·되돌리기(P0-A) + DOCX 내보내기(P0-B)

> 상태: **디자인 확정** (2026-06-10 브레인스토밍 세션). 별도 세션에서 빌드 예정.
> 범위: 컨센서스 플랜의 **Phase 2(문서 surface + refine loop + export)** 를, GenIP 수준 UX + 우리 grounding moat로 구현.
> 함께 읽기: `docs/genip-benchmark-2026-06.md` (벤치마크/로드맵), `.omc/plans/patent-ai-mvp-consensus-plan.md` (있으면).

---

## 0. 절대 원칙 — 기존 컨텍스트와 충돌 금지
**이미 있는 구조/스키마/패턴을 재사용한다. 새로 갈아엎지 않는다.** 아래 "이미 있는 것"을 먼저 읽고 그 위에 얹는다.

---

## 1. 이미 있는 것 (DO NOT rebuild — 여기에 연결만)
- **3-pane 셸**: 왼쪽 발명 목록(`app/_components/invention-sidebar.tsx`) · 가운데 채팅 워크스페이스(`app/(app)/projects/[id]/workspace.tsx`) · 오른쪽 `app/_components/draft-pane.tsx`. 패널 조립은 `app/_components/panes.tsx`, `app-shell.tsx`.
- **채팅**: `app/api/chat/route.ts` + `lib/llm/chat.ts` (`ChatContext` 주입, `MAX_RAW_TURNS=16`, 비게이트형 clarifying questions). 비스트리밍.
- **선행기술 리서치 (수동, 채팅에서 트리거)**: `app/api/research/fast/route.ts` + `lib/retrieval/*` (PubMed + OpenAlex, dedupe/rank). 결과 → `prior_art_refs`. **자동 검색 아님** — 채팅 입력창 툴바의 "심층 리서치" 버튼으로 사용자가 직접 실행. `coverage_report`(+`blind_spots`, "never 100%").
- **차별성 분석**: `app/api/analyze/route.ts` + `lib/llm/analyze.ts` → `generateDifferentiation()` 반환: `elements`(신규성), `differentiation_points`, `develop_suggestions`, `claim_strategy{independent_scope, dependent_ladder}`. **본문 prose는 생성 안 함(전략/분석만).** `draft-pane`의 "초안 작성/갱신" 버튼이 `/api/analyze`를 호출(현재는 분석 dossier만 렌더), `hasRefs` 게이트.
- **KIPO 구조**: `lib/kipo/sections.ts` — `KIPO_SECTIONS`(별지15호 순서+guidance), `SPEC_OUTLINE`(목차 UI 그룹), `formatKipoCitation()`(특허/비특허문헌 형식), `COMPLIANCE_CHECKS`(7개 상수, 아직 validator 미구현). `lib/kipo/disclosure.ts` — `computeGrace()` → §30 배너.
- **grounding(환각 방지)**: `lib/llm/grounding.ts` — 검색된 ref ID **closed allow-list** 검증기. 생성물의 인용 ID가 목록 밖이면 제거/거절.
- **스키마 (이미 `supabase/migrations/0001_init.sql`에 존재 — 새 마이그레이션 거의 불필요)**:
  - `projects.status`: `draft_intake|ready|researching|report_ready|doc_generated|refining|exported` (현재 앱은 `doc_generated`/`exported`까지 못 감 — 이번에 도달시킴).
  - `spec_sections`: `{schema_key, base_generated_text(=ANCESTOR), generated_text(latest), manual_override, locked, version}` — **본문 저장 + 되돌리기/3-way merge의 토대. 현재 아무 코드도 안 씀.**
  - `claims`: 존재하나 아무 코드도 안 씀(이번 P0 범위 아님; P1).
  - `exports`: export 작업/상태. `change_log`: 모든 AI 변경 audit. `coverage_report`, `prior_art_refs`, `differentiation_points`, `develop_suggestions`, `claim_strategy`(0003), `usage_log`(0004, 비용 텔레메트리), `messages`(0007).
  - 모든 테이블 RLS 적용(사용자별 격리).
- **LLM 클라이언트**: `lib/llm/client.ts` — `runTool()`, **비스트리밍**, `maxDuration=60`(s) 제한. (전체 본문 one-shot은 이 한도에 걸릴 수 있음 → 섹션 단위 생성 권장.)

---

## 2. 빌드 순서 & 내용

### P0-B — DOCX 내보내기 (먼저. 가장 작고, 스키마 이미 있음)
- 새 라우트 `app/api/export/route.ts` + `lib/export/` (npm `docx` 사용).
- `KIPO_SECTIONS` 순서로 문서 조립. **v1은 현재 draft-pane에 있는 내용(분석 dossier 또는 P0-A로 생성된 본문)을 그대로 내보냄** — 본문 생성(P0-A)이 들어오면 자동으로 실제 명세서 본문이 export됨.
- 상단 액션바에 "DOCX 내보내기" 버튼(이미 목업에 있음). `exports` 테이블 + `projects.status='exported'` 사용.
- 선행기술문헌은 `formatKipoCitation()`로 포맷.
- **변리사 핸드오프의 필수 산출물.** 본문이 거칠어도 내보내기가 먼저 있어야 가치가 생김.

### P0-A — 본문 생성 + 채팅 편집 + 결정론적 되돌리기 (핵심 UX)
**레이아웃 (확정):** 생성된 명세서 본문은 **오른쪽 패널(`draft-pane`)** 에 산다(클로드 코드 플랜 슬롯처럼). 가운데가 아님.

1. **최초 생성** — 오른쪽 패널 상단 "본문 생성" 버튼:
   - 가운데의 **리서치 + 대화**(debrief + `prior_art_refs` + analyze 결과)를 입력으로, `KIPO_SECTIONS`를 **섹션 단위로** 본문 prose 생성.
   - **반드시 `lib/llm/grounding.ts` 통과** — 인용은 검색된 ref ID closed allow-list로만. 근거 없으면 인용 없이 생성하거나 "해당 선행기술 없음" 플래그.
   - 각 섹션을 `spec_sections`에 저장(`generated_text` + `base_generated_text`=생성본).
   - `maxDuration=60` 때문에 **섹션별 호출**(또는 스트리밍) 권장. one-shot 전체 생성은 타임아웃 위험.
2. **편집 (가운데 채팅에서)** — 사용자가 자연어로 명령("【과제의 해결 수단】 더 구체적으로"):
   - 명령에서 **대상 섹션(KIPO key) 식별** → 그 섹션만 재생성(grounding 통과) → **직전 텍스트를 먼저 저장**(`change_log` + 이전 `generated_text`) → `spec_sections.generated_text` 갱신.
   - 오른쪽 패널의 해당 섹션에 "AI가 방금 수정함 + 되돌리기" 스트립 표시.
3. **되돌리기 = 결정론적 1-step undo (확정: Option A)**:
   - 섹션별 "되돌리기" 버튼 = **저장된 직전 텍스트를 그대로 복원**(DB 한 줄 스왑). **LLM 재생성 절대 안 거침.** `change_log`/`base_generated_text`에서 직전값 복원.
   - 이유: "채팅으로 원래대로 해줘"는 AI가 이전 텍스트를 *근사 재생성* → 비결정적·표류 위험(진짜 버그 경로). 결정론적 스왑이 더 단순하고 안전.
   - MVP는 1-step이면 충분. 나중에 짧은 스택(여러 단계)으로 확장은 UI 변화 없이 가능. (B 적용 전 diff 미리보기 / C 버전 타임라인은 나중.)
4. **grounding 가시화**: 각 섹션 하단 "근거 선행기술 [N]" 칩 → 그 섹션을 뒷받침한 `prior_art_refs` 보여줌. (GenIP이 못 하는 우리 차별점.)
5. **moat 노출(이미 일부 구현)**: §30 배너(`computeGrace`), 채팅의 커버리지 "100% 아님" 칩, 비용 미터(`usage_log`, 예: "AI 실측 $X"), 면책문구("AI 초안은 변리사 검토 필요 · 선행기술 검색은 완전성 미보장"). 리서치 트리거는 **채팅 입력창 툴바에 수동**으로 유지(기존 그대로).

---

## 3. Non-Goals (이번 P0에서 만들지 말 것)
- **zero-retention** — MVP 보류(추후 마일스톤). zero-retention 배지 만들지 말 것.
- AI 도면 생성(Phase 3), 실제 청구항 텍스트 생성/antecedent validator(P1), 청구항 분석 스코어 카드(P1), 크레딧/과금(P2), FTO/침해 분석, HWP export, 특허로 e-filing, US/PCT — 전부 범위 밖.

---

## 4. 가드레일 (반드시 준수)
- **포트 3001만 사용.** 포트 3000 = 사용자의 별도 IRO 대시보드 — 건드리거나 죽이지 말 것.
- `.env.local`은 gitignore + 실제 시크릿 포함 — 커밋/출력 금지.
- 라이브 Supabase(`ytntzcmuuqopdjdzvjxn`)에 **파괴적 마이그레이션 금지**. P0 테이블(`spec_sections/claims/exports/change_log`)은 이미 존재 → 새 마이그레이션은 거의 불필요. 필요하면 **additive only** + 사용자 명시 승인.
- `main` 푸시는 사용자 명시 승인 필요.
- 레포의 `CLAUDE.md` / `AGENTS.md` 컨벤션 따르기. 기존 파일 패턴/네이밍에 맞추기.

---

## 5. 완료 기준 (verify before claiming done)
- [ ] "DOCX 내보내기" → KIPO 레이아웃 .docx 생성, Word/한글에서 열림.
- [ ] "본문 생성" → `KIPO_SECTIONS` 섹션들이 본문 prose로 채워지고 `spec_sections`에 저장됨.
- [ ] 생성 본문에 **조작된 인용 0** — grounding validator가 목록 밖 ref ID를 제거/거절(주입 테스트로 검증).
- [ ] 채팅에서 한 섹션 편집 → 그 섹션만 바뀌고 `change_log` 기록됨.
- [ ] "되돌리기" → 직전 텍스트로 **정확히** 복원(LLM 안 거침), locked 섹션은 불변.
- [ ] 각 섹션 "근거 선행기술 [N]" 칩이 실제 `prior_art_refs`로 연결됨.
- [ ] §30 배너 / 커버리지 칩 / 비용 미터 / 면책문구 노출.
- [ ] RLS: 두 계정으로 서로의 프로젝트 안 보임.
- [ ] `npm run build` + lint 통과, 포트 3001에서 동작 확인.
