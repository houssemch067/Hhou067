#!/bin/sh
# Vide la base locale de test (wrangler dev)
cd "$(dirname "$0")/.." && npx wrangler d1 execute dentagest-test --local --command "DELETE FROM users; DELETE FROM sessions; DELETE FROM records; DELETE FROM audit; DELETE FROM cabinets; DELETE FROM wa_config; DELETE FROM wa_convos; DELETE FROM wa_requests; DELETE FROM wa_usage; DELETE FROM wa_seen;" >/dev/null 2>&1
