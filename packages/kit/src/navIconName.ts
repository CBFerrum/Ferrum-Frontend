// The icon on a left-menu row, resolved by one governed function (docs/design/PATTERNS.md, "Navigation icons").
// Names only: the drawing is in NavIcon.tsx, so tests and the frame resolve without waiting for any icon.
// Order of sources: the icon the row declares, then the concept dictionary below keyed on the entity's stable
// name (never its translated label), then the row's kind. The same concept has the same icon in every app:
// add a concept here, never in an app.

/** [lucide name, concepts]. A concept is one word or several ("price list"), singular, lower case, comma-separated. */
export const CONCEPTS: [string, string][] = [
  // money and documents
  ["receipt", "invoice, bill, billing, voucher, statement, folio, expense claim, expense, reimbursement"],
  ["receipt-text", "salary slip, payslip"],
  ["mail-warning", "dunning"],
  ["clipboard-list", "order, collect order, job card, sales order, service work order, pick"],
  ["shopping-bag", "purchase order, purchase"],
  ["hammer", "work order, repair"],
  ["clipboard-pen", "request, requisition"],
  ["calculator", "quotation, supplier quotation, request for quotation, estimate, tender, bid"],
  ["credit-card", "payment, payment entry, payment request, mode of payment"],
  ["ticket-percent", "coupon"],
  ["banknote", "cash, fee, refund, royalty, charge, cash movement, encashment"],
  ["banknote-arrow-up", "advance"],
  ["landmark", "bank, bank account, government"],
  ["list-tree", "account"],
  ["book-open", "ledger, finance book"],
  ["calendar-range", "fiscal year, academic year, year, cycle, period, monthly distribution"],
  ["lock", "lock, lockout, freeze, closing voucher, pos closing entry"],
  ["arrow-left-right", "bank transaction, transfer, exchange rate"],
  ["move", "movement"],
  ["refresh-cw", "revaluation, exchange revaluation, sync"],
  ["split", "allocation"],
  ["diff", "reconciliation, stock reconciliation"],
  ["notebook", "journal, journal entry"],
  ["percent", "tax, vat, gst, slab, exemption, tax rate, vat rate, discount"],
  ["badge-percent", "taxability, pricing rule, price rule"],
  ["file-check", "vat return, application, claim, warranty, progress claim"],
  ["piggy-bank", "budget, saving, fund, funding"],
  ["hand-coins", "loan, grant"],
  ["hand-heart", "donation"],
  ["heart-handshake", "donor"],
  ["hand-helping", "volunteer"],
  ["wallet", "payroll, salary, wage, payroll entry, spend"],
  ["circle-plus", "additional salary"],
  ["blocks", "bom, subcontracting bom, salary component"],
  ["layers", "batch, lot, series, salary structure, salary structure assignment"],
  ["file-input", "import, form response, payroll opening"],
  ["tag", "price, rate, plan, tier, price list, discount code, rate plan"],
  ["table-2", "rate table"],
  ["calendar-sync", "subscription, recurring, report schedule"],
  ["tags", "type, category, group, class, kind, attribute"],
  ["coins", "currency, cost, pricing"],
  ["chart-pie", "distribution, cost center"],
  ["hourglass", "payment term, payment terms template"],
  // stock and logistics
  ["package", "item, product, sku, variant, catalog"],
  ["package-plus", "bundle"],
  ["server", "configuration item"],
  ["box", "asset, equipment, resource"],
  ["boxes", "stock entry, inventory, material, stock"],
  ["package-check", "packing slip, proof of delivery, goods, receipt"],
  ["package-open", "unpack"],
  ["container", "handling unit, handling unit type"],
  ["warehouse", "warehouse, depot, cell, storage, replenishment, managed warehouse"],
  ["archive", "bin, storage bin"],
  ["layout-grid", "zone, storage zone"],
  ["truck", "shipment, delivery, delivery note, carrier, transport, trip, freight, inbound"],
  ["ship", "landed cost, landed cost voucher"],
  ["route", "route, routing, journey, learning path"],
  ["car", "vehicle, fleet"],
  ["fuel", "fuel"],
  ["factory", "supplier, vendor, manufacturer, plant, production"],
  ["cog", "operation"],
  ["drill", "workstation, work station"],
  ["chart-gantt", "production plan"],
  ["list-checks", "pick list, pick wave, wave, checklist"],
  ["rotate-ccw", "cycle count"],
  ["undo-2", "return, return authorization, return reason, store return"],
  ["map-pin", "location, address, site, territory, area, outlet, branch"],
  // people
  ["user", "employee, staff, driver, technician, instructor, partner, owner, operator, user, agent"],
  ["users", "customer, client, member, guest, team, audience, segment, recipient, subscriber, buyer, role, cohort, email group"],
  ["contact", "contact, marketing contact"],
  ["heart-pulse", "patient, health"],
  ["stethoscope", "clinic, doctor, practitioner"],
  ["graduation-cap", "student, alumni"],
  ["user-plus", "lead, onboarding, recruit, enrollment, program enrollment, email group member"],
  ["user-search", "prospect"],
  ["file-user", "applicant, job applicant"],
  ["user-minus", "separation"],
  ["user-pen", "attendance request"],
  ["user-cog", "assignment rule"],
  ["briefcase", "job opening, recruitment"],
  ["mail-check", "job offer"],
  ["messages-square", "interview"],
  ["building-2", "department, company, building, property, franchise, hotel"],
  ["id-card", "profile, identity, employment type, card, membership"],
  ["user-check", "attendance, check in"],
  ["log-in", "checkin"],
  // time and work
  ["calendar-off", "leave, absence, time off"],
  ["calendar-heart", "holiday"],
  ["calendar-plus", "leave allocation"],
  ["calendar-check", "scheduled"],
  ["calendar-clock", "appointment, booking, reservation, schedule, event, slot, visit, calendar"],
  ["calendar-cog", "maintenance schedule"],
  ["clock", "shift, time, hour"],
  ["timer", "timesheet, activity cost, downtime"],
  ["activity", "activity"],
  ["folder-kanban", "project, portfolio, program, board"],
  ["square-check", "task, todo, assignment"],
  ["goal", "objective, okr, goal, target"],
  ["chart-line", "key result"],
  ["award", "appraisal, result, assessment result, scorecard, grade"],
  ["notebook-pen", "assessment, assessment plan"],
  ["ruler", "grading scale, grading, calibration"],
  ["file-badge", "report card, full and final statement"],
  ["school", "classroom, school, campus"],
  ["trending-up", "index, growth, insight, promotion"],
  ["trending-down", "value adjustment"],
  ["replace", "change, change request, variation"],
  ["newspaper", "article, kb"],
  // service, risk and compliance
  ["life-buoy", "ticket, case, support, helpdesk, service level agreement, sla"],
  ["siren", "incident, alarm, alert, escalation, emergency"],
  ["triangle-alert", "risk, problem, hazard, nonconformance, hold, exception, failure"],
  ["shield-check", "control, policy, audit, compliance, capa, quality"],
  ["check-check", "acknowledgement"],
  ["search-check", "finding, test, verification, review"],
  ["clipboard-check", "inspection, quality inspection, acceptance procedure, check, quiz attempt, attempt"],
  ["scan-search", "inspection plan"],
  ["play", "run"],
  ["file-signature", "contract, agreement, sign, signature, consent"],
  ["scroll", "obligation, clause, term, business term"],
  ["stamp", "permit, license, certificate, approval"],
  ["badge-check", "approval rule, designation"],
  ["wrench", "maintenance, service, skill"],
  ["hard-hat", "construction, site diary"],
  // sales and marketing
  ["target", "opportunity, deal"],
  ["funnel", "pipeline"],
  ["milestone", "stage"],
  ["circle-x", "lost reason"],
  ["handshake", "buying role, subcontract, subcontracting, subcontracting order"],
  ["megaphone", "campaign, newsletter, announcement, marketing, social"],
  ["mail", "email, mail"],
  ["at-sign", "email account, social account"],
  ["inbox", "mailbox, hosted mailbox"],
  ["mails", "shared mailbox"],
  ["rss", "calendar feed, feed"],
  ["message-square", "chat, message, comment, communication, reply, sms"],
  ["share-2", "share, link, social post"],
  ["send", "rollout, publication"],
  ["globe", "website, web, page, storefront, store, portal"],
  ["shopping-cart", "cart, shop, checkout"],
  ["sparkles", "loyalty, loyalty program, loyalty point"],
  // places and hospitality
  ["bed-double", "stay, bed"],
  ["door-open", "unit, room"],
  ["moon", "night audit"],
  ["spray-can", "housekeeping, housekeeping task"],
  ["key", "lease, tenancy, key"],
  ["utensils", "table, dining, restaurant, food, kitchen"],
  ["chef-hat", "kitchen ticket"],
  ["notebook-text", "menu"],
  ["book-open", "course, curriculum, learning, subject, training, instructor led"],
  ["bookmark", "chapter"],
  ["presentation", "lesson"],
  ["circle-help", "quiz"],
  ["message-circle-question", "question"],
  ["file-up", "submission, assignment submission"],
  ["layout-template", "template, layout, form, inspection template"],
  // data, devices, automation
  ["gauge", "metric, kpi, measure, meter, progress, usage, scoring rule"],
  ["database", "dataset, data, source, external source"],
  ["camera", "snapshot"],
  ["cpu", "device, sensor, definition, firmware"],
  ["radio", "gateway, edge, broker"],
  ["workflow", "rule, automation, workflow, flow, envelope"],
  ["git-branch", "condition"],
  ["bell-ring", "notify rule"],
  ["rocket", "release"],
  ["layout-dashboard", "dashboard, number card, chart"],
  ["history", "log, history, entry, version, trail, production revision, drive activity, maintenance log"],
  ["settings", "settings, setup, configuration, config, preference"],
  ["folder", "folder, drive, space, workspace"],
  ["file-text", "file, document, doc, content"],
  ["image", "media, media asset"],
  ["library", "collection"],
  ["cloud", "cloud, hosting, hosted, secret"],
  ["languages", "interface word, language, translation"],
  ["plug", "connector, integration, lti"],
  ["file-spreadsheet", "report, sheet, spreadsheet"],
  ["file-output", "export"],
  ["scale", "uom, weight, unit of measure"],
  ["flask-conical", "lab, sample, example"],
  ["store", "pos opening entry, pos, franchisee"],
  ["star", "star, item review, favourite"],
  ["circle-alert", "issue"],
];

