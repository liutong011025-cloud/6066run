import { NextResponse } from "next/server";
import { getSupabaseAdmin, hasSupabaseConfig } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const nickname = String(body.nickname ?? "").trim();

  if (!/^[A-Za-z0-9 _-]{2,20}$/.test(nickname)) {
    return NextResponse.json({ error: "Use 2–20 letters, numbers, spaces, _ or -." }, { status: 400 });
  }

  if (!hasSupabaseConfig()) {
    return NextResponse.json({ configured: false, playerId: `local:${nickname}`, nickname });
  }

  const supabase = getSupabaseAdmin()!;
  const { data: existing, error: findError } = await supabase
    .from("players")
    .select("id,nickname,best_distance,best_questions")
    .eq("nickname", nickname)
    .maybeSingle();

  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });

  if (existing) {
    return NextResponse.json({ configured: true, playerId: existing.id, ...existing });
  }

  const { data, error } = await supabase
    .from("players")
    .insert({ nickname })
    .select("id,nickname,best_distance,best_questions")
    .single();

  if (error) {
    // A simultaneous request may have inserted the same nickname.
    const { data: retry } = await supabase
      .from("players")
      .select("id,nickname,best_distance,best_questions")
      .eq("nickname", nickname)
      .maybeSingle();
    if (retry) return NextResponse.json({ configured: true, playerId: retry.id, ...retry });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ configured: true, playerId: data.id, ...data });
}
