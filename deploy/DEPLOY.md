# Deploy MISI GEOMETRI ke VPS

Panduan Ubuntu/Debian + nginx, berdampingan dengan aplikasi lain
(contoh: Gezy Learning Materials di port 3020). MISI GEOMETRI memakai port 3021.

## 1. Pasang Bun (jika belum)

Ikuti panduan resmi di situs Bun, lalu catat lokasi binary (`which bun`).

## 2. Ambil kode

    sudo mkdir -p /opt/gezymuse-quiz /var/lib/gezymuse-quiz /var/backups/gezymuse-quiz
    sudo chown -R www-data:www-data /opt/gezymuse-quiz /var/lib/gezymuse-quiz /var/backups/gezymuse-quiz
    sudo -u www-data git clone https://github.com/pakgun10/gezymuse-quiz.git /opt/gezymuse-quiz
    cd /opt/gezymuse-quiz
    sudo -u www-data bun install

Bank soal (40 soal) otomatis dimuat saat aplikasi pertama kali jalan.

## 3. Pasang systemd service

Sesuaikan dulu deploy/gezymuse-quiz.service (User, WorkingDirectory,
ExecStart = lokasi bun), lalu:

    sudo cp deploy/gezymuse-quiz.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now gezymuse-quiz
    curl -s http://127.0.0.1:3021/api/health

### Token admin (halaman /admin.html)

Isi `ADMIN_TOKEN` dengan nilai acak yang panjang sebelum mengaktifkan
service, mis.:

    openssl rand -hex 24

Lalu pasang di file service (`Environment=ADMIN_TOKEN=...`) dan restart:

    sudo systemctl restart gezymuse-quiz

Buka `https://domain-anda/admin.html`, tempel token, lalu kelola gambar
soal (unggah/ganti gambar soal & gambar pembahasan per soal). Tanpa
`ADMIN_TOKEN`, halaman admin menolak semua aksi.

## 4. Pasang nginx + HTTPS

Sesuaikan server_name di deploy/nginx.conf (mis. kuis.gezytech.web.id),
arahkan DNS ke IP VPS, lalu:

    sudo cp deploy/nginx.conf /etc/nginx/sites-available/gezymuse-quiz
    sudo ln -s /etc/nginx/sites-available/gezymuse-quiz /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
    sudo certbot --nginx -d kuis.gezytech.web.id

## 5. Backup otomatis harian

Tes manual, lalu pasang cron sebagai root (crontab -e):

    0 3 * * * DATA_DIR=/var/lib/gezymuse-quiz BACKUP_DIR=/var/backups/gezymuse-quiz /opt/gezymuse-quiz/deploy/backup.sh >> /var/log/gezymuse-quiz-backup.log 2>&1

Arsip di /var/backups/gezymuse-quiz/ (retensi 14 hari).

## 6. Update aplikasi

    cd /opt/gezymuse-quiz
    sudo -u www-data git pull && sudo -u www-data bun install
    sudo systemctl restart gezymuse-quiz

Data di /var/lib/gezymuse-quiz tidak tertimpa (DATA_DIR terpisah dari kode).

## Mengembalikan backup

    sudo systemctl stop gezymuse-quiz
    sudo tar -xzf /var/backups/gezymuse-quiz/gezymuse-quiz-TANGGAL.tar.gz -C /var/lib/gezymuse-quiz
    sudo chown -R www-data:www-data /var/lib/gezymuse-quiz
    sudo systemctl start gezymuse-quiz
