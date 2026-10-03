import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { QUESTIONS } from "./seed";

export const DATA_DIR =
  process.env.DATA_DIR?.trim() || join(import.meta.dir, "..", "data");

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, "misi-geometri.sqlite"), {
  create: true,
});

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nama       TEXT NOT NULL,
    kelas      TEXT NOT NULL,
    absen      INTEGER NOT NULL,
    sekolah    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (nama, kelas, absen)
  );

  CREATE TABLE IF NOT EXISTS questions (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    level   INTEGER NOT NULL CHECK (level BETWEEN 1 AND 8),
    q       TEXT NOT NULL,
    options TEXT NOT NULL,  -- JSON array 4 opsi
    answer  INTEGER NOT NULL CHECK (answer BETWEEN 0 AND 3),
    explain TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_questions_level ON questions(level);

  CREATE TABLE IF NOT EXISTS attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    level      INTEGER NOT NULL CHECK (level BETWEEN 1 AND 8),
    score      INTEGER NOT NULL,
    correct    INTEGER NOT NULL,
    total      INTEGER NOT NULL,
    crystal    INTEGER NOT NULL DEFAULT 0,  -- 1 = kristal diraih (>=60)
    answers    TEXT NOT NULL DEFAULT '[]',  -- JSON [{question_id, answer, correct}]
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id);
  CREATE INDEX IF NOT EXISTS idx_attempts_level ON attempts(level);
`);

export type StudentRow = {
  id: number; nama: string; kelas: string; absen: number; sekolah: string; created_at: string;
};
export type QuestionRow = {
  id: number; level: number; q: string; options: string; answer: number; explain: string;
};
export type AttemptRow = {
  id: number; student_id: number; level: number; score: number; correct: number;
  total: number; crystal: number; answers: string; created_at: string;
};

export const LEVELS = [
  { level: 1, title: "Gerbang Kesadaran", desc: "Konsep dasar kekongruenan" },
  { level: 2, title: "Segitiga Kembar", desc: "Syarat kekongruenan segitiga" },
  { level: 3, title: "Skala Miniatur", desc: "Kesebangunan & skala" },
  { level: 4, title: "Sisi yang Hilang", desc: "Mencari sisi bangun sebangun" },
  { level: 5, title: "Bayangan Raksasa", desc: "Penerapan dalam kehidupan" },
  { level: 6, title: "Garis Paralel", desc: "Garis sejajar & perbandingan luas" },
  { level: 7, title: "Misi Ganda", desc: "Kombinasi konsep" },
  { level: 8, title: "Ruang Terakhir", desc: "HOTS campuran" },
] as const;

export const KELAS_LIST = ["IX A","IX B","IX C","IX D","IX E","IX F","IX G","IX H","IX I"] as const;

export const PASS_SCORE = 60; // skor >= 60 → kristal + buka level berikut
export const POINTS_PER_QUESTION = 20;

/** Isi bank soal saat DB masih kosong. */
export function seedQuestions() {
  const n = (db.query("SELECT COUNT(*) AS n FROM questions").get() as { n: number }).n;
  if (n > 0) return;
  const ins = db.query(
    "INSERT INTO questions (level, q, options, answer, explain) VALUES (?, ?, ?, ?, ?)",
  );
  const tx = db.transaction((rows: typeof QUESTIONS) => {
    for (const r of rows) ins.run(r.level, r.q, JSON.stringify(r.options), r.answer, r.explain);
  });
  tx(QUESTIONS);
  console.log(`Bank soal dimuat: ${QUESTIONS.length} soal.`);
}

seedQuestions();
