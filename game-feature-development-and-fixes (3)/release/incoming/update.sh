#!/usr/bin/env bash
# =====================================================================
#  update.sh — به‌روزرسانی امن app.gamifi.ir (گی‌میفای ۲.۱)
#  اجرا:  cd /root/appg-update/incoming && bash update.sh
#  حالت‌ها:
#     bash update.sh            → پیش‌بررسی + به‌روزرسانی (با تأیید)
#     bash update.sh --check    → فقط پیش‌بررسی فقط‌خواندنی، هیچ تغییری نمی‌دهد
#     bash update.sh --yes      → بدون پرسش تأیید
#     bash update.sh --rollback → بازگشت دستی به آخرین نسخهٔ قبلی
#  اصول: هیچ rm -rf، هیچ pm2 restart all، هیچ reboot، هیچ حدس نام سرویس.
#  هر چیزی که جابه‌جا می‌شود با mv به پوشهٔ previous-* می‌رود و قابل بازگشت است.
# =====================================================================
set -u
set -o pipefail

INCOMING="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_ROOT="$(dirname "$INCOMING")"                 # /root/appg-update
APP_DIR_EXPECTED="/root/appg"
PORT_EXPECTED=3001
PUBLIC_URL="https://app.gamifi.ir"
BACKUP_ROOT="${BACKUP_ROOT:-/root/appg-backups}"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$UPDATE_ROOT/update-$TS.log"
MODE="update"; ASSUME_YES=0
for a in "$@"; do case "$a" in --check) MODE="check";; --yes|-y) ASSUME_YES=1;; --rollback) MODE="rollback";; esac; done

c_red=$'\e[31m'; c_grn=$'\e[32m'; c_ylw=$'\e[33m'; c_cyn=$'\e[36m'; c_rst=$'\e[0m'
say()  { echo -e "${c_cyn}▸${c_rst} $*" | tee -a "$LOG"; }
ok()   { echo -e "${c_grn}✔${c_rst} $*" | tee -a "$LOG"; }
warn() { echo -e "${c_ylw}⚠${c_rst} $*" | tee -a "$LOG"; }
die()  { echo -e "${c_red}✖ $*${c_rst}" | tee -a "$LOG"; exit 1; }
mkdir -p "$UPDATE_ROOT" 2>/dev/null || true; touch "$LOG" 2>/dev/null || LOG=/dev/null

# ---------------------------------------------------------------------
# ۱) پیش‌بررسی فقط‌خواندنی
# ---------------------------------------------------------------------
say "پیش‌بررسی فقط‌خواندنی شروع شد ($TS) — لاگ: $LOG"
[ "$(id -u)" -eq 0 ] || warn "با کاربر root اجرا نشده‌اید؛ ممکن است دسترسی کافی نباشد."

command -v node >/dev/null || die "node پیدا نشد."
NODE_V="$(node -v)"; say "Node: $NODE_V"
case "$NODE_V" in v1[0-7].*) die "Node 18+ لازم است (fetch داخلی). نسخهٔ فعلی: $NODE_V";; esac
command -v curl >/dev/null || die "curl پیدا نشد."

# پردازش گوش‌دهنده روی پورت 3001
LISTEN_LINE="$( (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E "[:.]${PORT_EXPECTED}[[:space:]]" | head -1)"
PID="$(echo "$LISTEN_LINE" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)"
[ -z "${PID:-}" ] && PID="$(echo "$LISTEN_LINE" | grep -oE '[0-9]+/node' | head -1 | cut -d/ -f1)"
if [ -z "${PID:-}" ]; then
  warn "هیچ پردازشی روی 127.0.0.1:$PORT_EXPECTED گوش نمی‌دهد."
  PID=""
else
  ok "پردازش روی پورت $PORT_EXPECTED: PID=$PID"
fi

