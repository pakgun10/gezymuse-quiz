/* MISI GEOMETRI — frontend game */
const $ = (s) => document.querySelector(s);
const LETTERS = ["A", "B", "C", "D"];
const LS_KEY = "misiGeometri";

const store = {
  load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } },
  save(d) { localStorage.setItem(LS_KEY, JSON.stringify(d)); },
};
let S = Object.assign({ student: null, crystals: {}, best: {} }, store.load());
function persist() { store.save({ student: S.student, crystals: S.crystals, best: S.best }); }

let LEVELS = [], PASS_SCORE = 60;
let quiz = null; // {level, questions, idx, picks: {qid: answer}}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  setTimeout(() => (t.hidden = true), 2600);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Musik (WebAudio, tanpa file eksternal) ----------
const music = {
  ctx: null, timer: null, step: 0,
  notes: [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46],
  toggle() {
    if (this.timer) { this.stop(); return false; }
    this.start(); return true;
  },
  start() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx.resume();
    const play = () => {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "triangle";
      o.frequency.value = this.notes[this.step % this.notes.length];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + 0.45);
      this.step++;
    };
    play();
    this.timer = setInterval(play, 460);
  },
  stop() { clearInterval(this.timer); this.timer = null; },
};
$("#btnMusic").addEventListener("click", (e) => {
  const on = music.toggle();
  e.currentTarget.classList.toggle("on", on);
  toast(on ? "🎵 Musik nyala" : "🔇 Musik mati");
});

// ---------- Init ----------
async function init() {
  const meta = await (await fetch("/api/levels")).json();
  LEVELS = meta.levels; PASS_SCORE = meta.passScore;
  $("#fKelas").innerHTML = meta.kelas.map((k) => `<option>${esc(k)}</option>`).join("");
  $("#fAbsen").innerHTML = Array.from({ length: 40 }, (_, i) =>
    `<option value="${i + 1}">${String(i + 1).padStart(2, "0")}</option>`).join("");
  $("#wordLevel").innerHTML = LEVELS.map((l) => `<option value="${l.level}">Level ${l.level}</option>`).join("");
  if (S.student) { renderHud(); }
  show("screen-home");
}
$("#btnStart").addEventListener("click", () => {
  show(S.student ? "screen-levels" : "screen-identity");
  if (S.student) renderLevels();
});

// ---------- Identitas ----------
$("#identityForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#identityError");
  err.hidden = true;
  const payload = {
    nama: $("#fNama").value.trim(),
    kelas: $("#fKelas").value,
    absen: Number($("#fAbsen").value),
    sekolah: $("#fSekolah").value.trim(),
  };
  try {
    const r = await fetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Pendaftaran gagal.");
    S.student = data.student;
    persist(); renderHud(); renderLevels();
    show("screen-levels");
    toast(`Selamat datang, Agen ${data.student.nama.split(" ")[0]}! 🔷`);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

function renderHud() {
  const n = Object.keys(S.crystals).length;
  const total = Object.values(S.best).reduce((a, b) => a + b, 0);
  $("#hudCrystal").innerHTML = `🔷 Kristal: <b>${n}/8</b>`;
  $("#hudScore").innerHTML = `⭐ Skor: <b>${total}</b>`;
  const st = S.student;
  $("#agentTag").textContent = st ? `· ${st.nama} (${st.kelas})` : "";
}

// ---------- Peta sektor ----------
function isUnlocked(level) {
  if (level === 1) return true;
  return !!S.crystals[level - 1];
}
function renderLevels() {
  const g = $("#levelGrid");
  g.innerHTML = LEVELS.map((l) => {
    const un = isUnlocked(l.level);
    const done = !!S.crystals[l.level];
    const best = S.best[l.level];
    return `<div class="level-card ${un ? "" : "locked"} ${done ? "done" : ""}" data-lv="${l.level}">
      <div class="lv-num">SEKTOR ${l.level}</div>
      <div class="lv-icon">${un ? (done ? "🔷" : "🛰️") : "🔒"}</div>
      <h3>${esc(l.title)}</h3>
      <p>${esc(l.desc)}</p>
      ${best != null ? `<div class="lv-best">⭐ Terbaik: ${best}</div>` : ""}
    </div>`;
  }).join("");
  g.querySelectorAll(".level-card").forEach((c) =>
    c.addEventListener("click", () => {
      const lv = Number(c.dataset.lv);
      if (!isUnlocked(lv)) { toast("🔒 Selesaikan sektor sebelumnya dulu!"); return; }
      startQuiz(lv);
    }),
  );
}
$("#btnWordDl").addEventListener("click", () => {
  window.location.href = `/api/export/word?level=${$("#wordLevel").value}`;
});

// ---------- Kuis ----------
async function startQuiz(level) {
  const meta = LEVELS.find((l) => l.level === level);
  const { questions } = await (await fetch(`/api/questions?level=${level}`)).json();
  if (!questions || !questions.length) { toast("Soal belum tersedia."); return; }
  quiz = { level, meta, questions, idx: 0, picks: {} };
  $("#quizTitle").textContent = `SEKTOR ${level} — ${meta.title.toUpperCase()}`;
  renderQ();
  show("screen-quiz");
}
function renderQ() {
  const q = quiz.questions[quiz.idx];
  $("#qNum").textContent = `Soal ${quiz.idx + 1}/${quiz.questions.length}`;
  $("#quizProgress").textContent = `${Object.keys(quiz.picks).length} terjawab`;
  $("#qText").textContent = q.q;
  const iw = $("#qImgWrap");
  if (q.imageUrl) { $("#qImg").src = q.imageUrl; iw.hidden = false; }
  else { iw.hidden = true; $("#qImg").removeAttribute("src"); }
  $("#qOpts").innerHTML = q.options.map((o, i) => `
    <button class="q-opt ${quiz.picks[q.id] === i ? "selected" : ""}" data-i="${i}">
      <span class="letter">${LETTERS[i]}</span><span>${esc(o)}</span>
    </button>`).join("");
  $("#qOpts").querySelectorAll(".q-opt").forEach((b) =>
    b.addEventListener("click", () => {
      quiz.picks[q.id] = Number(b.dataset.i);
      renderQ();
    }),
  );
  const last = quiz.idx === quiz.questions.length - 1;
  const btn = $("#btnNextQ");
  btn.disabled = quiz.picks[q.id] == null;
  btn.textContent = last ? "🏁 Kumpulkan Jawaban" : "Lanjut ➜";
}
$("#btnNextQ").addEventListener("click", async () => {
  if (quiz.idx < quiz.questions.length - 1) { quiz.idx++; renderQ(); return; }
  // Kumpulkan
  const answers = Object.entries(quiz.picks).map(([question_id, answer]) => ({
    question_id: Number(question_id), answer,
  }));
  const btn = $("#btnNextQ");
  btn.disabled = true; btn.textContent = "⏳ Memeriksa…";
  try {
    const r = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: S.student.id, level: quiz.level, answers }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Gagal mengumpulkan.");
    showResult(data);
  } catch (ex) {
    toast(ex.message);
    btn.disabled = false; btn.textContent = "🏁 Kumpulkan Jawaban";
  }
});
$("#btnQuitQuiz").addEventListener("click", () => {
  if (confirm("Keluar dari sektor? Progres soal ini hilang.")) { renderLevels(); show("screen-levels"); }
});

