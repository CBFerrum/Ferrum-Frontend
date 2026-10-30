// @ferrum/records/frame: the records frame ERP's interface uses, for an app's own interface built in
// its repository: the app's own modules in the sidebar under the platform's bar (setFrameMode("app",
// its packages), then RequireAuth around the routes), and the pages of other apps' screens and
// settings inside it. An entry of its own: the frame runs in a browser, so tests of screens that
// only use records (lists, people, rights) never load it.
export { RequireAuth, setFrameMode } from "../../../../src/app/Shell";
export { AppSettingsPage, ScreenPage } from "../../../../src/app/Screen";
