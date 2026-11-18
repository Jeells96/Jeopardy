// Which build of the site this is. The deploy (tools/stamp-version.sh) replaces "dev" with
// the commit it was built from, so screens that were already open can tell there's newer
// code and reload themselves (see checkForUpdate in app.js).
export const VERSION = "dev";
