#!/usr/bin/env python3
"""Copy new Explee hot leads into HubSpot contacts.

Runs every ~10 minutes. It keeps no state file: the polling cursor is the
newest "Explee became hot at" date already stored in HubSpot, so a run on a
fresh machine carries on exactly where the last one stopped.

Each lead is matched on its Explee person_id (a unique HubSpot property),
then on email, and updated if it is already there; otherwise it is created.

API keys are never in this file: the session's network proxy adds them to
requests for api.explee.com and api.hubapi.com. The placeholder values below
are overwritten by the proxy. To run it elsewhere, set EXPLEE_API_KEY and
HUBSPOT_TOKEN.
"""
import os
import sys
import time

import requests

EXPLEE = "https://api.explee.com/public/api/v1"
HUBSPOT = "https://api.hubapi.com"
PROJECT_ID = 70435

EX_H = {"X-API-Key": os.environ.get("EXPLEE_API_KEY", "proxy-injected")}
HS_H = {"Authorization": "Bearer " + os.environ.get("HUBSPOT_TOKEN", "proxy-injected"),
        "Content-Type": "application/json"}

GROUP = "contactinformation"  # built-in group; creating a new group needs extra scopes
PROPS = [
    # name, label, type, fieldType, unique
    ("explee_person_id", "Explee person ID", "string", "text", True),
    ("explee_why_hot", "Explee: why hot (their reply)", "string", "textarea", False),
    ("explee_became_hot_at", "Explee: became hot at", "datetime", "date", False),
    ("explee_replied_at", "Explee: replied at", "datetime", "date", False),
    ("explee_campaign_id", "Explee campaign ID", "string", "text", False),
]


def call(method, url, headers, **kw):
    """HTTP call with retries on rate limits and server errors."""
    for attempt in range(5):
        r = requests.request(method, url, headers=headers, timeout=60, **kw)
        if r.status_code in (429, 500, 502, 503, 504):
            wait = float(r.headers.get("Retry-After") or 2 ** attempt)
            time.sleep(min(wait, 30))
            continue
        return r
    return r


def ok(r, what):
    if r.status_code >= 300:
        sys.exit(f"ERROR {what}: HTTP {r.status_code} {r.text[:500]}")
    return r.json() if r.text else {}


def ensure_properties():
    existing = {p["name"] for p in ok(call("GET", f"{HUBSPOT}/crm/v3/properties/contacts", HS_H), "list properties")["results"]}
    for name, label, typ, field, unique in PROPS:
        if name in existing:
            continue
        body = {"name": name, "label": label, "type": typ, "fieldType": field, "groupName": GROUP}
        if unique:
            body["hasUniqueValue"] = True
        ok(call("POST", f"{HUBSPOT}/crm/v3/properties/contacts", HS_H, json=body), f"create property {name}")
        print("created HubSpot property", name)


def search_one(filters, props=("email",), sort=None):
    body = {"filterGroups": [{"filters": filters}], "properties": list(props), "limit": 1}
    if sort:
        body["sorts"] = [sort]
    res = ok(call("POST", f"{HUBSPOT}/crm/v3/objects/contacts/search", HS_H, json=body), "search contacts")["results"]
    return res[0] if res else None


def last_cursor():
    c = search_one([{"propertyName": "explee_became_hot_at", "operator": "HAS_PROPERTY"}],
                   props=("explee_became_hot_at",),
                   sort={"propertyName": "explee_became_hot_at", "direction": "DESCENDING"})
    return c["properties"]["explee_became_hot_at"] if c else None


def fetch_hot_leads(since):
    leads, offset = [], 0
    while True:
        params = {"project_id": PROJECT_ID, "source": "agent", "limit": 200, "offset": offset}
        if since:
            params["since"] = since
        d = ok(call("GET", f"{EXPLEE}/autogtm/hot-leads", EX_H, params=params), "fetch hot leads")
        leads += d["leads"]
        if not d.get("has_more") or d.get("next_offset") is None:
            return leads
        offset = d["next_offset"]


def contact_props(lead):
    name = (lead.get("name") or "").strip()
    first, _, last = name.partition(" ")
    p = {
        "firstname": first, "lastname": last,
        "email": lead.get("email"), "jobtitle": lead.get("job_title"),
        "company": lead.get("company_name"), "website": lead.get("company_domain"),
        "hs_linkedin_url": lead.get("linkedin_url"), "country": lead.get("country"),
        "phone": lead.get("phone"),
        "explee_person_id": lead["person_id"],
        "explee_why_hot": lead.get("why_hot"),
        "explee_became_hot_at": lead.get("became_hot_at"),
        "explee_replied_at": lead.get("replied_at"),
        "explee_campaign_id": str(lead.get("campaign_id") or ""),
    }
    return {k: v for k, v in p.items() if v not in (None, "")}


def upsert(lead):
    props = contact_props(lead)
    found = search_one([{"propertyName": "explee_person_id", "operator": "EQ", "value": lead["person_id"]}])
    if not found and lead.get("email"):
        found = search_one([{"propertyName": "email", "operator": "EQ", "value": lead["email"]}])
    if found:
        if (found["properties"].get("email") or "").lower() not in ("", (lead.get("email") or "").lower()):
            props.pop("email", None)  # don't overwrite a different email someone set by hand
        ok(call("PATCH", f"{HUBSPOT}/crm/v3/objects/contacts/{found['id']}", HS_H, json={"properties": props}), "update contact")
        return "updated"
    props["lifecyclestage"] = "lead"
    props["hs_lead_status"] = "NEW"
    ok(call("POST", f"{HUBSPOT}/crm/v3/objects/contacts", HS_H, json={"properties": props}), "create contact")
    return "created"


def main():
    ensure_properties()
    since = last_cursor()
    leads = [l for l in fetch_hot_leads(since) if not l.get("erased")]
    leads.sort(key=lambda l: l.get("became_hot_at") or "")  # oldest first, so the cursor only moves forward
    counts = {"created": 0, "updated": 0}
    for lead in leads:
        res = upsert(lead)
        counts[res] += 1
        print(res, lead.get("name"), "|", lead.get("company_name"), "|", lead.get("became_hot_at"))
    print(f"done: since={since or 'beginning'} fetched={len(leads)} created={counts['created']} updated={counts['updated']}")


if __name__ == "__main__":
    main()
