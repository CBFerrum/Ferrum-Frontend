// The icon on a left-menu row, resolved by one governed function (docs/design/PATTERNS.md, "Navigation icons").
// Names only: the drawing is in NavIcon.tsx, so tests and the frame resolve without waiting for any icon.
// Order of sources: the icon the row declares, then the concept dictionary below keyed on the entity's stable
// name (never its translated label), then the row's kind. The same concept has the same icon in every app:
// add a concept here, never in an app.

/** [lucide name, concepts]. A concept is one word or several ("price list"), singular, lower case, comma-separated. */
const CONCEPTS: [string, string][] = [
  // money and documents
  ["receipt", "invoice, bill, billing, voucher, statement"],
  ["file-warning", "dunning"],
  ["clipboard-list", "order, work order, collect order, pick, job card"],
  ["clipboard-pen", "request, requisition"],
  ["calculator", "quotation, supplier quotation, request for quotation, estimate, tender, bid"],
  ["credit-card", "payment, payment entry, payment request, mode of payment, coupon"],
  ["banknote", "cash, fee, refund, royalty, charge, cash movement"],
  ["landmark", "account, bank, ledger, finance book, fiscal year, government, closing voucher"],
  ["arrow-left-right", "bank transaction, transfer, movement, exchange rate, revaluation, allocation, reconciliation, stock reconciliation"],
  ["notebook", "journal, journal entry"],
  ["percent", "tax, vat, gst, slab, exemption, taxability, tax rate, tax template, discount"],
  ["piggy-bank", "budget, saving, advance"],
  ["wallet", "payroll, salary, wage, loan, expense claim, reimbursement, salary component"],
  ["coins", "currency, cost, cost center, pricing"],
  ["hand-coins", "grant, fund, funding"],
  ["hand-heart", "donation, donor, volunteer"],
  ["tag", "price, rate, plan, tier, price list, discount code, rate plan"],
  ["tags", "type, category, group, class, kind, attribute, ticket type, leave type"],
  // stock and logistics
  ["package", "item, product, bundle, sku, variant, variation, catalog"],
  ["layers", "batch, lot, series"],
  ["box", "asset, equipment"],
  ["boxes", "stock entry, inventory, material, stock"],
  ["package-check", "packing slip, proof of delivery, goods, receipt"],
  ["package-open", "unpack"],
  ["container", "handling unit, handling unit type"],
  ["warehouse", "warehouse, depot, bin, zone, cell, storage, replenishment"],
  ["truck", "shipment, delivery, delivery note, carrier, transport, trip, freight, inbound"],
  ["route", "route"],
  ["car", "vehicle, fleet"],
  ["fuel", "fuel"],
  ["factory", "supplier, vendor, manufacturer, plant, production, franchisee, operation, workstation, routing, bom, work station"],
  ["list-checks", "pick list, pick wave, wave, checklist, cycle count"],
  ["undo-2", "return, return authorization, return reason, store return"],
  ["map-pin", "location, address, site, territory, area, outlet, branch"],
  // people
  ["user", "employee, staff, driver, technician, practitioner, instructor, partner, owner, operator, user, agent"],
  ["users", "customer, client, member, guest, team, group, audience, segment, recipient, subscriber, buyer, role, membership"],
  ["contact", "contact, marketing contact"],
  ["heart-pulse", "patient, health, appointment type"],
  ["graduation-cap", "student, student applicant, program enrollment, enrollment, alumni"],
  ["user-plus", "applicant, onboarding, recruit, prospect"],
  ["briefcase", "job opening, job offer, interview, designation, recruitment, job applicant"],
  ["building-2", "department, company, building, property, franchise"],
  ["id-card", "profile, identity, badge, employment type, card"],
  ["user-check", "attendance, attendance request, checkin, check in"],
  // time and work
  ["calendar-off", "leave, holiday, time off, absence"],
  ["calendar-check", "scheduled"],
  ["calendar-clock", "appointment, booking, reservation, schedule, event, slot, visit, calendar"],
  ["clock", "shift, time, hour, period"],
  ["timer", "timesheet, activity, activity cost, downtime"],
  ["folder-kanban", "project, portfolio, program, board"],
  ["square-check", "task, todo, assignment"],
  ["goal", "objective, key result, okr, goal, target"],
  ["award", "appraisal, assessment, result, report card, grading scale, scorecard"],
  ["calendar-range", "academic year, year, cycle"],
  ["school", "classroom, school, campus"],
  ["trending-up", "index, growth, insight"],
  ["repeat", "subscription, recurring"],
  ["replace", "change, change request"],
  ["newspaper", "article"],
  ["chart-pie", "distribution, monthly distribution"],
  // service, risk and compliance
  ["life-buoy", "ticket, case, support, helpdesk, service level agreement, sla"],
  ["siren", "incident, alarm, alert, escalation, emergency"],
  ["triangle-alert", "risk, problem, hazard, nonconformance, hold, exception, failure"],
  ["shield-check", "control, policy, audit, compliance, capa, quality, acknowledgement"],
  ["search-check", "finding, test, verification, review"],
  ["clipboard-check", "inspection, quality inspection, acceptance procedure, run, check"],
  ["file-signature", "contract, agreement, sign, signature, consent"],
  ["scroll", "obligation, clause, term, condition"],
  ["stamp", "permit, license, certificate, approval"],
  ["file-check", "application, claim, warranty, progress claim"],
  ["wrench", "maintenance, repair, service, skill, service skill, calibration"],
  ["hard-hat", "construction, site diary"],
  // sales and marketing
  ["target", "lead, opportunity, deal, pipeline, stage, lost reason, scoring"],
  ["handshake", "buying role, subcontract, subcontracting"],
  ["megaphone", "campaign, newsletter, announcement, marketing, journey, social"],
  ["mail", "email, mail, mailbox, inbox, email template, email group"],
  ["message-square", "chat, message, comment, communication, reply, sms, chat channel"],
  ["share-2", "share, link, publication, social post"],
  ["globe", "website, web, page, storefront, store, portal"],
  ["shopping-cart", "cart, shop, checkout"],
  ["sparkles", "loyalty, loyalty program, loyalty point"],
  // places and hospitality
  ["bed-double", "room, stay, folio, hotel, housekeeping, night audit"],
  ["door-open", "unit, room type"],
  ["key", "lease, tenancy, key"],
  ["utensils", "table, menu, kitchen, dining, restaurant, food"],
  ["book-open", "course, lesson, lms, curriculum, learning, subject, grading, chapter, quiz, question, training, cohort, instructor led"],
  ["stethoscope", "clinic, doctor"],
  // data, devices, automation
  ["gauge", "metric, kpi, measure, meter"],
  ["database", "dataset, data, source, snapshot, external source"],
  ["cpu", "device, sensor, firmware, definition"],
  ["radio", "gateway, edge, broker"],
  ["workflow", "rule, automation, workflow, flow, envelope, condition, rollout, release"],
  ["layout-template", "template, layout, form"],
  ["layout-dashboard", "dashboard, number card, chart"],
  ["history", "log, history, entry, version, trail"],
  ["settings", "settings, setup, configuration, config, preference"],
  ["folder", "folder, drive, space, workspace"],
  ["file-text", "file, document, doc, media, content"],
  ["cloud", "cloud, hosting, hosted, secret"],
  ["languages", "interface word, language, translation"],
  ["plug", "connector, integration"],
  ["file-spreadsheet", "report, sheet, spreadsheet"],
  ["file-input", "import"],
  ["file-output", "export"],
  ["scale", "uom, weight, unit of measure"],
  ["lock", "lock, lockout, freeze"],
  ["flask-conical", "lab, sample, example"],
  // phrases that outrank their head noun
  ["award", "assessment plan, grade"],
  ["clipboard-check", "inspection plan"],
  ["factory", "production plan"],
  ["mail", "email account"],
  ["share-2", "social account"],
  ["tag", "rate table"],
  ["star", "star, item review, favourite"],
  ["workflow", "edge condition"],
  ["circle-alert", "issue"],
  ["percent", "vat return"],
  ["history", "drive activity"],
  ["file-signature", "consent form, sign event"],
  ["file-input", "form response"],
  ["megaphone", "journey enrollment"],
  ["wallet", "payroll entry"],
  ["store", "pos closing entry, pos opening entry, pos"],
  ["calendar-off", "leave ledger entry"],
  ["utensils", "kitchen ticket"],
  ["fuel", "fuel log"],
  ["wrench", "maintenance log"],
  ["tag", "pricing rule, price rule"],
  ["calendar-clock", "payment terms template"],
];