# مسیر واقعی برنامه
APP_DIR="${APP_DIR:-}"; APP_SCRIPT=""
[ -n "$APP_DIR" ] && say "APP_DIR به‌صورت دستی داده شد: $APP_DIR"
if [ -z "$APP_DIR" ] && [ -n "$PID" ] && [ -r "/proc/$PID/cmdline" ]; then
  CMDLINE="$(tr '\0' ' ' < /proc/$PID/cmdline)"
  CWD="$(readlink -f /proc/$PID/cwd 2>/dev/null || true)"
  say "فرمان اجرا: $CMDLINE"
  say "پوشهٔ کاری پردازش: ${CWD:-?}"
  SCRIPT_ARG="$(echo "$CMDLINE" | tr ' ' '\n' | grep -E 'server\.cjs$' | head -1 || true)"
  if [ -n "$SCRIPT_ARG" ]; then
    case "$SCRIPT_ARG" in /*) APP_SCRIPT="$SCRIPT_ARG";; *) APP_SCRIPT="$CWD/$SCRIPT_ARG";; esac
    APP_SCRIPT="$(readlink -f "$APP_SCRIPT" 2>/dev/null || echo "$APP_SCRIPT")"
    APP_DIR="$(dirname "$APP_SCRIPT")"
  fi
fi
if [ -z "$APP_DIR" ] && [ -f "$APP_DIR_EXPECTED/server.cjs" ]; then APP_DIR="$APP_DIR_EXPECTED"; APP_SCRIPT="$APP_DIR/server.cjs"; warn "مسیر برنامه از روی مسیر پیش‌فرض تشخیص داده شد (نه از پردازش)."; fi
[ -n "$APP_DIR" ] && ok "مسیر برنامه: $APP_DIR" || warn "مسیر برنامه تشخیص داده نشد."
if [ -n "$APP_DIR" ] && [ "$APP_DIR" != "$APP_DIR_EXPECTED" ]; then warn "مسیر برنامه ($APP_DIR) با مسیر اعلام‌شده ($APP_DIR_EXPECTED) فرق دارد؛ از مسیر واقعی پردازش استفاده می‌شود."; fi

# محیط پردازش (فقط خواندن؛ رمزها چاپ نمی‌شوند)
PROC_ENV_FILE=""
if [ -n "$PID" ] && [ -r "/proc/$PID/environ" ]; then
  PROC_ENV_FILE="$(mktemp)"; tr '\0' '\n' < /proc/$PID/environ > "$PROC_ENV_FILE"
  ENV_DATA_DIR="$(grep -E '^DATA_DIR=' "$PROC_ENV_FILE" | head -1 | cut -d= -f2- || true)"
  ENV_PORT="$(grep -E '^PORT=' "$PROC_ENV_FILE" | head -1 | cut -d= -f2- || true)"
  ENV_BASE="$(grep -E '^BASE_URL=' "$PROC_ENV_FILE" | head -1 | cut -d= -f2- || true)"
  HAS_GOOGLE="$(grep -cE '^GOOGLE_CLIENT_ID=.+' "$PROC_ENV_FILE" || true)"
  say "env پردازش → PORT=${ENV_PORT:-(پیش‌فرض 3001)} BASE_URL=${ENV_BASE:-(پیش‌فرض)} DATA_DIR=${ENV_DATA_DIR:-(پیش‌فرض)} GOOGLE_CLIENT_ID=$([ "${HAS_GOOGLE:-0}" -gt 0 ] && echo تنظیم‌شده || echo تنظیم‌نشده)"
else
  ENV_DATA_DIR=""; ENV_PORT=""; ENV_BASE=""; HAS_GOOGLE=0
fi

# مسیر داده‌ها و نوع پایگاه‌داده
DATA_DIR="${DATA_DIR:-}"
if [ -n "$DATA_DIR" ]; then say "DATA_DIR به‌صورت دستی داده شد: $DATA_DIR"; elif [ -n "$ENV_DATA_DIR" ]; then DATA_DIR="$ENV_DATA_DIR"; elif [ -n "$APP_DIR" ]; then DATA_DIR="$APP_DIR/data-app"; fi
DB_KIND="unknown"
if [ -n "$DATA_DIR" ] && [ -d "$DATA_DIR" ]; then
  [ -f "$DATA_DIR/app.json" ] && DB_KIND="json"
  ls "$DATA_DIR"/*.sqlite "$DATA_DIR"/*.db >/dev/null 2>&1 && DB_KIND="${DB_KIND}+sqlite"
  ok "مسیر داده: $DATA_DIR (نوع: $DB_KIND؛ حجم: $(du -sh "$DATA_DIR" 2>/dev/null | cut -f1))"
elif [ -n "$DATA_DIR" ]; then
  warn "پوشهٔ داده هنوز وجود ندارد: $DATA_DIR (برنامه با اولین اجرا آن را می‌سازد)"; DB_KIND="none"
fi
DATA_INSIDE_APP=0; [ -n "$DATA_DIR" ] && [ -n "$APP_DIR" ] && case "$DATA_DIR" in "$APP_DIR"/*) DATA_INSIDE_APP=1;; esac

# روش مدیریت فرایند
MANAGER="${MANAGER:-unknown}"; UNIT="${UNIT:-}"; PM2_NAME="${PM2_NAME:-}"
if [ "$MANAGER" != unknown ]; then say "MANAGER به‌صورت دستی داده شد: $MANAGER $UNIT $PM2_NAME"; fi
if [ "$MANAGER" = unknown ] && [ -n "$PID" ]; then
  if command -v systemctl >/dev/null; then
    UNIT="$(ps -o unit= -p "$PID" 2>/dev/null | tr -d ' ' || true)"
    case "$UNIT" in *.service) if systemctl cat "$UNIT" 2>/dev/null | grep -q 'server\.cjs'; then MANAGER="systemd"; fi;; esac
    [ "$MANAGER" = unknown ] && UNIT=""
  fi
  if [ "$MANAGER" = unknown ] && command -v pm2 >/dev/null; then
    PM2_JSON="$(pm2 jlist 2>/dev/null || true)"
    if [ -n "$PM2_JSON" ]; then
      PM2_NAME="$(echo "$PM2_JSON" | node -e '
        let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const l=JSON.parse(s);const pid=Number(process.argv[1]);
        const m=l.find(p=>p.pid===pid||(p.pm2_env&&p.pm2_env.pm_exec_path&&/server\.cjs$/.test(p.pm2_env.pm_exec_path)));console.log(m?m.name:"")}catch{console.log("")}})' "$PID" 2>/dev/null || true)"
      [ -n "$PM2_NAME" ] && MANAGER="pm2"
    fi
  fi
  if [ "$MANAGER" = unknown ]; then
    PPID_="$(ps -o ppid= -p "$PID" | tr -d ' ')"; PCMD="$(ps -o comm= -p "$PPID_" 2>/dev/null || true)"
    case "$PCMD" in systemd|init) [ "$PPID_" = 1 ] && MANAGER="nohup";; bash|sh|screen|tmux*) MANAGER="nohup";; esac
    [ "$MANAGER" = nohup ] && warn "پردازش با systemd/pm2 مدیریت نمی‌شود (احتمالاً nohup/screen). راه‌اندازی مجدد با همان env و cwd انجام می‌شود."
  fi
fi
case "$MANAGER" in
  systemd) ok "مدیر فرایند: systemd → واحد $UNIT";;
  pm2)     ok "مدیر فرایند: pm2 → نام $PM2_NAME";;
  nohup)   ok "مدیر فرایند: پردازش مستقل (nohup/screen) PID=$PID";;
  *)       warn "مدیر فرایند تشخیص داده نشد.";;
esac

# وضعیت فعلی سرویس
CUR_HEALTH="$(curl -s -m 5 "http://127.0.0.1:$PORT_EXPECTED/health" || true)"; say "پاسخ /health فعلی: ${CUR_HEALTH:-(بدون پاسخ)}"
CUR_VER="$(echo "$CUR_HEALTH" | grep -oE '"version":"[^"]+"' | cut -d'"' -f4)"; say "نسخهٔ فعلی: ${CUR_VER:-قدیمی (بدون شمارهٔ نسخه)} → نسخهٔ جدید: $(cat "$INCOMING/VERSION" 2>/dev/null || echo ?)"

# جمع‌بندی و شرط توقف
BLOCKERS=()
[ -z "$APP_DIR" ] && BLOCKERS+=("مسیر برنامه")
[ -z "$DATA_DIR" ] && BLOCKERS+=("مسیر داده")
[ "$MANAGER" = unknown ] && BLOCKERS+=("مدیر فرایند")
if [ "${#BLOCKERS[@]}" -gt 0 ]; then
  echo; warn "به‌دلیل نامشخص بودن: ${BLOCKERS[*]} — هیچ تغییری اعمال نشد."
  cat <<EOF | tee -a "$LOG"

فرمان‌های بررسی پیشنهادی (فقط‌خواندنی):
  ss -ltnp | grep 3001
  ps -ef | grep -v grep | grep server.cjs
  cat /proc/\$(pgrep -f server.cjs | head -1)/cmdline | tr '\0' ' '; echo
  ls -la /proc/\$(pgrep -f server.cjs | head -1)/cwd
  systemctl list-units --type=service | grep -iE 'app|gam|node'
  pm2 list ; pm2 describe <name>
  grep -rl 'server.cjs' /etc/systemd/system /root/.pm2 2>/dev/null
  ls -la /root/appg /root/appg/data-app
  cat /etc/nginx/sites-enabled/app | grep -E 'proxy_pass|server_name'
پس از مشخص‌شدن، در صورت نیاز می‌توانید متغیرها را دستی بدهید:
  APP_DIR=/root/appg DATA_DIR=/root/appg/data-app MANAGER=systemd UNIT=<unit>.service bash update.sh
EOF
  exit 2
fi
[ "$MODE" = check ] && { ok "پیش‌بررسی کامل شد (حالت --check؛ بدون تغییر)."; exit 0; }

# ---------------------------------------------------------------------
# بازگشت دستی
# ---------------------------------------------------------------------
restart_service() {
  case "$MANAGER" in
    systemd) systemctl restart "$UNIT";;
    pm2)     pm2 restart "$PM2_NAME" --update-env >/dev/null;;
    nohup)
      if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then kill "$PID"; for i in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 0.3; done; fi
      NODE_BIN="$(command -v node)"; ENV_ARGS=()
      if [ -n "$PROC_ENV_FILE" ] && [ -s "$PROC_ENV_FILE" ]; then while IFS= read -r line; do case "$line" in [A-Za-z_]*=*) ENV_ARGS+=("$line");; esac; done < "$PROC_ENV_FILE"; else ENV_ARGS=("PORT=$PORT_EXPECTED" "HOST=127.0.0.1" "PATH=$PATH"); fi
      ( cd "$APP_DIR" && nohup env -i "${ENV_ARGS[@]}" "$NODE_BIN" server.cjs >> "$APP_DIR/server.log" 2>&1 & )
      sleep 1; PID="$(ss -ltnp 2>/dev/null | grep -E "[:.]${PORT_EXPECTED}[[:space:]]" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)";;
  esac
}
verify_service() {
  local okh=0
  for i in $(seq 1 25); do
    if curl -sf -m 4 "http://127.0.0.1:$PORT_EXPECTED/api/health" | grep -q '"ok":true'; then okh=1; break; fi
    curl -sf -m 4 "http://127.0.0.1:$PORT_EXPECTED/health" | grep -q '"ok":true' && { okh=1; break; }
    sleep 1
  done
  [ "$okh" = 1 ] || return 1
  curl -sf -m 6 "http://127.0.0.1:$PORT_EXPECTED/" | grep -q '<html' || return 1
  local code; code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$PUBLIC_URL/")"
  case "$code" in 200|304) return 0;; 000) warn "دسترسی به $PUBLIC_URL از داخل سرور ممکن نبود (کد 000)؛ بررسی HTTPS نادیده گرفته شد."; return 0;; *) warn "پاسخ HTTPS: $code"; return 1;; esac
}
if [ "$MODE" = rollback ]; then
  PREV="$(ls -d "$UPDATE_ROOT"/previous-* 2>/dev/null | sort | tail -1)"; [ -n "$PREV" ] || die "نسخهٔ قبلی برای بازگشت پیدا نشد."
  say "بازگشت به $PREV"
  mv "$APP_DIR" "$UPDATE_ROOT/failed-$TS" && mv "$PREV" "$APP_DIR"
  [ "$DATA_INSIDE_APP" = 1 ] && [ -d "$UPDATE_ROOT/failed-$TS/$(basename "$DATA_DIR")" ] && { [ -e "$DATA_DIR" ] && mv "$DATA_DIR" "$UPDATE_ROOT/failed-$TS/data-from-previous-$TS"; mv "$UPDATE_ROOT/failed-$TS/$(basename "$DATA_DIR")" "$DATA_DIR"; }
  restart_service; verify_service && ok "بازگشت انجام شد." || die "بازگشت انجام شد ولی سرویس سالم پاسخ نمی‌دهد؛ لاگ سرویس را ببینید."
  exit 0
fi

# ---------------------------------------------------------------------
# ۲) تأیید
# ---------------------------------------------------------------------
echo; say "خلاصه: برنامه=$APP_DIR | داده=$DATA_DIR ($DB_KIND) | مدیر=$MANAGER ${UNIT}${PM2_NAME} | پورت=$PORT_EXPECTED"
if [ "$ASSUME_YES" != 1 ]; then read -r -p "ادامهٔ به‌روزرسانی؟ (yes/no) " ans; [ "$ans" = yes ] || die "لغو شد؛ هیچ تغییری اعمال نشد."; fi

# ---------------------------------------------------------------------
# ۳) بک‌آپ زمان‌دار کد و داده‌ها
# ---------------------------------------------------------------------
BK="$BACKUP_ROOT/$TS"; mkdir -p "$BK" || die "ساخت پوشهٔ بک‌آپ ممکن نشد."
say "بک‌آپ کد → $BK/code.tar.gz"
tar --exclude='./node_modules' --exclude="./$(basename "$DATA_DIR")" -czf "$BK/code.tar.gz" -C "$APP_DIR" . || die "بک‌آپ کد ناموفق."
if [ -d "$DATA_DIR" ]; then
  say "بک‌آپ داده → $BK/data/"
  mkdir -p "$BK/data"
  # JSON: کپی اتمیک؛ SQLite: از .backup استفاده می‌شود تا سازگار با WAL باشد
  for f in "$DATA_DIR"/*; do
    [ -e "$f" ] || continue
    case "$f" in
      *.sqlite|*.db) if command -v sqlite3 >/dev/null; then sqlite3 "$f" ".backup '$BK/data/$(basename "$f")'" || cp -a "$f" "$BK/data/"; else cp -a "$f" "$BK/data/"; cp -a "$f-wal" "$f-shm" "$BK/data/" 2>/dev/null || true; fi;;
      *) cp -a "$f" "$BK/data/";;
    esac
  done
  ( cd "$BK" && tar -czf data.tar.gz data && rm -r data ) 2>/dev/null || true
fi
[ -f "$APP_DIR/.env" ] && cp -a "$APP_DIR/.env" "$BK/.env.backup"
ok "بک‌آپ کامل شد: $(du -sh "$BK" | cut -f1) — $BK"

# ---------------------------------------------------------------------
# ۴) وابستگی‌ها، آزمون و build در incoming
# ---------------------------------------------------------------------
cd "$INCOMING" || die "incoming?"
[ -f server.cjs ] || die "server.cjs در incoming نیست."
[ -f dist/index.html ] || die "dist/index.html در incoming نیست."
grep -q 'addon.js' dist/index.html || die "dist/index.html نسخهٔ جدید نیست (addon.js تزریق نشده)."
if [ -f package.json ]; then
  if grep -q '"dependencies"' package.json && [ -f package-lock.json ]; then say "npm ci"; npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -3 | tee -a "$LOG" || die "نصب وابستگی‌ها ناموفق."; fi
  grep -q '"test"' package.json && { say "npm test"; npm test 2>&1 | tail -20 | tee -a "$LOG"; [ "${PIPESTATUS[0]}" = 0 ] || die "آزمون‌ها شکست خوردند."; }
  grep -q '"build"' package.json && { say "npm run build"; npm run build 2>&1 | tail -10 | tee -a "$LOG"; [ "${PIPESTATUS[0]}" = 0 ] || die "build ناموفق."; }
fi
node --check server.cjs || die "خطای نحوی در server.cjs"
node --check dist/addon.js || die "خطای نحوی در addon.js"
# آزمون دود روی پورت موقت با نسخهٔ کپی‌شدهٔ داده (به دادهٔ واقعی دست نمی‌زند)
SMOKE_PORT=3901; SMOKE_DATA="$(mktemp -d)"; [ -d "$DATA_DIR" ] && cp -a "$DATA_DIR"/. "$SMOKE_DATA"/ 2>/dev/null
say "آزمون دود روی 127.0.0.1:$SMOKE_PORT با کپی داده‌ها…"
( PORT=$SMOKE_PORT HOST=127.0.0.1 DATA_DIR="$SMOKE_DATA" BASE_URL="http://127.0.0.1:$SMOKE_PORT" node server.cjs > "$UPDATE_ROOT/smoke-$TS.log" 2>&1 & echo $! > "$UPDATE_ROOT/smoke.pid" )
sleep 1.5; SMOKE_OK=1
curl -sf -m 5 "http://127.0.0.1:$SMOKE_PORT/api/health" | grep -q '"ok":true' || SMOKE_OK=0
curl -sf -m 5 "http://127.0.0.1:$SMOKE_PORT/api/config" | grep -q '"orgs"' || SMOKE_OK=0
curl -sf -m 5 "http://127.0.0.1:$SMOKE_PORT/addon.js" | head -c 100 | grep -q 'گی‌میفای' || SMOKE_OK=0
[ -d "$DATA_DIR" ] && { OLD_USERS=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/app.json","utf8")).users.length)}catch{console.log(0)}' "$DATA_DIR"); NEW_USERS=$(curl -sf -m 5 "http://127.0.0.1:$SMOKE_PORT/api/players" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log(-1)}}'); say "کاربران قبل: $OLD_USERS → بعد از بارگذاری با نسخهٔ جدید: $NEW_USERS"; [ "$NEW_USERS" -ge "$(( OLD_USERS > 200 ? 200 : OLD_USERS ))" ] || SMOKE_OK=0; }
kill "$(cat "$UPDATE_ROOT/smoke.pid")" 2>/dev/null; rm -f "$UPDATE_ROOT/smoke.pid"
[ "$SMOKE_OK" = 1 ] || die "آزمون دود شکست خورد (لاگ: $UPDATE_ROOT/smoke-$TS.log). هیچ تغییری در برنامهٔ فعلی داده نشد."
ok "آزمون دود موفق."

# ---------------------------------------------------------------------
# ۵) آماده‌سازی در مسیر موقت و جایگزینی قابل‌بازگشت
# ---------------------------------------------------------------------
STAGE="$UPDATE_ROOT/staging-$TS"; mkdir -p "$STAGE"
say "آماده‌سازی نسخهٔ جدید در $STAGE"
tar --exclude='./update.sh' --exclude='./README-FA.md' --exclude='./CHANGELOG-FA.md' --exclude='./.git' -cf - -C "$INCOMING" . | tar -xf - -C "$STAGE"
[ -f "$APP_DIR/.env" ] && cp -a "$APP_DIR/.env" "$STAGE/.env"
# فایل‌های اضافی نسخهٔ فعلی که در بسته نیستند (مثلاً admin-config.json یا لوگوها) حفظ می‌شوند
if [ -d "$APP_DIR/dist" ]; then ( cd "$APP_DIR/dist" && find . -type f ! -name index.html ! -name addon.js ! -name addon.css -print0 ) | while IFS= read -r -d '' f; do [ -e "$STAGE/dist/$f" ] || { mkdir -p "$STAGE/dist/$(dirname "$f")"; cp -a "$APP_DIR/dist/$f" "$STAGE/dist/$f"; }; done; fi
[ -d "$APP_DIR/node_modules" ] && [ ! -d "$STAGE/node_modules" ] && cp -a "$APP_DIR/node_modules" "$STAGE/node_modules"

PREV="$UPDATE_ROOT/previous-$TS"
say "جایگزینی: $APP_DIR → $PREV ، سپس نسخهٔ جدید → $APP_DIR"
mv "$APP_DIR" "$PREV" || die "جابه‌جایی برنامهٔ فعلی ممکن نشد."
mv "$STAGE" "$APP_DIR" || { mv "$PREV" "$APP_DIR"; die "قرار دادن نسخهٔ جدید ممکن نشد؛ نسخهٔ قبلی برگردانده شد."; }
if [ "$DATA_INSIDE_APP" = 1 ]; then
  REL="${DATA_DIR#$APP_DIR/}"
  if [ -d "$PREV/$REL" ]; then mkdir -p "$(dirname "$APP_DIR/$REL")"; mv "$PREV/$REL" "$APP_DIR/$REL" || { mv "$APP_DIR" "$UPDATE_ROOT/failed-$TS"; mv "$PREV" "$APP_DIR"; die "انتقال پوشهٔ داده ممکن نشد؛ برگشت انجام شد."; }; ok "پوشهٔ داده بدون تغییر به جای خود منتقل شد: $DATA_DIR"; fi
fi

# ---------------------------------------------------------------------
# ۶) راه‌اندازی مجدد فقط همین سرویس و آزمایش
# ---------------------------------------------------------------------
say "راه‌اندازی مجدد ($MANAGER)…"; restart_service
if verify_service; then
  NEWV="$(curl -s -m 5 "http://127.0.0.1:$PORT_EXPECTED/api/health")"
  ok "به‌روزرسانی موفق. پاسخ سلامت: $NEWV"
  ok "بک‌آپ: $BK · نسخهٔ قبلی (برای بازگشت): $PREV"
  [ "${HAS_GOOGLE:-0}" -gt 0 ] || warn "GOOGLE_CLIENT_ID/SECRET در env سرویس تنظیم نیست؛ دکمهٔ ورود با گوگل تا تنظیم آن به روش قبلی کار می‌کند (راهنما را ببینید)."
  [ -f "$DATA_DIR/admin-key.txt" ] && say "کلید مدیر پنل نظارت: cat $DATA_DIR/admin-key.txt"
  say "بازگشت دستی در صورت نیاز:  cd $INCOMING && bash update.sh --rollback"
  exit 0
fi
warn "آزمایش پس از به‌روزرسانی شکست خورد → بازگشت خودکار به نسخهٔ قبلی"
mv "$APP_DIR" "$UPDATE_ROOT/failed-$TS"; mv "$PREV" "$APP_DIR"
if [ "$DATA_INSIDE_APP" = 1 ]; then REL="${DATA_DIR#$APP_DIR/}"; [ -d "$UPDATE_ROOT/failed-$TS/$REL" ] && mv "$UPDATE_ROOT/failed-$TS/$REL" "$APP_DIR/$REL"; fi
restart_service
verify_service && die "بازگشت خودکار انجام شد؛ سرویس قبلی برقرار است. نسخهٔ ناموفق در $UPDATE_ROOT/failed-$TS نگه داشته شد (لاگ: $LOG)." || die "بازگشت انجام شد اما سرویس پاسخ نمی‌دهد! لاگ سرویس و $BK را بررسی کنید."
