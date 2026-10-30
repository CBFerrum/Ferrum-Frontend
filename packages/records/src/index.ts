// @ferrum/records (docs/plan/apps-ui.md §10.4): lists, forms and reports of any entity, drawn from
// its metadata, so an app spends its effort on the screens that make it a product; and what screens
// about records share: the metadata and the person's rights, the workspace's people, comments, and
// the record picker.
// The records frame ERP's interface uses: the app's own modules in the sidebar under the platform's
// bar (setFrameMode("app", its packages), then RequireAuth around the routes), and the pages of
// other apps' screens and settings inside it.
export { RequireAuth, setFrameMode } from "../../../src/app/Shell";
export { AppSettingsPage, ScreenPage } from "../../../src/app/Screen";
export { ListView } from "../../../src/app/ListView";
export { FormView } from "../../../src/app/FormView";
export { ReportView } from "../../../src/app/ReportView";
export {
  can,
  recordTitle,
  useEntityMeta,
  useMe,
  useMetaIndex,
  type Doc,
  type EntityMeta,
  type EntitySummary,
  type Me,
  type MetaIndex,
  type Perms,
} from "../../../src/lib/meta";
export { CollabPanel, Composer, mentionedIn, usePeople, type Person } from "../../../src/app/Collab";
export { LinkInput, LinkTitle, useLinkTitle } from "../../../src/app/widgets";
