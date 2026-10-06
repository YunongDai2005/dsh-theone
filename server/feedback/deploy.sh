#!/bin/sh
# One-step deploy of the feedback receiver, then a self-check. Safe to run again.
#   sh server/feedback/deploy.sh
set -e
cd "$(dirname "$0")"
W="npx --yes wrangler@4"

$W whoami 2>&1 | grep -qi "not authenticated" && $W login

# The database: reuse it if it exists, otherwise create it; its id goes into wrangler.toml.
if grep -q REPLACE_WITH_DATABASE_ID wrangler.toml; then
  ID=$($W d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const db=JSON.parse(s).find(d=>d.name==="theone-feedback");if(db)console.log(db.uuid)}catch{}})')
  [ -n "$ID" ] || ID=$($W d1 create theone-feedback 2>&1 | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  [ -n "$ID" ] || { echo "Could not create or find the D1 database theone-feedback." >&2; exit 1; }
  sed -i.bak "s/REPLACE_WITH_DATABASE_ID/$ID/" wrangler.toml && rm -f wrangler.toml.bak
fi
$W d1 execute theone-feedback --remote --file=schema.sql --yes

$W deploy

# Secrets: the inbox is asked once; the salt is random and never needs to be known.
if ! $W secret list 2>/dev/null | grep -q MAIL_TO; then
  printf 'Your inbox for reports (verified under Email Routing → Destination addresses): '
  read -r INBOX
  printf '%s' "$INBOX" | $W secret put MAIL_TO
fi
$W secret list 2>/dev/null | grep -q IP_SALT || openssl rand -hex 16 | $W secret put IP_SALT

echo
echo "Self-check:"
# A new custom domain can take a minute to answer.
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do curl -fsS https://feedback.yulid.org/v1/health 2>/dev/null && break; sleep 5; done
echo
curl -fsS -X POST https://feedback.yulid.org/v1/reports -H 'content-type: application/json' \
  -d '{"v":1,"app":"theone","version":"0.3.21","lang":"zh","description":"部署自检：收到这封邮件说明反馈服务正常。"}' && echo
echo "Done. An email titled \"[TheOne FB-…] 0.3.21 · 部署自检…\" should arrive (check spam once)."
