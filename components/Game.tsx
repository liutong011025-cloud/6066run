"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QUESTIONS, QuizQuestion } from "@/lib/questions";

type Status = "lobby" | "playing" | "paused" | "failed" | "completed";
type ObstacleType = "cone" | "crate" | "hurdle" | "planter" | "bench";
type Obstacle = { lane: -1 | 0 | 1; z: number; type: ObstacleType; checked: boolean };
type Rank = { nickname: string; best_distance: number; best_questions: number };

type Runtime = {
  distance: number;
  lane: number;
  targetLane: -1 | 0 | 1;
  jumpY: number;
  jumpV: number;
  gateZ: number;
  obstacles: Obstacle[];
  questionIndex: number;
  questions: QuizQuestion[];
  lastTs: number;
  lastSync: number;
};

const ROAD_SPEED = 0.17;
const GATE_HIT_Z = 0.145;
const LOW_OBSTACLES = new Set<ObstacleType>(["cone", "crate", "hurdle"]);

function shuffleForRun(): QuizQuestion[] {
  return [...QUESTIONS]
    .sort(() => Math.random() - 0.5)
    .map((q) => {
      if (Math.random() < 0.5) return q;
      return {
        ...q,
        left: q.right,
        right: q.left,
        correct: q.correct === "left" ? "right" : "left"
      };
    });
}

function makeObstacles(): Obstacle[] {
  const types: ObstacleType[] = ["cone", "crate", "hurdle", "planter", "bench"];
  const count = 2 + Math.floor(Math.random() * 2);
  const zSlots = [0.76, 0.57, 0.39].sort(() => Math.random() - 0.5).slice(0, count).sort((a, b) => b - a);
  return zSlots.map((z, i) => ({
    z,
    lane: ([-1, 0, 1][Math.floor(Math.random() * 3)] ?? 0) as -1 | 0 | 1,
    type: types[(i + Math.floor(Math.random() * types.length)) % types.length],
    checked: false
  }));
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function localRanks(): Rank[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("ai-run-local-leaderboard") || "[]"); } catch { return []; }
}