// ---------- Hasil ----------
function showResult(data) {
  const lv = quiz.level;
  if (data.crystal) S.crystals[lv] = true;
  S.best[lv] = Math.max(S.best[lv] || 0, data.score);
  persist(); renderHud();

  $("#crystalAnim").hidden = !data.crystal;
  $("#resultTitle").textContent = data.crystal ? "🔷 KRISTAL DIREBUT!" : "💪 BELUM BERHASIL";
  $("#resultScore").textContent = data.score;
  $("#resultDetail").textContent =
    `${data.correct} dari ${data.total} jawaban benar. ` +
    (data.crystal ? `Sektor ${lv + 1} telah terbuka!` : `Butuh skor ≥ ${data.passScore} untuk merebut kristal. Coba lagi!`);
  $("#reviewList").innerHTML = data.details.map((d, i) => `
    <div class="review-item ${d.correct ? "ok" : "no"}">
      <div class="rv-head">${d.correct ? "✅" : "❌"} Soal ${i + 1}</div>
      <div>${esc(d.q)}</div>
      ${d.imageUrl ? `<div class="rv-img-wrap"><img class="q-img" src="${d.imageUrl}" alt="Gambar soal ${i + 1}" loading="lazy" /></div>` : ""}
      <div>Jawabanmu: <b>${d.answer >= 0 ? LETTERS[d.answer] : "—"}</b> · Kunci: <b>${LETTERS[d.correctAnswer]}</b></div>
      ${d.explainImageUrl ? `<div class="rv-img-wrap"><img class="q-img" src="${d.explainImageUrl}" alt="Pembahasan bergambar soal ${i + 1}" loading="lazy" /></div>` : ""}
      <div class="rv-exp">💡 ${esc(d.explain)}</div>
    </div>`).join("");

  const next = $("#btnNextLevel");
  const hasNext = lv < 8 && data.crystal;
  next.hidden = !hasNext;
  if (hasNext) next.onclick = () => startQuiz(lv + 1);

  const st = S.student;
  const txt = `🔷 MISI GEOMETRI: ${st.nama} (${st.kelas}) meraih skor ${data.score}/100 di Sektor ${lv}! ${data.crystal ? "Kristal direbut! 🏆" : "Ayo coba lagi!"}`;
  $("#btnShareWA").href = `https://wa.me/?text=${encodeURIComponent(txt)}`;

  show("screen-result");
}
$("#btnBackLevels").addEventListener("click", () => { renderLevels(); show("screen-levels"); });

// ---------- Daftar Nilai ----------
let boardTimer = null, boardTab = "total";
async function loadBoard() {
  const url = boardTab === "total" ? "/api/leaderboard" : `/api/leaderboard?level=${boardTab}`;
  const { leaderboard } = await (await fetch(url)).json();
  $("#boardList").innerHTML = leaderboard.length
    ? leaderboard.map((r, i) => `
      <li><span class="rank">${i + 1}</span>
      <span class="who">${esc(r.nama)}<small>${esc(r.kelas)} · ${esc(r.sekolah)}</small></span>
      <span class="pts">${r.score}</span></li>`).join("")
    : `<li><span class="who">Belum ada nilai. Jadilah yang pertama! 🚀</span></li>`;
}
function openBoard() {
  $("#boardModal").hidden = false;
  loadBoard();
  clearInterval(boardTimer);
  boardTimer = setInterval(loadBoard, 15000); // "real-time sync" sederhana
}
function closeBoard() { $("#boardModal").hidden = true; clearInterval(boardTimer); }
$("#btnBoard").addEventListener("click", openBoard);
$("#btnBoard2").addEventListener("click", openBoard);
document.querySelectorAll(".btab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".btab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    boardTab = t.dataset.bl;
    loadBoard();
  }),
);
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => {
    const id = b.dataset.close;
    if (id === "boardModal") closeBoard(); else document.getElementById(id).hidden = true;
  }),
);
$("#boardModal").addEventListener("click", (e) => { if (e.target.id === "boardModal") closeBoard(); });

// ---------- Init ----------
init();