const stem = (w: string) => (w.length > 3 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length < 4 || /(ss|us|is)$/.test(w) || !w.endsWith("s") ? w : w.slice(0, -1));

/** Concept (stemmed words joined by a space) to icon; the first listing of a concept wins. */
export const DICTIONARY: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [icon, list] of CONCEPTS) for (const c of list.split(",")) m.set(c.trim().split(" ").map(stem).join(" "), m.get(c.trim().split(" ").map(stem).join(" ")) ?? icon);
  return m;
})();
const LONGEST = Math.max(...[...DICTIONARY.keys()].map((k) => k.split(" ").length));

/** Icons a row may declare besides the dictionary's: Home, the kinds, and the app tiles' own set. */
const EXTRA = [
  "house", "chart-column", "app-window", "list", "external-link", "layout-grid", "calendar", "circle-help", "hard-drive", "headset", "presentation", "server", "sheet", "signature", "store", "video", "inbox", "search",
  "bell", "shield", "puzzle", "play", "bookmark", "panel-top", "sliders-horizontal",
];
/** Every name the drawing (NavIcon.tsx) has: what a declared name must be to be used. */
export const NAV_ICON_NAMES: ReadonlySet<string> = new Set([...DICTIONARY.values(), ...EXTRA]);

/** Names the shell's older icon registry used on rows, as lucide names. `file` and `chart` were kind markers, not choices. */
const LEGACY: Record<string, string> = { chart: "chart-column", dashboard: "layout-dashboard", space: "panel-top", doc: "file-text", apps: "layout-grid", check: "square-check", chat: "message-square", home: "house", external: "external-link", board: "folder-kanban" };