function updateLocalRank(nickname: string, distance: number, questions: number) {
  const rows = localRanks();
  const idx = rows.findIndex((r) => r.nickname === nickname);
  const next: Rank = {
    nickname,
    best_distance: Math.max(distance, idx >= 0 ? rows[idx].best_distance : 0),
    best_questions: Math.max(questions, idx >= 0 ? rows[idx].best_questions : 0)
  };
  if (idx >= 0) rows[idx] = next; else rows.push(next);
  rows.sort((a, b) => b.best_distance - a.best_distance || b.best_questions - a.best_questions);
  localStorage.setItem("ai-run-local-leaderboard", JSON.stringify(rows.slice(0, 20)));
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  const lines: string[] = [];
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  lines.slice(0, 4).forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<Runtime>({
    distance: 0, lane: 0, targetLane: 0, jumpY: 0, jumpV: 0, gateZ: 0.92,
    obstacles: makeObstacles(), questionIndex: 0, questions: shuffleForRun(), lastTs: 0, lastSync: 0
  });
  const statusRef = useRef<Status>("lobby");
  const nicknameRef = useRef("");
  const playerIdRef = useRef("");
  const runIdRef = useRef("");
  const dbConfiguredRef = useRef(false);

  const [status, setStatus] = useState<Status>("lobby");
  const [nickname, setNickname] = useState("");
  const [question, setQuestion] = useState<QuizQuestion>(runtimeRef.current.questions[0]);
  const [questionNo, setQuestionNo] = useState(1);
  const [distance, setDistance] = useState(0);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [dbConfigured, setDbConfigured] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [failure, setFailure] = useState<{ title: string; detail: string; q: QuizQuestion } | null>(null);

  const correctAnswer = useMemo(() => question.correct === "left" ? question.left : question.right, [question]);

  const setGameStatus = useCallback((s: Status) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const syncProgress = useCallback(async (force = false) => {
    const rt = runtimeRef.current;
    const nicknameNow = nicknameRef.current;
    if (!nicknameNow) return;
    updateLocalRank(nicknameNow, rt.distance, rt.questionIndex);
    if (!dbConfiguredRef.current || !playerIdRef.current || !runIdRef.current) {
      setRanks(localRanks());
      return;
    }
    const now = performance.now();
    if (!force && now - rt.lastSync < 1900) return;
    rt.lastSync = now;
    fetch("/api/run/progress", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: playerIdRef.current, runId: runIdRef.current, distance: rt.distance, questionsPassed: rt.questionIndex })
    }).catch(() => {});
  }, []);

  const refreshRanks = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      const json = await res.json();
      if (json.configured) {
        dbConfiguredRef.current = true; setDbConfigured(true); setRanks(json.rows || []);
      } else {
        dbConfiguredRef.current = false; setDbConfigured(false); setRanks(localRanks());
      }
    } catch {
      setRanks(localRanks());
    }
  }, []);

  useEffect(() => {
    refreshRanks();
    const timer = setInterval(refreshRanks, 2000);
    return () => clearInterval(timer);
  }, [refreshRanks]);

  const finishRun = useCallback(async (kind: "failed" | "completed", title: string, detail: string) => {
    const rt = runtimeRef.current;
    setGameStatus(kind === "completed" ? "completed" : "failed");
    const q = rt.questions[Math.min(rt.questionIndex, rt.questions.length - 1)];
    setFailure({ title, detail, q });
    updateLocalRank(nicknameRef.current, rt.distance, rt.questionIndex);
    if (dbConfiguredRef.current && playerIdRef.current && runIdRef.current) {
      fetch("/api/run/finish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerIdRef.current, runId: runIdRef.current, status: kind, distance: rt.distance, questionsPassed: rt.questionIndex })
      }).catch(() => {});
    }
    refreshRanks();
  }, [refreshRanks, setGameStatus]);

  const startFreshRun = useCallback(async () => {
    const questions = shuffleForRun();
    runtimeRef.current = {
      distance: 0, lane: 0, targetLane: 0, jumpY: 0, jumpV: 0, gateZ: 0.92,
      obstacles: makeObstacles(), questionIndex: 0, questions, lastTs: 0, lastSync: 0
    };
    setQuestion(questions[0]); setQuestionNo(1); setDistance(0); setFailure(null);

    if (dbConfiguredRef.current && playerIdRef.current) {
      try {
        const res = await fetch("/api/run/start", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: playerIdRef.current })
        });
        const json = await res.json();
        runIdRef.current = json.runId || "";
      } catch { runIdRef.current = ""; }
    } else runIdRef.current = `local-run:${Date.now()}`;

    setGameStatus("playing");
  }, [setGameStatus]);

  async function joinGame(e: FormEvent) {
    e.preventDefault();
    setJoinError("");
    const clean = nickname.trim();
    if (!/^[A-Za-z0-9 _-]{2,20}$/.test(clean)) {
      setJoinError("Use 2–20 letters, numbers, spaces, _ or -."); return;
    }
    nicknameRef.current = clean;
    try {
      const res = await fetch("/api/player", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: clean })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not join.");
      playerIdRef.current = json.playerId;
      dbConfiguredRef.current = Boolean(json.configured);
      setDbConfigured(Boolean(json.configured));
    } catch (err) {
      playerIdRef.current = `local:${clean}`; dbConfiguredRef.current = false; setDbConfigured(false);
    }
    await startFreshRun();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") e.preventDefault();
      const rt = runtimeRef.current;
      if (statusRef.current === "playing") {
        if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") rt.targetLane = Math.max(-1, rt.targetLane - 1) as -1 | 0 | 1;
        if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") rt.targetLane = Math.min(1, rt.targetLane + 1) as -1 | 0 | 1;
        if ((e.code === "Space" || e.key === "ArrowUp") && rt.jumpY <= 0.001) rt.jumpV = 2.25;
        if (e.key.toLowerCase() === "p") setGameStatus("paused");
      } else if (statusRef.current === "paused" && e.key.toLowerCase() === "p") setGameStatus("playing");
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [setGameStatus]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas!.clientWidth, h = canvas!.clientHeight;
      canvas!.width = Math.max(1, Math.floor(w * dpr));
      canvas!.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }
    resize();
    window.addEventListener("resize", resize);

    function laneX(lane: number, y: number, w: number, h: number) {
      const horizon = Math.max(150, h * 0.23);
      const t = clamp((y - horizon) / (h - horizon), 0, 1);
      const half = 64 + t * (w * 0.42 - 64);
      return w / 2 + lane * half * 0.55;
    }

    function roadY(z: number, h: number) {
      const horizon = Math.max(150, h * 0.23);
      return horizon + Math.pow(1 - clamp(z, 0, 1), 1.55) * (h - horizon);
    }

    function drawPixelRect(x: number, y: number, w: number, h: number, fill: string, stroke = "#173f35", line = 3) {
      ctx.fillStyle = fill; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
      if (line) { ctx.strokeStyle = stroke; ctx.lineWidth = line; ctx.strokeRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
    }

    function drawCampus(w: number, h: number, dist: number) {
      ctx.fillStyle = "#9fdcf1"; ctx.fillRect(0, 0, w, h);
      // pixel sun
      drawPixelRect(w * .78, 48, 58, 58, "#ffd76b", "#e69a39", 4);
      // mountains
      ctx.fillStyle = "#7fb794";
      ctx.beginPath(); ctx.moveTo(0, h * .28); ctx.lineTo(w * .16, h * .15); ctx.lineTo(w * .31, h * .28); ctx.lineTo(w * .47, h * .14); ctx.lineTo(w * .62, h * .29); ctx.lineTo(w * .8, h * .17); ctx.lineTo(w, h * .29); ctx.lineTo(w, h * .39); ctx.lineTo(0, h * .39); ctx.fill();
      // campus blocks
      const horizon = Math.max(150, h * .23);
      drawPixelRect(w * .07, horizon - 60, w * .2, 78, "#efe1bd", "#356254", 4);
      drawPixelRect(w * .73, horizon - 72, w * .19, 90, "#f3e6c7", "#356254", 4);
      for (let i = 0; i < 5; i++) {
        drawPixelRect(w * .09 + i * 24, horizon - 40, 12, 15, "#7fb8bb", "#356254", 2);
        drawPixelRect(w * .75 + i * 22, horizon - 48, 11, 14, "#7fb8bb", "#356254", 2);
      }
      drawPixelRect(w * .41, horizon - 45, w * .18, 58, "#f08b38", "#8d4e20", 4);
      ctx.fillStyle = "#fff7df"; ctx.font = "bold 12px Courier New"; ctx.textAlign = "center"; ctx.fillText("CAMPUS", w * .5, horizon - 12);
      // trees
      for (let i = 0; i < 5; i++) {
        const xL = 30 + i * 72, xR = w - 40 - i * 72;
        drawPixelRect(xL, horizon - 30, 9, 35, "#80572f", "#5c4329", 2);
        drawPixelRect(xL - 14, horizon - 52, 37, 31, i % 2 ? "#2d875d" : "#3c9c65", "#1d6948", 2);
        drawPixelRect(xR, horizon - 32, 9, 37, "#80572f", "#5c4329", 2);
        drawPixelRect(xR - 14, horizon - 56, 38, 33, i % 2 ? "#3c9c65" : "#2d875d", "#1d6948", 2);
      }
      // grass
      ctx.fillStyle = "#5eaa65"; ctx.fillRect(0, horizon, w, h - horizon);
      // road trapezoid
      ctx.fillStyle = "#c9b68d"; ctx.beginPath(); ctx.moveTo(w/2 - 65, horizon); ctx.lineTo(w/2 + 65, horizon); ctx.lineTo(w*.94, h); ctx.lineTo(w*.06, h); ctx.closePath(); ctx.fill();
      // lane markers + moving road pixels
      ctx.strokeStyle = "#f7edd4"; ctx.lineWidth = 3; ctx.setLineDash([12, 15]);
      for (const lane of [-0.5, 0.5]) { ctx.beginPath(); ctx.moveTo(laneX(lane, horizon, w, h), horizon); ctx.lineTo(laneX(lane, h, w, h), h); ctx.stroke(); }
      ctx.setLineDash([]);
      for (let i=0;i<12;i++) {
        const phase = ((i / 12 + (dist % 18) / 18) % 1);
        const y = horizon + phase * (h - horizon);
        const width = 3 + phase * 8;
        ctx.fillStyle = "rgba(126,94,62,.22)"; ctx.fillRect(w/2 - width/2, y, width, 5 + phase*9);
      }
    }

    function drawObstacle(o: Obstacle, w: number, h: number) {
      const y = roadY(o.z, h); const x = laneX(o.lane, y, w, h); const s = .28 + (1 - o.z) * 1.15;
      if (o.type === "cone") {
        ctx.fillStyle = "#ef772e"; ctx.beginPath(); ctx.moveTo(x, y - 30*s); ctx.lineTo(x-15*s, y); ctx.lineTo(x+15*s, y); ctx.fill();
        drawPixelRect(x-18*s, y, 36*s, 7*s, "#fff4c8", "#70421e", Math.max(1,2*s));
      } else if (o.type === "crate") {
        drawPixelRect(x-22*s, y-35*s, 44*s, 35*s, "#b8753c", "#6b4229", Math.max(1,3*s));
        ctx.strokeStyle="#70452a";ctx.lineWidth=Math.max(1,2*s);ctx.beginPath();ctx.moveTo(x-18*s,y-30*s);ctx.lineTo(x+18*s,y-5*s);ctx.moveTo(x+18*s,y-30*s);ctx.lineTo(x-18*s,y-5*s);ctx.stroke();
      } else if (o.type === "hurdle") {
        drawPixelRect(x-28*s, y-30*s, 56*s, 9*s, "#f3e5bd", "#386354", Math.max(1,2*s));
        drawPixelRect(x-24*s, y-23*s, 6*s, 23*s, "#386354", "#386354", 0); drawPixelRect(x+18*s, y-23*s, 6*s, 23*s, "#386354", "#386354", 0);
      } else if (o.type === "planter") {
        drawPixelRect(x-28*s, y-48*s, 56*s, 48*s, "#a66543", "#5b3a2a", Math.max(1,3*s));
        drawPixelRect(x-24*s, y-62*s, 48*s, 20*s, "#3d9562", "#226447", Math.max(1,2*s));
      } else {
        drawPixelRect(x-34*s, y-24*s, 68*s, 10*s, "#99633c", "#5d3d28", Math.max(1,2*s));
        drawPixelRect(x-28*s, y-14*s, 6*s, 14*s, "#5d3d28", "#5d3d28", 0); drawPixelRect(x+22*s, y-14*s, 6*s, 14*s, "#5d3d28", "#5d3d28", 0);
      }
    }

    function drawGate(q: QuizQuestion, z: number, w: number, h: number) {
      if (z > .72) return;
      const y = roadY(z, h); const scale = .28 + (1-z)*1.03; const center = w/2;
      const roadHalf = Math.max(72, (y - Math.max(150,h*.23))/(h-Math.max(150,h*.23))*w*.38 + 62);
      const panelW = Math.max(70, roadHalf*.78); const panelH = 80*scale;
      const leftX = center - roadHalf*.55 - panelW/2; const rightX = center + roadHalf*.55 - panelW/2;
      for (const [x,text] of [[leftX,q.left],[rightX,q.right]] as const) {
        ctx.fillStyle = "rgba(190,242,249,.58)"; ctx.fillRect(x, y-panelH, panelW, panelH);
        ctx.strokeStyle = "#e8ffff"; ctx.lineWidth = Math.max(2,4*scale); ctx.strokeRect(x, y-panelH, panelW, panelH);
        ctx.strokeStyle = "rgba(77,145,154,.7)"; ctx.lineWidth = Math.max(1,2*scale); ctx.beginPath(); ctx.moveTo(x+6,y-panelH+6);ctx.lineTo(x+panelW-6,y-6);ctx.moveTo(x+panelW-12,y-panelH+8);ctx.lineTo(x+10,y-8);ctx.stroke();
        ctx.fillStyle = "#113f3b"; ctx.font = `bold ${Math.max(10,12*scale)}px Arial`; ctx.textAlign="center"; ctx.textBaseline="middle";
        wrapCanvasText(ctx, text, x+panelW/2, y-panelH/2-10*scale, panelW-16, Math.max(12,15*scale));
      }
      drawPixelRect(center-5*scale, y-panelH-18*scale, 10*scale, panelH+18*scale, "#315c52", "#23483f", Math.max(1,2*scale));
    }

    function drawRunner(rt: Runtime, w: number, h: number) {
      const baseY = h*.82 - rt.jumpY*85; const x = laneX(rt.lane, h*.82, w, h); const bounce = statusRef.current === "playing" ? Math.sin(rt.distance*.8)*2 : 0;
      // shadow
      ctx.fillStyle="rgba(30,55,45,.22)";ctx.fillRect(x-18,h*.82+27,36,7);
      // legs
      drawPixelRect(x-12, baseY+18+bounce, 9, 22, "#284d70", "#14334e", 2); drawPixelRect(x+3, baseY+18-bounce, 9, 22, "#284d70", "#14334e", 2);
      // shoes
      drawPixelRect(x-15, baseY+37+bounce, 13, 7, "#fff0c7", "#47392a", 2); drawPixelRect(x+2, baseY+37-bounce, 13, 7, "#fff0c7", "#47392a", 2);
      // body + backpack
      drawPixelRect(x-18, baseY-12, 36, 34, "#f08b38", "#5a3b25", 3); drawPixelRect(x-24, baseY-8, 9, 25, "#1f7655", "#164a3b", 2);
      // head
      drawPixelRect(x-14, baseY-38, 28, 27, "#d89c70", "#5a3b25", 3); drawPixelRect(x-16, baseY-43, 32, 9, "#2d4c3f", "#1a332c", 2);
      // arms
      drawPixelRect(x-25, baseY-7+bounce, 8, 22, "#d89c70", "#5a3b25", 2); drawPixelRect(x+17, baseY-7-bounce, 8, 22, "#d89c70", "#5a3b25", 2);
    }

    function drawFrame() {
      const w = canvas!.clientWidth, h = canvas!.clientHeight, rt = runtimeRef.current;
      drawCampus(w,h,rt.distance);
      rt.obstacles.filter(o=>o.z>-0.04).sort((a,b)=>b.z-a.z).forEach(o=>drawObstacle(o,w,h));
      drawGate(rt.questions[rt.questionIndex] ?? rt.questions[rt.questions.length-1], rt.gateZ, w,h);
      drawRunner(rt,w,h);
    }

    function tick(ts: number) {
      const rt = runtimeRef.current;
      const dt = rt.lastTs ? clamp((ts - rt.lastTs)/1000,0,.04) : 0;
      rt.lastTs = ts;
      if (statusRef.current === "playing") {
        rt.distance += dt * 9.4;
        rt.gateZ -= dt * ROAD_SPEED;
        rt.lane += (rt.targetLane - rt.lane) * Math.min(1, dt*10);
        rt.jumpV -= dt * 5.3; rt.jumpY += rt.jumpV * dt;
        if (rt.jumpY < 0) { rt.jumpY = 0; rt.jumpV = 0; }
        rt.obstacles.forEach(o => o.z -= dt*ROAD_SPEED);

        for (const o of rt.obstacles) {
          if (!o.checked && o.z <= .17) {
            o.checked = true;
            const sameLane = Math.abs(rt.lane - o.lane) < .42;
            const canJump = LOW_OBSTACLES.has(o.type);
            if (sameLane && (!canJump || rt.jumpY < .34)) {
              finishRun("failed", "Obstacle hit", `You collided with a ${o.type}.`).catch(()=>{});
              break;
            }
          }
        }

        if (statusRef.current === "playing" && rt.gateZ <= GATE_HIT_Z) {
          const q = rt.questions[rt.questionIndex];
          const side = rt.lane < -.28 ? "left" : rt.lane > .28 ? "right" : "middle";
          if (side === "middle") {
            finishRun("failed", "No answer selected", "Move fully left or right before reaching the glass panels.").catch(()=>{});
          } else if (side !== q.correct) {
            finishRun("failed", "Wrong answer — the glass broke", `You chose: ${side === "left" ? q.left : q.right}`).catch(()=>{});
          } else {
            rt.questionIndex += 1;
            if (rt.questionIndex >= rt.questions.length) {
              rt.distance += 20;
              finishRun("completed", "Course complete!", "You cleared all 40 AI knowledge gates.").catch(()=>{});
            } else {
              rt.gateZ = .92; rt.obstacles = makeObstacles();
              setQuestion(rt.questions[rt.questionIndex]); setQuestionNo(rt.questionIndex+1);
              syncProgress(true).catch(()=>{});
            }
          }
        }
        setDistance(rt.distance);
        syncProgress(false).catch(()=>{});
      }
      drawFrame();
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [finishRun, syncProgress]);

  return (
    <main className="game-shell">
      <canvas ref={canvasRef} className="game-canvas" aria-label="AI Knowledge Run game" />

      {status !== "lobby" && (
        <>
          <section className="question-panel pixel-panel">
            <div className="question-kicker"><span>AI KNOWLEDGE GATE {questionNo}/40</span><span>{Math.floor(distance)} m</span></div>
            <div className="question-text">{question.prompt}</div>
          </section>
          <div className="status-chip">{nicknameRef.current || nickname} · BEST RUN SAVES</div>
          <div className="controls">← / A &nbsp; MOVE LEFT<br/>→ / D &nbsp; MOVE RIGHT<br/>SPACE / ↑ &nbsp; JUMP<br/>P &nbsp; PAUSE</div>
          <aside className="leaderboard pixel-panel">
            <h3>LIVE RANKING</h3>
            {ranks.length === 0 ? <div className="rank-row"><span>—</span><span>No runs yet</span><span>0 m</span></div> : ranks.slice(0,8).map((r,i)=>(
              <div className="rank-row" key={`${r.nickname}-${i}`}><span>#{i+1}</span><span>{r.nickname}</span><span className="rank-distance">{Math.floor(r.best_distance)}m</span></div>
            ))}
            {!dbConfigured && <div className="rank-local">LOCAL MODE · Add Supabase env vars for a shared ranking.</div>}
          </aside>
        </>
      )}

      {status === "lobby" && (
        <div className="lobby">
          <form className="lobby-card pixel-panel" onSubmit={joinGame}>
            <h1>AI KNOWLEDGE RUN</h1>
            <p>Choose a nickname. Run through 40 AI knowledge gates, dodge campus obstacles, and stay on the correct glass panel.</p>
            <div className="name-form">
              <input className="name-input" value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Nickname" autoFocus maxLength={20}/>
              <button className="pixel-button" type="submit">JOIN & RUN</button>
            </div>
            <div className="error-text">{joinError}</div>
          </form>
        </div>
      )}

      {status === "paused" && (
        <div className="modal-backdrop"><div className="modal-card pixel-panel"><h2>PAUSED</h2><p className="explanation">Press P to continue.</p></div></div>
      )}

      {(status === "failed" || status === "completed") && failure && (
        <div className="modal-backdrop">
          <div className="modal-card pixel-panel">
            <h2>{failure.title}</h2>
            <p className="explanation">{failure.detail}</p>
            <div className="answer-line">Correct answer: {failure.q.correct === "left" ? failure.q.left : failure.q.right}</div>
            <p className="explanation">{failure.q.explanation}</p>
            <p className="explanation"><strong>Your run:</strong> {Math.floor(runtimeRef.current.distance)} m · {runtimeRef.current.questionIndex} gates cleared.</p>
            <div className="modal-actions"><button className="pixel-button secondary" onClick={startFreshRun}>START AGAIN FROM 0</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
