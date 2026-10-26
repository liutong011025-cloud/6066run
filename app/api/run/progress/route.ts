import { NextResponse } from "next/server";
import { getSupabaseAdmin, hasSupabaseConfig } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const playerId = String(body.playerId ?? "");
  const runId = String(body.runId ?? "");
  const distance = Math.max(0, Number(body.distance ?? 0));
  const questionsPassed = Math.max(0, Math.floor(Number(body.questionsPassed ?? 0)));

  if (!playerId || !runId) return NextResponse.json({ error: "Missing run identifiers" }, { status: 400 });
  if (!hasSupabaseConfig()) return NextResponse.json({ configured: false, ok: true });

  const supabase = getSupabaseAdmin()!;
  const { error: runError } = await supabase
    .from("runs")
    .update({ distance, questions_passed: questionsPassed, updated_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("player_id", playerId);

  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 });

  const { data: player, error: playerError } = await supabase
    .from("players")
    .select("best_distance,best_questions")
    .eq("id", playerId)
    .single();

  if (playerError) return NextResponse.json({ error: playerError.message }, { status: 500 });

  const bestDistance = Math.max(Number(player.best_distance ?? 0), distance);
  const bestQuestions = Math.max(Number(player.best_questions ?? 0), questionsPassed);

  const { error: updateError } = await supabase
    .from("players")
    .update({ best_distance: bestDistance, best_questions: bestQuestions, updated_at: new Date().toISOString() })
    .eq("id", playerId);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ configured: true, ok: true, bestDistance, bestQuestions });
}
