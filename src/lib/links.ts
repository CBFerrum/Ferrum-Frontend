/** Where a notification about a record opens: Drive's items in Drive (people reach them only
 *  there), everything else on its form. */
export function notificationPath(entity: string, record: string): string {
  if (entity === "DriveFolder") return `/drive/${record}`;
  if (entity === "DriveFile") return `/drive?item=${record}`;
  return `/e/${entity}/${record}`;
}