export type NavKind = "home" | "report" | "page" | "settings" | "document" | "list" | "master" | "child" | "ledger";
export interface NavIconInput {
  /** What the row declares (metadata `icon`, an app's nav item): a lucide name in kebab-case. */
  icon?: string | null;
  /** The entity's stable name (not its translated label), CamelCase or snake_case. */
  entity?: string | null;
  /** Report, page of the app's own, Home, or an entity's kind. */
  kind?: NavKind | string | null;
  submittable?: boolean;
  /** The row's address, which says what it is when nothing else does (`/r/…` a report, `/x/…` a page, `/` Home). */
  to?: string;
}

const warned = new Set<string>();

/** The words of a stable name: "PosInvoice" and "pos_invoice" are both pos, invoice. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => stem(w.toLowerCase()));
}

/** The concept's icon: the longest run of whole words the dictionary knows, the last such run when equal (the head noun is last). */
export function conceptIcon(entity: string): string | null {
  const w = nameWords(entity);
  let best: { n: number; at: number; icon: string } | null = null;
  for (let at = 0; at < w.length; at++)
    for (let n = Math.min(LONGEST, w.length - at); n >= 1; n--) {
      const icon = DICTIONARY.get(w.slice(at, at + n).join(" "));
      if (icon && (!best || n > best.n || (n === best.n && at > best.at))) best = { n, at, icon };
    }
  return best?.icon ?? null;
}

/** The icon name for a row; never empty. */
export function navIcon({ icon, entity, kind, submittable, to }: NavIconInput): string {
  const declared = icon && icon !== "file" && icon !== "chart" ? (LEGACY[icon] ?? icon) : null;
  if (declared) {
    if (NAV_ICON_NAMES.has(declared)) return declared;
    if (import.meta.env?.DEV && !warned.has(declared)) {
      warned.add(declared);
      console.info(`navIcon: "${declared}" is not an icon the menu draws; using the row's concept or kind`);
    }
  }
  const asKind = kind ?? (icon === "chart" || to?.startsWith("/r/") ? "report" : to === "/" ? "home" : to?.startsWith("/x/") ? "page" : null);
  const name = entity ?? (to?.startsWith("/e/") ? decodeURIComponent(to.slice(3).split(/[/?#]/)[0] ?? "") : null);
  const byConcept = asKind === "report" || asKind === "home" || asKind === "page" ? null : name ? conceptIcon(name) : null;
  if (byConcept) return byConcept;
  if (asKind === "report") return "chart-column";
  if (asKind === "home") return "house";
  if (asKind === "page") return "app-window";
  if (asKind === "settings") return "settings";
  return submittable || asKind === "document" ? "file-text" : "list";
}
