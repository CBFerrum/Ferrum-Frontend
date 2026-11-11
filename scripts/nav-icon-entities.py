#!/usr/bin/env python3
"""Regenerates packages/kit/src/navIconName.entities.json: the entity names each app puts in a left menu, keyed by app.
Run from anywhere: python3 scripts/nav-icon-entities.py > packages/kit/src/navIconName.entities.json
Menu rows are the entities that are not `kind: child`. The shared platform packages (customers, items, price lists,
currencies, contacts) show in the ERP's menu, and the contact book and customer/item masters in the CRM's."""
import glob, json, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
out = {}

def scan(files, key):
    for f in files:
        for blk in re.split(r"\n(?=- name: )", open(f).read()):
            m = re.match(r"- name: ([A-Za-z]+)", blk)
            if not m:
                continue
            k = re.search(r"^  kind: (\w+)", blk, re.M)
            if not (k and k.group(1) == "child"):
                out.setdefault(key, set()).add(m.group(1))

for d in sorted(glob.glob(ROOT + "/ferrum-app-*")):
    app = os.path.basename(d)[len("ferrum-app-"):]
    scan(glob.glob(d + "/packages/*/entities/*.yaml") + glob.glob(d + "/addons/*/packages/*/entities/*.yaml"), app)
scan(glob.glob(ROOT + "/platform/packages/*/entities/*.yaml"), "platform")
shared = out.pop("platform", set())
out.setdefault("erp", set()).update(shared)
out.setdefault("crm", set()).update(shared & {"Contact", "Address", "Customer", "Item"})
print(json.dumps({k: sorted(v) for k, v in sorted(out.items())}, indent=1))
