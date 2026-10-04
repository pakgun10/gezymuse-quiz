import { Database } from "bun:sqlite";
import { mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { QUESTIONS, SEED_VERSION, IMAGE_QUESTION_UPDATES } from "./seed";

export const DATA_DIR =
  process.env.DATA_DIR?.trim() || join(import.meta.dir, "..", "data");
export const QIMAGES_DIR = join(DATA_DIR, "qimages");
const SEED_IMAGES_DIR = join(import.meta.dir, "..", "seed-images");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(QIMAGES_DIR, { recursive: true });

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
    explain TEXT NOT NULL DEFAULT '',
    image   TEXT NOT NULL DEFAULT '',          -- nama file gambar soal di qimages/
    image_explain TEXT NOT NULL DEFAULT ''    -- nama file gambar pembahasan di qimages/
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

  CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );
`);

// Migrasi kolom gambar untuk DB lama (v1 tidak punya kolom ini).
for (const col of ["image", "image_explain"]) {
  const cols = db.query("PRAGMA table_info(questions)").all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE questions ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    console.log(`Migrasi DB: kolom questions.${col} ditambahkan.`);
  }
}

function metaGet(k: string): string | null {
  const r = db.query("SELECT v FROM meta WHERE k = ?").get(k) as { v: string } | null;
  return r ? r.v : null;
}
function metaSet(k: string, v: string) {
  db.query("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}

export type StudentRow = {
  id: number; nama: string; kelas: string; absen: number; sekolah: string; created_at: string;
};
export type QuestionRow = {
  id: number; level: number; q: string; options: string; answer: number; explain: string;
  image: string; image_explain: string;
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

/** Salin gambar bawaan (seed-images/) ke DATA_DIR/qimages bila belum ada. */
export function ensureSeedImages() {
  if (!existsSync(SEED_IMAGES_DIR)) return;
  for (const f of readdirSync(SEED_IMAGES_DIR)) {
    if (!/\.(png|jpe?g|webp|gif)$/i.test(f)) continue;
    const dest = join(QIMAGES_DIR, basename(f));
    if (!existsSync(dest)) copyFileSync(join(SEED_IMAGES_DIR, f), dest);
  }
}

/** Isi bank soal saat DB masih kosong; migrasi soal bergambar untuk DB lama. */
export function seedQuestions() {
  const n = (db.query("SELECT COUNT(*) AS n FROM questions").get() as { n: number }).n;
  const version = Number(metaGet("seed_version") ?? 0);
  if (n === 0) {
    const ins = db.query(
      "INSERT INTO questions (level, q, options, answer, explain, image, image_explain) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const tx = db.transaction((rows: typeof QUESTIONS) => {
      for (const r of rows)
        ins.run(r.level, r.q, JSON.stringify(r.options), r.answer, r.explain, r.image ?? "", r.image_explain ?? "");
    });
    tx(QUESTIONS);
    console.log(`Bank soal dimuat: ${QUESTIONS.length} soal.`);
  } else if (version < SEED_VERSION) {
    // DB lama (v1): perbarui 9 soal menjadi versi bergambar dari docx.
    const upd = db.query(
      "UPDATE questions SET q = ?, options = ?, answer = ?, explain = ?, image = ?, image_explain = ? WHERE id = ?",
    );
    let count = 0;
    const tx = db.transaction(() => {
      for (const u of IMAGE_QUESTION_UPDATES) {
        const ids = db
          .query("SELECT id FROM questions WHERE level = ? ORDER BY id")
          .all(u.level) as { id: number }[];
        const target = ids[u.pos];
        if (!target) continue;
        upd.run(u.q, JSON.stringify(u.options), u.answer, u.explain, u.image ?? "", u.image_explain ?? "", target.id);
        count++;
      }
    });
    tx();
    console.log(`Migrasi bank soal: ${count} soal diperbarui ke versi bergambar.`);
  }
  metaSet("seed_version", String(SEED_VERSION));
  ensureSeedImages();
}

seedQuestions();