const stem = (w: string) => (w.length > 3 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length < 4 || /(ss|us|is)$/.test(w) || !w.endsWith("s") ? w : w.slice(0, -1));

/** Concept (stemmed words joined by a space) to icon; the first listing of a concept wins. */
const book = (list: [string, string][]): ReadonlyMap<string, string> => {
  const m = new Map<string, string>();
  for (const [icon, words] of list) for (const c of words.split(",")) m.set(c.trim().split(" ").map(stem).join(" "), m.get(c.trim().split(" ").map(stem).join(" ")) ?? icon);
  return m;
};
export const DICTIONARY: ReadonlyMap<string, string> = book(CONCEPTS);

/**
 * What a report is about, where the entity dictionary above has no word or the wrong one for it: the kind of report (an ageing, a
 * ledger, a reconciliation, a forecast, a matrix), the statements (balance sheet, trial balance, profit and loss, cash flow) and the
 * subjects only reports have (receivables, payables, sales, finance). These win over the dictionary when the run of words is as long
 * (so "stock ageing" is an hourglass and "stock balance" a stack of boxes); the dictionary's longer runs ("pick list", "work order",
 * "landed cost") still win over them. Add a word here for a report, never an icon in an app.
 */
export const REPORT_CONCEPTS: [string, string][] = [
  ["hourglass", "ageing, aging, overdue, outstanding, due, due date"],
  ["book-open", "ledger"],
  ["diff", "reconciliation"],
  ["chart-line", "forecast, trend, projection"],
  ["table-2", "matrix, pivot, crosstab"],
  ["trending-down", "depreciation, amortisation, amortization"],
  ["trending-up", "profit, loss, profit and loss, margin, gross profit, earning"],
  ["scale", "balance sheet, trial balance"],
  ["banknote", "cash flow, cash position, liquidity"],
  ["banknote-arrow-down", "receivable, collection"],
  ["banknote-arrow-up", "payable"],
  ["file-spreadsheet", "statement of account"],
  ["list", "register"],
  ["layers", "consolidated trial balance, consolidated"],
  ["calendar-clock", "deferred, deferral, accrual, accrued, prepaid"],
  ["calendar-sync", "subscription, recurring revenue, mrr"],
  ["landmark", "finance, financial, treasury"],
  ["shopping-cart", "sale, sales, selling"],
  ["shopping-bag", "procurement, buying"],
  ["gauge", "capacity, utilisation, utilization, efficiency, productivity, performance"],
  ["percent", "withholding, tds, tcs"],
  ["check-check", "completion, completed"],
  ["award", "ranking, rank, leaderboard"],
];
/** The words that say only that something is a report: kept for last, so the thing reported on decides first. */
const REPORT_KINDS: [string, string][] = [
  ["chart-pie", "summary, analysis, analytic, overview, breakdown, status, tracker, scorecard, comparison, snapshot"],
  ["list", "list, listing, detail, schedule"],
];
const REPORT_BOOK = book(REPORT_CONCEPTS);
const KIND_BOOK = book(REPORT_KINDS);
const LONGEST = Math.max(...[...DICTIONARY.keys(), ...REPORT_BOOK.keys()].map((k) => k.split(" ").length));

