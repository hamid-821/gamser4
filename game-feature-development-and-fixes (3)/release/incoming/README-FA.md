# راهنمای به‌روزرسانی app.gamifi.ir — گی‌میفای نسخهٔ ۲.۱.۰

این بسته نسخهٔ جدید برنامهٔ **app.gamifi.ir** (همان `appgame` / `/root/appg/server.cjs`) است.
هیچ فایل محرمانه، دیتابیس، آپلود یا `node_modules` در بسته نیست. برنامه هم‌چنان **بدون هیچ وابستگی npm** اجرا می‌شود (Node 18+، روی سرور شما Node 22).

## محتوای بسته (باید مستقیماً داخل `/root/appg-update/incoming` باشد)

```
incoming/
├── server.cjs          ← سرور جدید (API قبیله، نبرد، تورنمنت، سازمان، نظارت، گوگل)
├── dist/
│   ├── index.html      ← همان باندل اصلی + دو خط تزریق addon
│   ├── addon.js        ← لایهٔ افزونه (رفع باگ‌ها + هاب قبیله)
│   └── addon.css
├── package.json        ← فقط برای نسخه/اسکریپت‌ها (بدون وابستگی)
├── VERSION
├── update.sh           ← اسکریپت به‌روزرسانی امن
├── CHANGELOG-FA.md
└── README-FA.md
```

## ۱) انتقال با WinSCP

1. با WinSCP به سرور وصل شوید (پروتکل SFTP، کاربر `root`).
2. در سمت سرور به مسیر `/root/appg-update/` بروید؛ اگر نبود، پوشهٔ `appg-update` و داخل آن `incoming` را بسازید.
3. **محتویات** پوشهٔ `incoming` این بسته را (نه خود پوشه‌ای تودرتو) داخل `/root/appg-update/incoming` بکشید و رها کنید،
   طوری که مسیر `/root/appg-update/incoming/server.cjs` وجود داشته باشد.
4. اگر فایل zip را منتقل کردید، در ترمینال:
   `cd /root/appg-update && unzip -o appg-update.zip` (فایل zip طوری ساخته شده که مستقیماً `incoming/...` را می‌سازد).

## ۲) اجرای به‌روزرسانی (یک فرمان)

```bash
cd /root/appg-update/incoming && bash update.sh
```

اسکریپت به ترتیب:

1. **پیش‌بررسی فقط‌خواندنی**: پردازش گوش‌دهنده روی `127.0.0.1:3001`، مسیر واقعی برنامه (از `/proc/PID`)، روش اجرا (systemd / pm2 / nohup)، مسیر داده (`DATA_DIR` یا `data-app/`) و نوع ذخیره‌سازی (JSON یا SQLite) را تشخیص می‌دهد.
   اگر هرکدام را با اطمینان تشخیص ندهد، **هیچ تغییری نمی‌دهد** و فقط فرمان‌های بررسی را چاپ می‌کند.
2. از شما تأیید `yes` می‌گیرد.
3. **بک‌آپ زمان‌دار** کد و داده‌ها در `/root/appg-backups/<تاریخ-ساعت>/` (برای SQLite از `sqlite3 .backup` استفاده می‌شود).
4. وابستگی/آزمون/بیلد را در `incoming` اجرا می‌کند و یک **آزمون دود** روی پورت موقت `3901` با *کپیِ* داده‌ها انجام می‌دهد (به دادهٔ واقعی دست نمی‌زند).
5. نسخهٔ جدید را در `staging-*` می‌سازد، `.env` و فایل‌های اضافی `dist` نسخهٔ فعلی را نگه می‌دارد، سپس با `mv` جابه‌جا می‌کند (نسخهٔ قبلی در `/root/appg-update/previous-*` می‌ماند). پوشهٔ داده **بدون کپی/حذف** به جای خودش منتقل می‌شود.
6. فقط همان سرویس را restart می‌کند (`systemctl restart <unit>` یا `pm2 restart <name>` یا اجرای مجدد با همان env).
7. `/api/health` روی `127.0.0.1:3001` و سایت روی `https://app.gamifi.ir/` را آزمایش می‌کند؛ در صورت شکست **خودکار برمی‌گردد**.

حالت‌های دیگر:

```bash
bash update.sh --check      # فقط پیش‌بررسی، بدون هیچ تغییری
bash update.sh --yes        # بدون پرسش تأیید
bash update.sh --rollback   # بازگشت دستی به آخرین previous-*
```

اگر تشخیص خودکار ناموفق بود ولی خودتان مطمئنید، می‌توانید مقادیر را صریح بدهید:

```bash
APP_DIR=/root/appg DATA_DIR=/root/appg/data-app MANAGER=systemd UNIT=appg.service bash update.sh
```

## ۳) داده‌ها و مهاجرت

- ذخیره‌سازی همان فایل `data-app/app.json` است. نسخهٔ جدید فقط **کلید جدید اضافه می‌کند** (`clans, wars, tournaments, moderation, notices, clanChat, orgs, meta.schema=2`) و کلیدهای قبلی (`users, tokens, messages`) را دست نمی‌زند.
- نسخهٔ قبلی هم اگر دوباره اجرا شود، این کلیدها را نگه می‌دارد (spread می‌کند)، پس **rollback بدون از دست رفتن داده** است.
- هیچ بازنشانی/حذفی انجام نمی‌شود.

## ۴) تنظیمات اختیاری بعد از به‌روزرسانی

- **ورود واقعی با گوگل**: در env سرویس (فایل unit در systemd یا ecosystem در pm2 یا `.env`ی که خودتان لود می‌کنید) این‌ها را تنظیم کنید:
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL=https://app.gamifi.ir`
  و در Google Cloud آدرس بازگشت `https://app.gamifi.ir/auth/google/callback` را ثبت کنید. تا وقتی تنظیم نشود، دکمهٔ گوگل مثل قبل کار می‌کند و اسکریپت فقط هشدار می‌دهد.
- **مدیر پنل نظارت**: کلید در `data-app/admin-key.txt` ساخته می‌شود (یا `ADMIN_KEY` در env). در سایت، دکمهٔ شناور «قبیله» → آیکون 🔑 → کلید را وارد کنید تا تب «مدیریت» (صف پست/استوری، تأیید سازمان، تورنمنت‌ها، اعلان همگانی) ظاهر شود.
  همچنین می‌توانید `ADMIN_EMAILS=you@gmail.com` بدهید تا با ورود گوگل خودکار مدیر شوید.
- Nginx، گواهی TLS، پورت‌های دیگر، سایت 86.107.47.228 و سرویس gamnasr **اصلاً لمس نمی‌شوند**.

## ۵) بررسی بعد از استقرار

```bash
curl -s http://127.0.0.1:3001/api/health      # {"ok":true,"version":"2.1.0"}
curl -s http://127.0.0.1:3001/api/config      # google:true/false, orgs[...]
curl -sI https://app.gamifi.ir/ | head -1
cat /root/appg/data-app/admin-key.txt
```

در مرورگر: صفحهٔ اصلی → دکمهٔ شناور 🏰 پایین‌راست → تب‌های قبیله‌ها، نبردها، تورنمنت‌ها، سازمان، اعلان‌ها، بازیکنان.
