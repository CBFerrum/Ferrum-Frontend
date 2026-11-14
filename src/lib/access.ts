// Who may work from where: the workspace's staff networks, how long an idle browser stays signed in, who keeps a password under
// single sign-on, and a key's own networks (docs/operations.md, "Staff networks"). The server is the judge of every value; this
// only shapes what is typed and sends what changed.

export type NetworkMode = "enforce" | "report";

export interface StaffNetworks {
  networks: string[];
  mode: NetworkMode;
}

/** The access part of `GET /api/admin/settings`. */
export interface AccessSettings {
  staff_networks: StaffNetworks | null;
  idle_minutes: number;
  /** The ids of the administrators who keep password sign-in under single sign-on; none: all of them. */
  break_glass: string[] | null;
  new_device_notice: boolean;
}

export const IDLE_MIN = 5;
export const IDLE_MAX = 10080;
export const BREAK_GLASS_MAX = 20;

/** Whether text is written as an address and a prefix length (`10.0.0.0/8`, `2001:db8::/32`). Whether the host bits fit the prefix is the server's to say. */
export function looksLikeNetwork(text: string): boolean {
  const [address, prefix, ...rest] = text.trim().split("/");
  if (rest.length || address === undefined || prefix === undefined || !/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return bits <= 32 && address.split(".").every((n) => Number(n) <= 255);
  return /^[0-9a-fA-F:.]+$/.test(address) && address.includes(":") && bits <= 128;
}

/** The networks typed, blanks dropped. */
export const cleanNetworks = (rows: string[]): string[] => rows.map((r) => r.trim()).filter(Boolean);

/** A single address as a network of its own: `203.0.113.7/32`, `2001:db8::7/128`. Nothing for what is not an address (a proxy-less server has none). */
export function ownNetwork(address: string | null | undefined): string | null {
  const a = (address ?? "").trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return `${a}/32`;
  return a.includes(":") && /^[0-9a-fA-F:.]+$/.test(a) ? `${a}/128` : null;
}

/** The value `staff_networks` is saved as: none, when no network is listed. */
export const staffNetworksValue = (networks: string[], mode: NetworkMode): StaffNetworks | null => {
  const list = cleanNetworks(networks);
  return list.length ? { networks: list, mode } : null;
};

/** What changed between the settings as read and the form, as the body of `PUT /api/admin/settings`. */
export function accessPatch(
  initial: AccessSettings,
  form: { networks: string[]; mode: NetworkMode; idle: string; breakGlass: string[] | null; notice: boolean },
): Partial<AccessSettings> {
  const patch: Partial<AccessSettings> = {};
  const nets = staffNetworksValue(form.networks, form.mode);
  if (JSON.stringify(nets) !== JSON.stringify(initial.staff_networks ?? null)) patch.staff_networks = nets;
  const idle = form.idle.trim() === "" ? 0 : Number(form.idle);
  if (idle !== initial.idle_minutes) patch.idle_minutes = idle;
  if (JSON.stringify(form.breakGlass) !== JSON.stringify(initial.break_glass ?? null)) patch.break_glass = form.breakGlass;
  if (form.notice !== initial.new_device_notice) patch.new_device_notice = form.notice;
  return patch;
}
