// @ferrum/records/frame: the records frame ERP's interface uses, for an app's own interface built in
// its repository: the app's own modules in the sidebar under the platform's bar (setFrameMode("app",
// its packages), then RequireAuth around the routes), and the pages of other apps' screens and
// settings inside it. An entry of its own: the frame runs in a browser, so tests of screens that
// only use records (lists, people, rights) never load it.
export { RequireAuth, setFrameMode } from "../../../../src/app/Shell";
export { AppSettingsPage, ScreenPage } from "../../../../src/app/Screen";
// The whole records frame, as ERP's interface draws it (its repository, ferrum-app-erp): every
// route (lists, forms, reports, Customize, other apps' screens and settings; Studio's and the till's
// links lead to their interfaces), and the home of an app's modules. A frame with these routes says
// so: setFrameMode("app", packages, { pages: true }).
export { recordsRoutes } from "../../../../src/app/recordsRoutes";
export { Home as ModulesHome } from "../../../../src/app/Home";