/** Icons a row may declare besides the dictionary's: Home, the kinds, and the app tiles' own set. */
const EXTRA = [
  "house", "chart-column", "app-window", "list", "external-link", "layout-grid", "calendar", "circle-help", "hard-drive", "headset", "presentation", "server", "sheet", "signature", "store", "video", "inbox", "search",
  "bell", "shield", "puzzle", "play", "bookmark", "panel-top", "sliders-horizontal", "square-pen",
];
/** Every name the drawing (NavIcon.tsx) has: what a declared name must be to be used. */
export const NAV_ICON_NAMES: ReadonlySet<string> = new Set([...DICTIONARY.values(), ...REPORT_BOOK.values(), ...KIND_BOOK.values(), ...EXTRA]);

/** Names the shell's older icon registry used on rows, as lucide names. `file` and `chart` were kind markers, not choices. */
const LEGACY: Record<string, string> = { chart: "chart-column", dashboard: "layout-dashboard", space: "panel-top", doc: "file-text", apps: "layout-grid", check: "square-check", chat: "message-square", home: "house", external: "external-link", board: "folder-kanban", "bar-chart-3": "chart-column" };

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

/** A qualifier names a kind of the thing before it ("Customer Group", "Leave Type"): it only decides when no other word has a concept. */
const QUALIFIERS = new Set(["type", "category", "group", "class", "kind", "attribute"]);

