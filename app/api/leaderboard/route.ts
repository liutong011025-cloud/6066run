import { NextResponse } from "next/server";
import { getSupabaseAdmin, hasSupabaseConfig } from "@/lib/supabase-server";

export async function GET() {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ configured: false, rows: [] });
  }

  const supabase = getSupabaseAdmin()!;
  const { data, error } = await supabase
    .from("players")
    .select("nickname,best_distance,best_questions,updated_at")
    .order("best_distance", { ascending: false })
    .order("best_questions", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ configured: true, rows: data ?? [] });
}
