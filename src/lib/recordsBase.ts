import { useParams } from "react-router";

/** Where the records pages live: `/e`, or `/m/<menu>/e` on the portal's page for a menu (links stay under it). */
export function useRecordsBase(): string {
  const { menu } = useParams();
  return menu ? `/m/${encodeURIComponent(menu)}/e` : "/e";
}
