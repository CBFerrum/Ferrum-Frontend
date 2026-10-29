// A Space, a module or team home page: its blocks resolved for the viewer by the server (what they
// cannot read is left out), refreshed live as the records they show change.

import { Copy, Globe, LayoutGrid, Lock, Pencil, RefreshCw, Users } from "lucide-react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage } from "@/lib/api";
import { can, useMetaIndex } from "@/lib/meta";
import { useStudioList, type Sharing } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { SpaceBlocks, SpaceSkeleton } from "./space/BlockView";
import { useSpace } from "./space/hooks";
import { SpaceIcon } from "./space/icons";
import { PATHS } from "./space/model";

const TAP = "pointer-coarse:min-h-11 pointer-coarse:min-w-11";

export function AudienceBadge({ sharing, mine }: { sharing: Sharing; mine?: boolean }) {
  const [Icon, label] = sharing === "everyone" ? [Globe, "Everyone"] : sharing === "roles" ? [Users, "Shared with roles"] : [Lock, mine === false ? "Private" : "Only you"];
  return (
    <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

export function SpaceView() {
  const { id = "" } = useParams();
  const q = useSpace(id);
  const meta = useMetaIndex().data;
  const row = useStudioList("spaces").data?.find((r) => r.id === id);
  const perms = meta?.entities.find((e) => e.name === "Space")?.permissions;

  if (q.isLoading)
    return (
      <div className="mx-auto grid w-full max-w-screen-2xl gap-5" aria-busy="true" aria-label="Loading the space">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-xl" />
          <Skeleton className="h-7 w-56" />
        </div>
        <SpaceSkeleton />
      </div>
    );
  if (!q.data) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutGrid />
          </EmptyMedia>
          <EmptyTitle>{missing ? "This space doesn’t exist" : "The space could not be loaded"}</EmptyTitle>
          <EmptyDescription>{missing ? "It may have been deleted, or it isn’t shared with you." : errorMessage(q.error)}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          {!missing && (
            <Button variant="outline" onClick={() => void q.refetch()}>
              Try again
            </Button>
          )}
          <Button variant="ghost" asChild>
            <Link to={PATHS.spaces}>All spaces</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const s = q.data.space;
  const module = meta?.modules.find((m) => m.name === s.module);
  const canEdit = !s.is_standard && (perms?.write === "all" || (perms?.write === "own" && !!row?.mine));
  const canCopy = can(perms, "create");
  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      <header className="mb-5 flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <SpaceIcon name={s.icon} className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <h1 className="text-xl font-semibold tracking-tight break-words">{s.label}</h1>
          {s.description && <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{s.description}</p>}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {module && <Badge variant="outline">{module.label}</Badge>}
            {s.sharing && <AudienceBadge sharing={s.sharing} mine={row?.mine} />}
            {s.is_standard && <Badge variant="secondary">Standard</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="icon" className={TAP} aria-label="Refresh" title="Refresh" disabled={q.isFetching} onClick={() => void q.refetch()}>
            <RefreshCw className={cn(q.isFetching && "animate-spin motion-reduce:animate-none")} />
          </Button>
          {canEdit ? (
            <Button asChild className={TAP}>
              <Link to={PATHS.editSpace(id)}>
                <Pencil /> Edit
              </Link>
            </Button>
          ) : (
            s.is_standard &&
            canCopy && (
              <Button asChild variant="outline" className={TAP}>
                <Link to={PATHS.copySpace(id)}>
                  <Copy /> Customize a copy
                </Link>
              </Button>
            )
          )}
        </div>
      </header>
      {q.error ? (
        <Alert className="mb-4">
          <AlertTitle>Showing what was loaded before</AlertTitle>
          <AlertDescription>The latest version could not be loaded: {errorMessage(q.error)}</AlertDescription>
        </Alert>
      ) : null}
      {q.data.blocks.length ? (
        <SpaceBlocks blocks={q.data.blocks} />
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutGrid />
            </EmptyMedia>
            <EmptyTitle>Nothing here yet</EmptyTitle>
            <EmptyDescription>{canEdit ? "Add shortcuts, charts, number cards, recent records and checklists." : "This space has nothing you can see yet."}</EmptyDescription>
          </EmptyHeader>
          {canEdit && (
            <EmptyContent>
              <Button asChild>
                <Link to={PATHS.editSpace(id)}>
                  <Pencil /> Add blocks
                </Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}
    </div>
  );
}

/** A space's blocks alone, for a module's home page (see `useModuleSpace`); nothing while it has none. */
export function SpaceContent({ id }: { id: string }) {
  const q = useSpace(id);
  if (q.isLoading) return <SpaceSkeleton />;
  if (!q.data)
    return (
      <Alert>
        <AlertTitle>This module’s space could not be loaded</AlertTitle>
        <AlertDescription>
          {errorMessage(q.error)}{" "}
          <Button variant="link" className="h-auto p-0" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  return q.data.blocks.length ? <SpaceBlocks blocks={q.data.blocks} /> : null;
}
