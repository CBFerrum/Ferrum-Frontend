// The kit's pieces for pages people outside the workspace see (gapclose/design/S4-public-side.md §2.4, §2.6, §2.17; Ferrum
// docs/builder/decisions.md BD-79): PublicFrame wears the workspace's brand around a public page, LanguageSwitch offers the
// page's other languages, EmbedSnippet gives the code that puts a public page on another site. The brand's colours and
// typeface come in its stylesheet, which the server links after the theme; nothing here sets a colour.

import { useId, type ReactNode } from "react";
import { bootstrap, type PublicBrand } from "@ferrum/client";
import { t } from "../lib/i18n";
import { accentTokens, ACCENT_TEXT, DARK_SURFACES, LIGHT_SURFACES } from "../lib/theme";
import { Button, toast } from "./kit";

/** A link a public page may carry: https, mailto, or a path of its own host (never `//elsewhere`); no whitespace or control
 *  characters. The server checks the same when the brand is saved (`brand::safe_link`); this keeps the page safe on its own. */
export const safeLink = (url: string) => !!url && !/[\s\u0000-\u001f\u007f]/.test(url) && (url.startsWith("https://") || url.startsWith("mailto:") || (url.startsWith("/") && !url.startsWith("//")));

/** A language in its own words ("Deutsch"), the tag where the browser cannot name it. */
function autonym(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    return name ? name.charAt(0).toLocaleUpperCase(tag) + name.slice(1) : tag;
  } catch {
    return tag;
  }
}

/** The languages a public page is offered in, as a form: a labelled select and a button, sent as `?lang=` with the page's other
 *  parameters. A plain GET form, so it works by keyboard, with a screen reader and without script; nothing changes until the
 *  button is pressed. Nothing at all when fewer than two are offered. */
export function LanguageSwitch({ languages = bootstrap()?.locale.languages ?? [], current = bootstrap()?.locale.language ?? "en" }: { languages?: string[]; current?: string }) {
  const id = useId();
  if (languages.length < 2) return null;
  const kept = [...new URLSearchParams(typeof location === "undefined" ? "" : location.search)].filter(([k]) => k !== "lang");
  return (
    <form method="get" className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
      {kept.map(([k, v], i) => (
        <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
      ))}
      <label htmlFor={`${id}-lang`} className="sr-only">
        {t("Language")}
      </label>
      <select id={`${id}-lang`} name="lang" className="select" defaultValue={languages.includes(current) ? current : languages[0]}>
        {languages.map((tag) => (
          <option key={tag} value={tag} lang={tag}>
            {autonym(tag)}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm">
        {t("Change")}
      </Button>
    </form>
  );
}

/** A public page in the workspace's brand: a skip link, a header with the logo (its dark-mode version where there is one) or the
 *  name, the language switch, the page, and a footer with the brand's text and links. Without a brand, the workspace's name. */
export function PublicFrame({
  brand = bootstrap()?.brand ?? null,
  workspace = bootstrap()?.workspace.name ?? "",
  languages,
  current,
  children,
}: {
  brand?: PublicBrand | null;
  workspace?: string;
  languages?: string[];
  current?: string;
  children: ReactNode;
}) {
  const main = `${useId().replace(/:/g, "")}-main`;
  const name = brand?.name || workspace;
  const links = (brand?.links ?? []).filter((l) => l.label && safeLink(l.url));
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a className="skip-link" href={`#${main}`}>
        {t("Skip to content")}
      </a>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        {brand?.logo ? (
          <picture>
            {brand.logo_dark && brand.logo_dark !== brand.logo && <source srcSet={brand.logo_dark} media="(prefers-color-scheme: dark)" />}
            <img src={brand.logo} alt={name} className="block h-8 w-auto max-w-60 object-contain" />
          </picture>
        ) : (
          <span className="text-lg font-semibold">{name}</span>
        )}
        <LanguageSwitch languages={languages} current={current} />
      </header>
      <main id={main} tabIndex={-1} className="flex-1 px-4 py-6">
        {children}
      </main>
      {(brand?.footer_text || links.length > 0) && (
        <footer className="border-t border-border px-4 py-4 text-sm text-muted-foreground">
          {brand?.footer_text && <p className="whitespace-pre-line">{brand.footer_text}</p>}
          {links.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {links.map((l) => (
                <li key={`${l.label}-${l.url}`}>
                  <a href={l.url}>{l.label}</a>
                </li>
              ))}
            </ul>
          )}
        </footer>
      )}
    </div>
  );
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The code that shows the public page at `url` on another site (S4 §2.4): a lazy iframe the platform's `embed.js` sizes to its
 *  content, and that script, both from the page's own origin. Every value is escaped for its attribute. Empty for an address that
 *  is not https (or http on a developer's own machine). */
export function embedSnippet(url: string, title: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname.endsWith(".localhost")))) return "";
  u.searchParams.set("embed", "1");
  return (
    `<iframe src="${attr(u.href)}" title="${attr(title)}" loading="lazy" data-ferrum-embed style="width:100%;border:0;min-height:480px"></iframe>\n` +
    `<script src="${attr(`${u.origin}/_shell/v1/embed.js`)}" async></script>`
  );
}

/** An app's "put this on your site" box: the snippet for `url`, read-only, with a button that copies it. */
export function EmbedSnippet({ url, title }: { url: string; title: string }) {
  const id = useId();
  const text = embedSnippet(url, title);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("Code copied"));
    } catch {
      toast(t("Select the code and copy it yourself"), "error");
    }
  };
  if (!text) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <label htmlFor={`${id}-code`} className="field-label">
        {t("Code to paste into your site")}
      </label>
      <textarea id={`${id}-code`} className="input mono" dir="ltr" rows={4} readOnly value={text} onFocus={(e) => e.currentTarget.select()} />
      <div>
        <Button icon="copy" onClick={() => void copy()}>
          {t("Copy")}
        </Button>
      </div>
    </div>
  );
}

/** How a brand's accent will look on public pages: in light and dark, the shown colour, a button and a link on the page and on a
 *  surface. Drawn with `accentTokens`, the kernel's algorithm, so it is what the server will serve once saved. */
export function BrandPreview({ primary, primaryDark }: { primary: unknown; primaryDark: unknown }) {
  const tk = accentTokens(typeof primary === "string" ? primary : null, typeof primaryDark === "string" ? primaryDark : null);
  const modes = [
    { key: "light", title: t("Light mode"), shown: tk.light, text: ACCENT_TEXT.light, surfaces: LIGHT_SURFACES, ink: DARK_SURFACES[0] },
    { key: "dark", title: t("Dark mode"), shown: tk.dark, text: ACCENT_TEXT.dark, surfaces: DARK_SURFACES, ink: LIGHT_SURFACES[1] },
  ] as const;
  return (
    <div className="field span-all" role="group" aria-label={t("How public pages show this colour")}>
      <div className="field-label">{t("How public pages show this colour")}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {modes.map((m) => (
          <div key={m.key} data-mode={m.key} className="overflow-hidden rounded-md border border-border">
            {m.surfaces.map((surface, i) => (
              <div key={surface} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" style={{ background: surface, color: m.ink }}>
                {i === 0 && (
                  <span className="basis-full">
                    {m.title}: <span className="mono" dir="ltr">{m.shown}</span>
                  </span>
                )}
                <span className="rounded-md px-3 py-1 font-medium" style={{ background: m.shown, color: m.text }}>
                  {t("Button")}
                </span>
                <span className="underline" style={{ color: m.shown }}>
                  {t("Link")}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
