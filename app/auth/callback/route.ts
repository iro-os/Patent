import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// OAuth callback: exchange the code for a session, then redirect home.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const nextParam = searchParams.get('next') ?? '/'

  // Resolve `next` against our origin and only honor a SAME-ORIGIN destination, so a
  // crafted ?next=@evil.com / //evil.com cannot turn the post-login redirect into an
  // off-site open redirect (phishing). Falls back to '/'.
  let dest = `${origin}/`
  try {
    const resolved = new URL(nextParam, origin)
    if (resolved.origin === origin) dest = resolved.toString()
  } catch {
    // malformed next → keep the safe default
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(dest)
  }
  return NextResponse.redirect(`${origin}/login?error=auth`)
}
