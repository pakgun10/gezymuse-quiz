# MISI GEOMETRI 🔷

Game kuis **escape room** HOTS **Kekongruenan & Kesebangunan** untuk SMP Kelas 9.
Kumpulkan 8 kristal geometri dengan menuntaskan 8 sektor berjenjang!

Dibangun dengan **Bun + Hono + bun:sqlite** (tanpa database server terpisah).

## Fitur

- 🎯 8 sektor (level) berjenjang: sektor N+1 terbuka setelah merebut kristal sektor N (skor ≥ 60)
- 🪪 Registrasi agen: nama, kelas (IX A–IX I), nomor absen (01–40), asal sekolah
- ⭐ Skor 20 poin per jawaban benar (maks 100/sektor), progres tersimpan (localStorage + server)
- 🏆 Daftar Nilai (total & per sektor) dengan sinkronisasi otomatis tiap 15 detik
- 💬 Share WA berisi skor (client-side)
- 🎵 Musik WebAudio sederhana (tanpa file eksternal)
- 📄 Ekspor Word (.doc): soal + gambar + kunci + pembahasan per sektor, untuk guru
- 🖼️ Soal bergambar: gambar soal tampil di layar kuis (tanpa bocoran jawaban), gambar pembahasan muncul di layar hasil; dikelola lewat halaman admin `/admin.html` (token `ADMIN_TOKEN`)
- 🛡️ Anti nyontek: soal dikirim TANPA kunci/pembahasan; validasi jawaban di server; rate-limit submit

## Menjalankan

```bash
bun install
bun run dev      # mode pengembangan (auto-reload)
# atau
bun run start    # mode biasa
```

Buka http://localhost:3021 — port via `PORT`, folder data via `DATA_DIR`
(lihat `.env.example`). Bank soal (40 soal) otomatis dimuat saat pertama jalan.

## API ringkas

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/students` | Registrasi (`{nama, kelas, absen, sekolah}`) |
| GET | `/api/levels` | Daftar 8 sektor + daftar kelas |
| GET | `/api/questions?level=N` | Soal TANPA kunci |
| POST | `/api/submit` | Kumpulkan jawaban → `{skor, benar, total, crystal, rincian+pembahasan}` |
| GET | `/api/progress?student_id=N` | Kristal & skor terbaik per sektor |
| GET | `/api/leaderboard?level=` | 20 besar (total / per sektor) |
| GET | `/api/export/word?level=N` | Unduh .doc soal+kunci+pendaftaran |
| GET | `/api/health` | Cek hidup |

## Deploy ke VPS

Lihat `deploy/DEPLOY.md` — systemd service, nginx reverse proxy + HTTPS,
backup otomatis harian.

---

MISI GEOMETRI © 2026
