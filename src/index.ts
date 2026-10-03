import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { join } from "node:path";
import {
  db,
  LEVELS,
  KELAS_LIST,
  PASS_SCORE,
  POINTS_PER_QUESTION,
  type StudentRow,
  type QuestionRow,
} from "./db";

const app = new Hono();

// ---------- Rate limit sederhana untuk POST /api/submit (anti spam) ----------
const SUBMIT_MAX = Number(process.env.SUBMIT_MAX ?? 30);
const SUBMIT_WINDOW_MS = Number(process.env.SUBMIT_WINDOW_MIN ?? 1) * 60 * 1000;
const submitHits = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of submitHits) if (now >= rec.resetAt) submitHits.delete(ip);
}, 60 * 1000);

function clientIp(c: any): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

function submitAllowed(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const rec = submitHits.get(ip);
  if (!rec || now >= rec.resetAt) {
    submitHits.set(ip, { count: 1, resetAt: now + SUBMIT_WINDOW_MS });
    return { ok: true };
  }
  rec.count++;
  if (rec.count > SUBMIT_MAX) {
    return { ok: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
  }
  return { ok: true };
}

// ---------- API ----------

app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.get("/api/levels", (c) => c.json({ levels: LEVELS, kelas: KELAS_LIST, passScore: PASS_SCORE }));

// Daftarkan siswa (idempoten: nama+kelas+absen yang sama → kembalikan id lama).
app.post("/api/students", async (c) => {
  let body: { nama?: string; kelas?: string; absen?: number; sekolah?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Data tidak valid." }, 400);
  }
  const nama = String(body.nama ?? "").trim().slice(0, 100);
  const kelas = String(body.kelas ?? "").trim().toUpperCase();
  const absen = Number(body.absen);
  const sekolah = String(body.sekolah ?? "").trim().slice(0, 100);
  if (!nama) return c.json({ error: "Nama lengkap wajib diisi." }, 400);
  if (!(KELAS_LIST as readonly string[]).includes(kelas)) {
    return c.json({ error: "Kelas tidak dikenal." }, 400);
  }
  if (!Number.isInteger(absen) || absen < 1 || absen > 40) {
    return c.json({ error: "Nomor absen harus 1–40." }, 400);
  }
  const existing = db
    .query("SELECT * FROM students WHERE nama = ? AND kelas = ? AND absen = ?")
    .get(nama, kelas, absen) as StudentRow | null;
  if (existing) {
    if (sekolah && sekolah !== existing.sekolah) {
      db.query("UPDATE students SET sekolah = ? WHERE id = ?").run(sekolah, existing.id);
      existing.sekolah = sekolah;
    }
    return c.json({ student: publicStudent(existing) });
  }
  const row = db
    .query(
      "INSERT INTO students (nama, kelas, absen, sekolah) VALUES (?, ?, ?, ?) RETURNING *",
    )
    .get(nama, kelas, absen, sekolah) as StudentRow;
  return c.json({ student: publicStudent(row) }, 201);
});

function publicStudent(s: StudentRow) {
  return { id: s.id, nama: s.nama, kelas: s.kelas, absen: s.absen, sekolah: s.sekolah };
}

// Soal TANPA kunci & pembahasan (anti nyontek via devtools).
app.get("/api/questions", (c) => {
  const level = Number(c.req.query("level"));
  if (!Number.isInteger(level) || level < 1 || level > 8) {
    return c.json({ error: "Level harus 1–8." }, 400);
  }
  const rows = db
    .query("SELECT id, level, q, options FROM questions WHERE level = ? ORDER BY id")
    .all(level) as Pick<QuestionRow, "id" | "level" | "q" | "options">[];
  return c.json({
    level,
    questions: rows.map((r) => ({
      id: r.id,
      q: r.q,
      options: JSON.parse(r.options) as string[],
    })),
  });
});

// Kumpulkan jawaban → validasi di server.
app.post("/api/submit", async (c) => {
  const ip = clientIp(c);
  const gate = submitAllowed(ip);
  if (!gate.ok) {
    c.header("Retry-After", String(gate.retryAfter ?? 60));
    return c.json({ error: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi." }, 429);
  }
  let body: { student_id?: number; level?: number; answers?: { question_id?: number; answer?: number }[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Data tidak valid." }, 400);
  }
  const studentId = Number(body.student_id);
  const level = Number(body.level);
  const answers = Array.isArray(body.answers) ? body.answers : [];
  const student = db.query("SELECT * FROM students WHERE id = ?").get(studentId) as StudentRow | null;
  if (!student) return c.json({ error: "Siswa tidak ditemukan." }, 404);
  if (!Number.isInteger(level) || level < 1 || level > 8) {
    return c.json({ error: "Level harus 1–8." }, 400);
  }
  const keyRows = db
    .query("SELECT id, answer, explain, q, options FROM questions WHERE level = ? ORDER BY id")
    .all(level) as QuestionRow[];
  if (keyRows.length === 0) return c.json({ error: "Soal level ini belum tersedia." }, 404);
  const keyById = new Map(keyRows.map((r) => [r.id, r]));

  let correct = 0;
  const details = keyRows.map((k) => {
    const given = answers.find((a) => Number(a.question_id) === k.id);
    const ans = given && Number.isInteger(Number(given.answer)) ? Number(given.answer) : -1;
    const isCorrect = ans === k.answer;
    if (isCorrect) correct++;
    return {
      question_id: k.id,
      q: k.q,
      options: JSON.parse(k.options) as string[],
      answer: ans,
      correctAnswer: k.answer,
      correct: isCorrect,
      explain: k.explain,
    };
  });
  void keyById;
  const total = keyRows.length;
  const score = correct * POINTS_PER_QUESTION;
  const crystal = score >= PASS_SCORE ? 1 : 0;

  db.query(
    `INSERT INTO attempts (student_id, level, score, correct, total, crystal, answers)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    studentId,
    level,
    score,
    correct,
    total,
    crystal,
    JSON.stringify(details.map((d) => ({ question_id: d.question_id, answer: d.answer, correct: d.correct }))),
  );

  return c.json({ score, correct, total, crystal, passScore: PASS_SCORE, details });
});

// Progres kristal seorang siswa (sumber kebenaran server).
app.get("/api/progress", (c) => {
  const studentId = Number(c.req.query("student_id"));
  if (!Number.isInteger(studentId) || studentId <= 0) {
    return c.json({ error: "student_id tidak valid." }, 400);
  }
  const rows = db
    .query(
      `SELECT level, MAX(score) AS best, MAX(crystal) AS crystal
       FROM attempts WHERE student_id = ? GROUP BY level`,
    )
    .all(studentId) as { level: number; best: number; crystal: number }[];
  const crystals = rows.filter((r) => r.crystal === 1).map((r) => r.level);
  const best: Record<number, number> = {};
  for (const r of rows) best[r.level] = r.best;
  const total = Object.values(best).reduce((a, b) => a + b, 0);
  return c.json({ crystals, best, total });
});

// Leaderboard: total = jumlah skor terbaik per level per siswa.
app.get("/api/leaderboard", (c) => {
  const levelQ = c.req.query("level");
  const level = levelQ ? Number(levelQ) : null;
  if (levelQ && (!Number.isInteger(level!) || level! < 1 || level! > 8)) {
    return c.json({ error: "Level harus 1–8." }, 400);
  }
  let rows: { nama: string; kelas: string; sekolah: string; score: number }[];
  if (level) {
    rows = db
      .query(
        `SELECT s.nama, s.kelas, s.sekolah, MAX(a.score) AS score
         FROM attempts a JOIN students s ON s.id = a.student_id
         WHERE a.level = ? GROUP BY a.student_id ORDER BY score DESC, s.nama ASC LIMIT 20`,
      )
      .all(level) as typeof rows;
  } else {
    rows = db
      .query(
        `SELECT s.nama, s.kelas, s.sekolah, SUM(b.best) AS score FROM (
           SELECT student_id, level, MAX(score) AS best FROM attempts GROUP BY student_id, level
         ) b JOIN students s ON s.id = b.student_id
         GROUP BY b.student_id ORDER BY score DESC, s.nama ASC LIMIT 20`,
      )
      .all() as typeof rows;
  }
  return c.json({ level: level ?? "total", leaderboard: rows });
});

// Ekspor Word (.doc kompatibel MS Word): soal + kunci + pembahasan per level.
app.get("/api/export/word", (c) => {
  const level = Number(c.req.query("level"));
  if (!Number.isInteger(level) || level < 1 || level > 8) {
    return c.json({ error: "Level harus 1–8." }, 400);
  }
  const meta = LEVELS.find((l) => l.level === level)!;
  const rows = db
    .query("SELECT q, options, answer, explain FROM questions WHERE level = ? ORDER BY id")
    .all(level) as QuestionRow[];
  if (!rows.length) return c.json({ error: "Soal level ini belum tersedia." }, 404);

  const letters = ["A", "B", "C", "D"];
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const soalHtml = rows
    .map((r, i) => {
      const opts = (JSON.parse(r.options) as string[])
        .map((o, j) => `<p style="margin:2px 0 2px 24px">${letters[j]}. ${esc(o)}</p>`)
        .join("");
      return `<p><b>${i + 1}. ${esc(r.q)}</b></p>${opts}`;
    })
    .join("");
  const kunciHtml = rows
    .map((r, i) => `<p><b>${i + 1}. ${letters[r.answer]}</b> — ${esc(r.explain)}</p>`)
    .join("");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Soal MISI GEOMETRI Level ${level}</title></head>
<body>
<h1>MISI GEOMETRI — Escape Room Kekongruenan &amp; Kesebangunan</h1>
<h2>Level ${level}: ${esc(meta.title)} — ${esc(meta.desc)}</h2>
<p><i>Untuk guru: dokumen ini berisi soal, kunci jawaban, dan pembahasan.</i></p>
<hr><h3>Soal</h3>${soalHtml}
<hr><h3>Kunci Jawaban &amp; Pembahasan</h3>${kunciHtml}
</body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "application/msword; charset=utf-8",
      "Content-Disposition": `attachment; filename="misi-geometri-level-${level}.doc"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// ---------- Frontend ----------
app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT ?? 3021);
console.log(`MISI GEOMETRI berjalan di http://localhost:${port}`);

export default { port, fetch: app.fetch };
