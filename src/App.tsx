import { useState, useEffect, useRef, Dispatch, SetStateAction } from "react";
import { GoogleGenAI } from "@google/genai";

// Gemini API 초기화 (환경 변수에서 키를 안전하게 가져옵니다)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const COLORS = {
  bg: "#0d0d18",
  s1: "#13131f",
  s2: "#1a1a28",
  s3: "#222235",
  border: "#2e2e48",
  borderLight: "#3a3a58",
  // 핵심 색상 - 채도/명도 높임
  y: "#ffe94d",      // 노란색 유지
  r: "#ff6b6b",      // 빨간 → 더 밝게
  b: "#5cc8f5",      // 파란 → 더 밝게
  g: "#4ded9e",      // 초록 → 더 밝게
  o: "#ffb347",      // 주황 → 더 밝게
  // 텍스트 - 대비 대폭 강화
  text: "#f0f0fc",        // 기본 텍스트 (거의 흰색)
  textSub: "#b8b8d8",     // 보조 텍스트 (기존 muted보다 훨씬 밝음)
  muted: "#8080aa",       // 흐린 텍스트
  dim: "#4a4a6a",         // 매우 흐린
};

const CAT_COLOR: Record<string, string> = { 업무: COLORS.r, 개인: COLORS.b, 건강: COLORS.g, 기타: COLORS.muted };
const CAT_EMOJI: Record<string, string> = { 업무: "💼", 개인: "🏠", 건강: "🏃", 기타: "📌" };

const STATES = [
  { id: "focus", label: "🟢 집중 가능", color: COLORS.g },
  { id: "tired", label: "🟡 좀 피곤", color: COLORS.o },
  { id: "burnout", label: "🔴 번아웃", color: COLORS.r },
];

function useStorage<T>(key: string, init: T): [T, Dispatch<SetStateAction<T>>] {
  const [val, setVal] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init; } catch { return init; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }, [key, val]);
  return [val, setVal];
}

// Gemini 호출 함수로 변경
async function callGemini(prompt: string, isJson: boolean = false) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: isJson ? "application/json" : "text/plain",
      },
    });
    return response.text || "";
  } catch (e) {
    console.error("AI Call Error:", e);
    throw e;
  }
}

interface Task {
  id: number;
  name: string;
  category: string;
  deadline: string | null;
  completed: boolean;
  order: number;
  sorted: boolean;
  steps: { text: string; done: boolean }[];
  showSteps: boolean;
  focusAction?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  time: string;
}

interface HistoryItem {
  name: string;
  time: string;
  cat: string;
}

