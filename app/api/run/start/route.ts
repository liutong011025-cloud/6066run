import { NextResponse } from "next/server";
import { getSupabaseAdmin, hasSupabaseConfig } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const playerId = String(body.playerId ?? "");
  if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });

  if (!hasSupabaseConfig()) {
    return NextResponse.json({ configured: false, runId: `local-run:${Date.now()}` });
  }

  const supabase = getSupabaseAdmin()!;
  const { data, error } = await supabase
    .from("runs")
    .insert({ player_id: playerId, status: "running", distance: 0, questions_passed: 0 })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ configured: true, runId: data.id });
}
