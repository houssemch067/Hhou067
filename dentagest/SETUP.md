# DentaGest Pro: WhatsApp AI assistant

DentaGest Pro costs **4,000 DA/month** or **40,000 DA/year**. It includes everything in Standard, plus an AI assistant that answers patients on the office's WhatsApp. The assistant:

- answers in French, Arabic or Darija, 24 hours a day;
- gives the office's hours, address and prices, using only what the dentist entered;
- finds free slots and books appointments, which appear in the DentaGest agenda automatically;
- passes on cancellations and messages, and flags urgent cases to the dentist.

## How it fits together

```
Patient (WhatsApp) ──> Meta WhatsApp Cloud API ──> dentagest-assistant (Cloudflare Worker + D1)
                                                        │  Claude (Anthropic API) + 3 tools:
                                                        │  find free slots · book · send a message
DentaGest app (dentist's phone or PC) <── syncs every 2 min ──┘
  sends: office details + busy slots (date, time, duration; no patient names)
  receives: bookings made by the assistant ──> added to the agenda + "Demandes" inbox
```

Patient records stay on the dentist's device. The server stores only:
- the office details;
- the busy time slots;
- WhatsApp conversations, deleted after 30 days;
- requests the assistant created, deleted 30 days after the app has fetched them.

| Folder | What it is |
|---|---|
| `assistant-worker/` | **New** worker `dentagest-assistant`: WhatsApp webhook, Claude agent, API for the app, admin endpoints |
| `paiement-worker/` | Your `dentagest-paiement` worker with the `pm`/`py` Pro plans added, plus `POST /admin/licence` to issue codes for BaridiMob payments |
| `app/index.html` | The DentaGest page with the Pro tier on the pricing screen, the "Assistante IA WhatsApp" card in Paramètres, and the requests banner and inbox |

## 1. Accounts you need (one time)

1. **Anthropic API key**: create one at console.anthropic.com.
2. **Meta / WhatsApp Cloud API**:
   - Create a Meta Business account and an app with the WhatsApp product (developers.facebook.com).
   - To connect *your clients'* numbers, the app must become a **Tech Provider**, which requires business verification.
   - Write down the **App Secret** (App settings > Basic).
   - Create a **System User** with a permanent token that has `whatsapp_business_messaging` and `whatsapp_business_management`.
   - Choose any random string as your **verify token**.

## 2. Deploy the assistant

```bash
cd dentagest/assistant-worker
npm install
npx wrangler d1 create dentagest-assistant        # copy the database_id into wrangler.toml
npx wrangler d1 execute dentagest-assistant --remote --file schema.sql
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put WA_TOKEN            # System User token
npx wrangler secret put WA_APP_SECRET       # Meta App Secret
npx wrangler secret put WA_VERIFY_TOKEN     # your random string
npx wrangler secret put ADMIN_KEY           # a long random password, for you only
npx wrangler deploy
```

In the Meta app, go to WhatsApp > Configuration > Webhook and set:
- URL: `https://dentagest-assistant.dentagestdz.workers.dev/webhook`
- Verify token: the one above.

Then subscribe to the **messages** field.

## 3. Deploy the payment worker and the app

- **Payment worker**: `cd dentagest/paiement-worker && npx wrangler deploy`. Its secrets are already set on Cloudflare.
- **App**: copy `dentagest/app/index.html` over `public/index.html` in your DentaGest DZ project, then deploy it as usual.
- **Service worker**: if `sw.js` caches the page, bump its cache version so installed apps pick up the new page.

## 4. Selling Pro to a dentist

**BaridiMob (manual)**: once you've checked the payment receipt, issue a code:

```bash
curl -X POST https://dentagest-paiement.dentagestdz.workers.dev/admin/licence \
  -H "Authorization: Bearer <STATS_KEY>" \
  -d '{"device":"DG-XXXX-XXXX","plan":"pm"}'   # pm = Pro monthly, py = Pro yearly
```

Send the `code` back to the dentist; they paste it into *Abonnement > Code d'activation*.

**Card payments (Chargily)** handle `pm`/`py` automatically once `CHARGILY_SECRET` is set.

Plan changes:
- Renewing the same tier extends the end date.
- Upgrading from Standard to Pro starts Pro on the payment day. The remaining Standard days are not carried over.

## 5. Connecting a dentist's WhatsApp number

1. In DentaGest the dentist goes to *Paramètres > Assistante IA WhatsApp*. They fill in hours, prices and an urgent-contact number, tick "L'assistante répond", and tap **Enregistrer et synchroniser**. This registers their office on the server.
2. They tap **Demander la mise en service**, which sends you their device code and WhatsApp number over WhatsApp.
3. Onboard their number in your Meta app with Embedded Signup. Use **WhatsApp Business app coexistence** so the dentist keeps using the WhatsApp Business app on their phone. They then see the assistant's conversations and can reply themselves. Without coexistence the number only works through the API, and the dentist can no longer read its messages.
4. Link the number to the office using the phone number ID shown in Meta's WhatsApp Manager:

```bash
curl -X POST https://dentagest-assistant.dentagestdz.workers.dev/admin/connect \
  -H "Authorization: Bearer <ADMIN_KEY>" \
  -d '{"device":"DG-XXXX-XXXX","wa_phone_id":"1234567890","wa_display":"+213 555 12 34 56"}'
```

- `GET /admin/cabinets` lists all Pro offices.
- `POST /admin/disconnect {"device":…}` unlinks a number.

The assistant stops replying in three cases:
- the dentist unticks the switch;
- the Pro plan expires;
- the number is disconnected.

The dentist then answers from the WhatsApp Business app as before.

## 6. Running costs (check against current prices)

- **Claude**: the default model is `claude-opus-5-5` at low effort, with prompt caching and automatic fallback if the model declines a request. A typical booking conversation (5–8 patient messages) costs roughly **$0.10–0.25** on that model.
  - A busy office with 150 conversations a month would cost about $15–35, which is a large share of 4,000 DA.
  - To cut that by about 20×, set `CLAUDE_MODEL = "claude-haiku-5-5"` in `wrangler.toml` and redeploy. Test it in Darija first.
- **WhatsApp**: replies to messages the patient sent are free under Meta's current pricing. The assistant never starts conversations itself.
- **Cloudflare**: Workers and D1 stay within the free or $5 plan at this scale.

## 7. Before going live

- **Test with your own number first**: write in French, Arabic, Darija and Arabizi; book, cancel, and simulate an urgent case.
- **Patients should know they're talking to an AI.** The assistant says so in its first message.
- **Algeria's law 18-07 on personal data** covers health-related data. Patient messages pass through Meta, Cloudflare and Anthropic. Mention this in the office's privacy notice, and check whether you need to declare it to the ANPDP. This is not legal advice.
- **Voice messages are not transcribed yet.** The assistant asks the patient to type instead.

## Tests

```bash
cd dentagest/assistant-worker && npm test   # 15 tests: slots, licence, API, webhook, conversation flow (fake Claude/WhatsApp)
cd dentagest/paiement-worker && npm test    # 2 tests: Pro codes, tier changes
```
