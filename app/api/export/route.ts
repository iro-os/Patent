import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildSpecDocx, type ExportRef } from '@/lib/export/docx'
import { computeGrace } from '@/lib/kipo/disclosure'
import { must, PersistError } from '@/lib/db'
import type { PriorArtSource } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

// P0-B — assemble the current draft (generated body if present, else analysis dossier)
// into a KIPO-ordered .docx for the 변리사 handoff. Records an `exports` row and
// advances status to 'exported' (best-effort; never fails the download on audit error).
export async function POST(req: Request) {
  let bodyJson: { projectId?: string }
  try {
    bodyJson = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { projectId } = bodyJson
  if (!projectId) return NextResponse.json({ error: 'projectId가 필요합니다.' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: project } = await supabase
    .from('projects')
    .select('id, title, status')
    .eq('id', projectId)
    .single()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [sectionsRes, refsRes, claimRes, discRes, claimsRes] = await Promise.all([
    supabase.from('spec_sections').select('schema_key, generated_text').eq('project_id', projectId),
    supabase
      .from('prior_art_refs')
      .select('source, title, pub_date, url, ext_id')
      .eq('project_id', projectId)
      // Same deterministic order as generation, so the DOCX 선행기술문헌 [문헌N] list
      // lines up with the inline [N] markers carried in the exported body prose.
      .order('similarity', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(15),
    supabase.from('claim_strategy').select('independent_scope, dependent_ladder').eq('project_id', projectId).maybeSingle(),
    supabase.from('disclosure_check').select('disclosed, disclosure_date').eq('project_id', projectId).maybeSingle(),
    // 변리사가 검토 탭에서 확정(저장)한 실제 청구항 — 있으면 전략 블록 대신 정식 렌더.
    supabase.from('claims').select('number, text').eq('project_id', projectId).order('number'),
  ])

  const sections: Record<string, string> = {}
  for (const s of sectionsRes.data ?? []) {
    if (s.generated_text) sections[s.schema_key] = s.generated_text
  }
  const refs: ExportRef[] = (refsRes.data ?? []).map((r) => ({
    source: r.source as PriorArtSource,
    title: r.title,
    pub_date: r.pub_date,
    url: r.url,
    ext_id: r.ext_id,
  }))
  const grace = discRes.data?.disclosed ? computeGrace(true, discRes.data.disclosure_date) : null

  let buf: Buffer
  try {
    buf = await buildSpecDocx({
      title: project.title,
      sections,
      refs,
      claimStrategy: claimRes.data,
      claims: claimsRes.data ?? [],
      abstract: sections['요약'] ?? null,
      repFigure: null,
      grace,
    })
  } catch (e) {
    console.error('export build failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'export_failed' }, { status: 500 })
  }

  // Audit + status (non-fatal — a download must not fail on a telemetry write).
  try {
    must(await supabase.from('exports').insert({ project_id: projectId, format: 'docx' }), 'exports insert')
    if (project.status !== 'exported') {
      await supabase.from('projects').update({ status: 'exported' }).eq('id', projectId)
    }
  } catch (e) {
    if (!(e instanceof PersistError)) throw e
    console.error('export audit failed (non-fatal):', e.message)
  }

  const safeName = (project.title || '명세서').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60)
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}.docx`)}`,
    },
  })
}
