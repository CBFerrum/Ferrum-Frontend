import { t } from "@ferrum/client";
// Studio's sidebar entries, apart from its pages: the frame of every interface shows them, and
// importing a page module for them would put that page in every interface's first script.

export const reportNav: { label: string; to: string; icon: string }[] = [{ get label() { return t("Reports"); }, to: "/studio/reports", icon: "chart" }];
export const dashboardNav: { label: string; to: string; icon: string }[] = [{ get label() { return t("Dashboards"); }, to: "/studio/dashboards", icon: "dashboard" }];
// The spaces list's address, as `space/model.ts`'s PATHS.spaces.
export const spaceNav: { label: string; to: string; icon: string }[] = [{ get label() { return t("Spaces"); }, to: "/studio/spaces", icon: "space" }];
