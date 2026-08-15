import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Used by anything client-facing (or that should respect RLS as a normal
// user would). This is the original export — unchanged, still safe to
// import anywhere, including client components.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// SERVER-ONLY. Bypasses RLS entirely using the service role key — only
// ever import this inside API routes / webhooks (files that run on the
// server, never shipped to the browser). Used for things like the Dojah
// webhook, which is a trusted server-to-server call from Dojah, not a
// request from the trader's browser, so it needs to write past RLS.
//
// SUPABASE_SERVICE_ROLE_KEY must NOT have the NEXT_PUBLIC_ prefix —
// that prefix ships a variable to the browser bundle, which would leak
// this key publicly. Set it as a plain (non-public) env var in Vercel.
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null