/** The longest run of whole words `map` knows, the last such run when equal (the head noun is last): its length, place and icon. */
function longest(w: string[], map: ReadonlyMap<string, string>, skipQualifiers = false) {
  let best: { n: number; at: number; icon: string } | null = null;
  for (let at = 0; at < w.length; at++)
    for (let n = Math.min(LONGEST, w.length - at); n >= 1; n--) {
      if (skipQualifiers && n === 1 && QUALIFIERS.has(w[at]!)) continue;
      const icon = map.get(w.slice(at, at + n).join(" "));
      if (icon && (!best || n > best.n || (n === best.n && at > best.at))) best = { n, at, icon };
    }
  return best;
}

/** The concept's icon: the longest run of whole words the dictionary knows, the last such run when equal (the head noun is last). */
export function conceptIcon(entity: string): string | null {
  const w = nameWords(entity);
  return longest(w, DICTIONARY, true)?.icon ?? (w.some((x) => QUALIFIERS.has(x)) ? "tags" : null);
}

/**
 * A report's icon from its stable name ("stock_ageing", "ReceivablesByDueDate"): what it is about, so that a menu of forty reports is
 * not forty bar charts. The report words (REPORT_CONCEPTS) and the entity dictionary compete by the length of the run of words they
 * know, the report words winning a tie; then the words that only say "a report" (summary, register); the bar chart is the last resort.
 */
export function reportIcon(name: string): string {
  const w = nameWords(name);
  const mine = longest(w, REPORT_BOOK);
  const theirs = longest(w, DICTIONARY, true);
  if (mine && (!theirs || mine.n >= theirs.n)) return mine.icon;
  return theirs?.icon ?? longest(w, KIND_BOOK)?.icon ?? "chart-column";
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
  if (asKind === "report") {
    const report = entity ?? (to?.startsWith("/r/") ? decodeURIComponent(to.slice(3).split(/[/?#]/)[0] ?? "") : null);
    return report ? reportIcon(report) : "chart-column";
  }
  if (asKind === "home") return "house";
  if (asKind === "page") return "app-window";
  if (asKind === "settings") return "settings";
  return submittable || asKind === "document" ? "file-text" : "list";
}