export default function App() {
  const [tasks, setTasks] = useStorage<Task[]>("fv2-tasks", []);
  const [history, setHistory] = useStorage<HistoryItem[]>("fv2-history", []);
  const [chat, setChat] = useStorage<ChatMessage[]>("fv2-chat", []);
  const [myState, setMyState] = useStorage<string>("fv2-state", "focus");

  const [taskInput, setTaskInput] = useState("");
  const [catInput, setCatInput] = useState("업무");
  const [deadlineInput, setDeadlineInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [loading, setLoading] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [time, setTime] = useState(new Date());

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const pending = tasks.filter(t => !t.completed).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const completed = tasks.filter(t => t.completed);
  const topTask = pending[0];
  const pct = tasks.length ? Math.round(completed.length / tasks.length * 100) : 0;

  function addTask() {
    if (!taskInput.trim()) return;
    setTasks(prev => [...prev, {
      id: Date.now(), name: taskInput.trim(), category: catInput,
      deadline: deadlineInput || null, completed: false,
      order: 99, sorted: false, steps: [], showSteps: false,
    }]);
    setTaskInput(""); setDeadlineInput("");
  }

  function toggleTask(id: number) {
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t;
      if (!t.completed) {
        setHistory(h => [{ name: t.name, time: time.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }), cat: t.category }, ...h.slice(0, 19)]);
      }
      return { ...t, completed: !t.completed };
    }));
  }

  function deleteTask(id: number) {
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  function toggleSteps(id: number) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, showSteps: !t.showSteps } : t));
  }

  function toggleStep(taskId: number, si: number) {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const steps = t.steps.map((s, i) => i === si ? { ...s, done: !s.done } : s);
      return { ...t, steps };
    }));
  }

  async function aiSort() {
    if (!pending.length) return;
    setLoading("sort");
    const now = new Date();
    const stateLabel = STATES.find(s => s.id === myState)?.label || "";
    const list = pending.map((t, i) => {
      const dl = t.deadline ? `마감: ${new Date(t.deadline).toLocaleString("ko-KR")}` : "마감 없음";
      return `${i + 1}. [${t.category}] ${t.name} (${dl})`;
    }).join("\n");

    const prompt = `현재 시각: ${now.toLocaleString("ko-KR")}
현재 내 상태: ${stateLabel}

할 일 목록:
${list}

성인 ADHD를 가진 직장인을 위해 우선순위를 정해주세요.
다음 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"order":[원래번호순서배열],"reason":"한 문장 조언","focus":"지금 당장 할 행동 한 문장"}

예: {"order":[3,1,2],"reason":"마감 임박한 것부터","focus":"고객에게 먼저 전화하세요"}`;

    try {
      // Gemini 호출 (JSON 모드)
      const raw = await callGemini(prompt, true);
      const parsed = JSON.parse(raw);
      const orderArr = parsed.order;
      setTasks(prev => prev.map(t => {
        const idx = pending.findIndex(p => p.id === t.id);
        if (idx === -1) return t;
        const newOrder = orderArr.indexOf(idx + 1);
        return { ...t, order: newOrder === -1 ? 99 : newOrder + 1, sorted: true, focusAction: newOrder === 0 ? parsed.focus : undefined };
      }));
      setChat(prev => [...prev, {
        role: "assistant", text: `✦ 정렬 완료!\n\n${parsed.reason}\n\n▶ 지금 당장: ${parsed.focus}`, time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
      }]);
      setTab("dashboard");
    } catch (e) {
      setChat(prev => [...prev, { role: "assistant", text: "정렬 중 오류가 발생했어요. 다시 시도해주세요.", time: "" }]);
    }
    setLoading("");
  }

  async function breakTask(task: Task) {
    setLoading("break-" + task.id);
    const prompt = `업무: "${task.name}"
카테고리: ${task.category}

이 업무를 시작하기 막막한 성인 ADHD 직장인을 위해 구체적인 실행 단계로 쪼개주세요.
3~5단계로, 각 단계는 5분~15분 안에 할 수 있는 크기로요.

JSON만 응답: {"steps":["단계1","단계2","단계3"]}`;

    try {
      // Gemini 호출 (JSON 모드)
      const raw = await callGemini(prompt, true);
      const parsed = JSON.parse(raw);
      setTasks(prev => prev.map(t => t.id === task.id
        ? { ...t, steps: parsed.steps.map((s: string) => ({ text: s, done: false })), showSteps: true }
        : t));
    } catch (e) {
        console.error(e);
    }
    setLoading("");
  }

  async function sendChat() {
    const msg = chatInput.trim();
    if (!msg || loading) return;
    setChatInput("");
    const userMsg: ChatMessage = { role: "user", text: msg, time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) };
    setChat(prev => [...prev, userMsg]);
    setLoading("chat");

    const stateLabel = STATES.find(s => s.id === myState)?.label || "";
    const taskSummary = pending.slice(0, 5).map((t, i) => `${i + 1}. [${t.category}] ${t.name}`).join("\n") || "없음";
    const prompt = `당신은 성인 ADHD를 가진 직장인의 AI 업무 코치입니다.
현재 사용자 상태: ${stateLabel}
현재 할 일 목록: ${taskSummary}

사용자 질문: ${msg}

짧고 명확하게 답해주세요. 판단 피로를 줄이는 방향으로, 다음 행동 하나를 명확히 제시해주세요.`;

    try {
      // Gemini 호출 (일반 텍스트 모드)
      const reply = await callGemini(prompt, false);
      setChat(prev => [...prev, { role: "assistant", text: reply, time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) }]);
    } catch {
      setChat(prev => [...prev, { role: "assistant", text: "오류가 발생했어요. 다시 시도해주세요.", time: "" }]);
    }
    setLoading("");
  }

  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", color: COLORS.text, fontFamily: "'Noto Sans KR', sans-serif", display: "flex", flexDirection: "column" }}>

      {/* Top Bar */}
      <div style={{ background: COLORS.s1, borderBottom: `1px solid ${COLORS.border}`, padding: "10px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ fontFamily: "'Syne', var(--font-sans)", fontSize: 18, fontWeight: 800, color: COLORS.y, letterSpacing: -0.5 }}>
          FOCUS <span style={{ fontSize: 10, color: COLORS.muted, fontWeight: 400 }}>AI 업무코치</span>
        </div>

        {/* State pills */}
        <div style={{ display: "flex", gap: 6, marginLeft: 12 }}>
          {STATES.map(st => (
            <button key={st.id} onClick={() => setMyState(st.id)} style={{
              padding: "4px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer", border: "1px solid",
              background: myState === st.id ? st.color + "28" : "transparent",
              borderColor: myState === st.id ? st.color : COLORS.borderLight,
              color: myState === st.id ? st.color : COLORS.textSub,  // ← 밝게
              transition: "all 0.15s", fontFamily: "inherit", fontWeight: myState === st.id ? 600 : 400,
            }}>{st.label}</button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {["dashboard", "chat"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "5px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid",
              background: tab === t ? COLORS.y + "20" : "transparent",
              borderColor: tab === t ? COLORS.y : COLORS.borderLight,
              color: tab === t ? COLORS.y : COLORS.textSub,  // ← 밝게
              fontFamily: "inherit", fontWeight: tab === t ? 600 : 400,
            }}>{t === "dashboard" ? "📋 대시보드" : "💬 AI 코치"}</button>
          ))}
        </div>

        <div style={{ fontFamily: "monospace", fontSize: 12, color: COLORS.textSub }}>
          {time.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>

        {tab === "dashboard" ? (
          <div style={{ flex: 1, overflow: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Stats Row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
              {[
                { n: tasks.length, l: "전체", c: COLORS.text },
                { n: pending.length, l: "남은 것", c: COLORS.y },
                { n: completed.length, l: "완료", c: COLORS.g },
                { n: pct + "%", l: "달성률", c: COLORS.b },
              ].map(({ n, l, c }) => (
                <div key={l} style={{ background: COLORS.s2, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: c, lineHeight: 1, marginBottom: 6 }}>{n}</div>
                  <div style={{ fontSize: 12, color: COLORS.textSub, fontWeight: 500 }}>{l}</div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div style={{ height: 4, background: COLORS.border, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: pct + "%", background: COLORS.y, borderRadius: 2, transition: "width 0.5s" }} />
            </div>

            {/* Focus Hero */}
            {topTask ? (
              <div style={{ background: COLORS.y, color: "#080810", borderRadius: 14, padding: "20px 24px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", right: -20, top: -20, width: 120, height: 120, background: "rgba(0,0,0,0.08)", borderRadius: "50%" }} />
                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", opacity: 0.6, marginBottom: 6, fontFamily: "monospace" }}>지금 당장 이것만</div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3, marginBottom: 12, maxWidth: "80%", color: "#08080f" }}>
                  {topTask.focusAction || topTask.name}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, opacity: 0.7, display: "flex", gap: 12, color: "#08080f" }}>
                    <span>{CAT_EMOJI[topTask.category]} {topTask.category}</span>
                    {topTask.deadline && <span>⏰ {new Date(topTask.deadline).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
                    <span>📋 {pending.length}개 중 1번째</span>
                  </div>
                  <button onClick={() => toggleTask(topTask.id)} style={{
                    background: "rgba(0,0,0,0.18)", border: "none", borderRadius: 20, padding: "8px 18px",
                    fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#08080f",
                  }}>✓ 완료</button>
                </div>
              </div>
            ) : (
              <div style={{ background: COLORS.s2, border: `1px dashed ${COLORS.borderLight}`, borderRadius: 14, padding: 24, textAlign: "center", color: COLORS.textSub, fontSize: 14 }}>
                {tasks.length === 0 ? "✦ 할 일을 추가하고 AI 정렬을 눌러보세요" : "🎉 오늘 모든 할 일 완료!"}
              </div>
            )}

            {/* Add Task */}
            <div style={{ background: COLORS.s2, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontFamily: "monospace", color: COLORS.textSub, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12, fontWeight: 600 }}>할 일 추가</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input value={taskInput} onChange={e => setTaskInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addTask()}
                  placeholder="해야 할 일을 입력하세요..."
                  style={{ flex: 1, background: COLORS.s3, border: `1px solid ${COLORS.borderLight}`, borderRadius: 8, padding: "10px 12px", color: COLORS.text, fontSize: 14, outline: "none", fontFamily: "inherit" }} />
                <select value={catInput} onChange={e => setCatInput(e.target.value)}
                  style={{ background: COLORS.s3, border: `1px solid ${COLORS.borderLight}`, borderRadius: 8, padding: "10px 10px", color: COLORS.text, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                  {Object.keys(CAT_EMOJI).map(c => <option key={c} value={c}>{CAT_EMOJI[c]} {c}</option>)}
                </select>
                <input type="datetime-local" value={deadlineInput} onChange={e => setDeadlineInput(e.target.value)}
                  style={{ background: COLORS.s3, border: `1px solid ${COLORS.borderLight}`, borderRadius: 8, padding: "10px 10px", color: COLORS.text, fontSize: 12, outline: "none", colorScheme: "dark", width: 160 }} />
                <button onClick={addTask} style={{ background: COLORS.y, color: "#080810", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ 추가</button>
              </div>
              <button onClick={aiSort} disabled={!!loading || pending.length === 0} style={{
                width: "100%", background: "transparent", border: `1px solid ${COLORS.y}`, borderRadius: 8,
                color: COLORS.y, padding: "11px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                fontFamily: "monospace", letterSpacing: 0.5, opacity: loading ? 0.5 : 1,
              }}>
                {loading === "sort" ? "⟳ AI가 분석 중..." : "✦ AI로 지금 순서 정렬하기"}
              </button>
            </div>

            {/* Task List */}
            <div style={{ background: COLORS.s2, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontFamily: "monospace", color: COLORS.textSub, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600 }}>오늘의 할 일</div>
                <span style={{ fontSize: 12, color: COLORS.muted, fontFamily: "monospace" }}>{tasks.length}개</span>
              </div>

              {tasks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: COLORS.muted, fontSize: 13 }}>할 일을 추가해보세요 ✦</div>
              ) : (
                [...pending, ...completed].map((task, i) => {
                  const isTop = !task.completed && i === 0;
                  const isOver = task.deadline && !task.completed && new Date(task.deadline) < new Date();
                  const catColor = CAT_COLOR[task.category];
                  const isBreaking = loading === "break-" + task.id;

                  return (
                    <div key={task.id}>
                      <div onClick={() => toggleTask(task.id)} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "12px 12px",
                        borderRadius: 10, marginBottom: 4, cursor: "pointer",
                        borderLeft: `3px solid ${task.completed ? COLORS.dim : catColor}`,
                        background: isTop ? COLORS.y + "0d" : "transparent",
                        opacity: task.completed ? 0.5 : 1,
                        transition: "all 0.15s",
                      }}>
                        {/* 순서 번호 */}
                        <span style={{
                          fontFamily: "monospace", fontSize: 13,
                          color: isTop ? COLORS.y : COLORS.muted,
                          width: 22, textAlign: "center", fontWeight: isTop ? 700 : 400,
                          flexShrink: 0,
                        }}>
                          {task.completed ? "✓" : (task.sorted ? task.order : "—")}
                        </span>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* 할 일 이름 - 핵심! 크고 밝게 */}
                          <div style={{
                            fontSize: 14,
                            fontWeight: task.completed ? 400 : 500,
                            textDecoration: task.completed ? "line-through" : "none",
                            color: task.completed ? COLORS.muted : COLORS.text,  // ← 확실히 밝게
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            {task.name}
                          </div>

                          {/* 카테고리 + 마감 - 별도 줄로 분리, 색상 구분 */}
                          <div style={{ display: "flex", gap: 10, marginTop: 3, alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: catColor, fontWeight: 500 }}>
                              {CAT_EMOJI[task.category]} {task.category}
                            </span>
                            {task.deadline && (
                              <span style={{ fontSize: 11, color: isOver ? COLORS.r : COLORS.textSub, fontFamily: "monospace" }}>
                                ⏰ {new Date(task.deadline).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}{isOver ? " ⚠ 초과" : ""}
                              </span>
                            )}
                            {task.steps?.length > 0 && (
                              <span style={{ fontSize: 11, color: COLORS.b, fontWeight: 500 }}>
                                {task.steps.filter(s => s.done).length}/{task.steps.length}단계
                              </span>
                            )}
                          </div>
                        </div>

                        {!task.completed && (
                          <button onClick={e => { e.stopPropagation(); breakTask(task); }} disabled={isBreaking}
                            style={{
                              fontSize: 11, color: COLORS.b, background: COLORS.b + "15",
                              border: `1px solid ${COLORS.b}55`, borderRadius: 6, padding: "4px 10px",
                              cursor: "pointer", opacity: isBreaking ? 0.5 : 1, fontFamily: "inherit",
                              fontWeight: 500, flexShrink: 0,
                            }}>
                            {isBreaking ? "⟳" : "쪼개기"}
                          </button>
                        )}
                        {task.steps?.length > 0 && (
                          <button onClick={e => { e.stopPropagation(); toggleSteps(task.id); }}
                            style={{ fontSize: 12, color: COLORS.textSub, background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}>
                            {task.showSteps ? "▲" : "▼"}
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); deleteTask(task.id); }}
                          style={{ color: COLORS.muted, background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: "2px 4px" }}>✕</button>
                      </div>

                      {/* Sub-steps */}
                      {task.showSteps && task.steps?.length > 0 && (
                        <div style={{ marginLeft: 32, marginBottom: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                          {task.steps.map((step, si) => (
                            <div key={si} onClick={() => toggleStep(task.id, si)} style={{
                              display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                              background: COLORS.s3, borderRadius: 8, cursor: "pointer",
                              fontSize: 13,
                              color: step.done ? COLORS.muted : COLORS.textSub,  // ← 안 한 것도 밝게
                              textDecoration: step.done ? "line-through" : "none",
                            }}>
                              <span style={{ color: step.done ? COLORS.g : COLORS.muted, fontSize: 12, flexShrink: 0 }}>{step.done ? "✓" : "○"}</span>
                              {step.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* History */}
            {history.length > 0 && (
              <div style={{ background: COLORS.s2, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11, fontFamily: "monospace", color: COLORS.textSub, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14, fontWeight: 600 }}>완료 히스토리</div>
                {history.slice(0, 8).map((h, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < Math.min(history.length, 8) - 1 ? `1px solid ${COLORS.border}` : "none" }}>
                    <span style={{ color: COLORS.g, fontSize: 12 }}>✓</span>
                    <span style={{ flex: 1, fontSize: 13, color: COLORS.textSub }}>{h.name}</span>
                    <span style={{ fontSize: 11, color: COLORS.muted, fontFamily: "monospace" }}>{h.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* AI Chat Tab */
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflow: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              {chat.length === 0 && (
                <div style={{ textAlign: "center", padding: "60px 20px", color: COLORS.textSub }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>✦</div>
                  <div style={{ fontSize: 15, marginBottom: 8, color: COLORS.text, fontWeight: 500 }}>AI 업무 코치</div>
                  <div style={{ fontSize: 13, lineHeight: 2.0, color: COLORS.textSub }}>
                    막힌 업무가 있으면 물어보세요<br />
                    "이 일 어떻게 시작해?" "집중이 안 돼"<br />
                    "오늘 뭐부터 해야 해?"
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 24, maxWidth: 300, margin: "24px auto 0" }}>
                    {["오늘 할 일 큰 그림 요약해줘", "집중이 안 될 때 어떻게 해?", "번아웃인데 어떻게 시작해?"].map(q => (
                      <button key={q} onClick={() => { setChatInput(q); chatInputRef.current?.focus(); }} style={{
                        background: COLORS.s3, border: `1px solid ${COLORS.borderLight}`, borderRadius: 8,
                        padding: "11px 14px", color: COLORS.textSub, fontSize: 13, cursor: "pointer",
                        textAlign: "left", fontFamily: "inherit", transition: "all 0.15s",
                      }}>{q}</button>
                    ))}
                  </div>
                </div>
              )}

              {chat.map((msg, i) => (
                <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "78%", padding: "13px 16px",
                    borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    background: msg.role === "user" ? COLORS.y + "1a" : COLORS.s2,
                    border: `1px solid ${msg.role === "user" ? COLORS.y + "55" : COLORS.borderLight}`,
                    fontSize: 14, lineHeight: 1.8, color: COLORS.text,  // ← 채팅도 밝게
                    whiteSpace: "pre-wrap",
                  }}>
                    {msg.text}
                    {msg.time && <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 6, textAlign: "right", fontFamily: "monospace" }}>{msg.time}</div>}
                  </div>
                </div>
              ))}

              {loading === "chat" && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{ padding: "13px 16px", background: COLORS.s2, border: `1px solid ${COLORS.borderLight}`, borderRadius: "14px 14px 14px 4px", fontSize: 14, color: COLORS.textSub }}>
                    <span style={{ animation: "pulse 1s infinite" }}>● </span>
                    <span style={{ animation: "pulse 1s 0.2s infinite" }}>● </span>
                    <span style={{ animation: "pulse 1s 0.4s infinite" }}>●</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div style={{ padding: "12px 20px", borderTop: `1px solid ${COLORS.border}`, background: COLORS.s1, display: "flex", gap: 8 }}>
              <input ref={chatInputRef} value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
                placeholder="막히는 거 있으면 물어보세요..."
                style={{ flex: 1, background: COLORS.s3, border: `1px solid ${COLORS.borderLight}`, borderRadius: 10, padding: "12px 14px", color: COLORS.text, fontSize: 14, outline: "none", fontFamily: "inherit" }} />
              <button onClick={sendChat} disabled={!!loading} style={{
                background: COLORS.y, color: "#080810", border: "none", borderRadius: 10,
                padding: "12px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: loading ? 0.5 : 1,
              }}>전송</button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }
        * { scrollbar-width: thin; scrollbar-color: #2e2e48 transparent; }
        input::placeholder { color: #5a5a80 !important; }
      `}</style>
    </div>
  );
}
