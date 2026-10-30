// Video meetings (Comms' /meet endpoints; Ferrum docs/plan/collaboration.md, C4) on the LiveKit
// server the operator runs. Comms decides who may join and signs their token; LiveKit's own
// components show the call. /meet starts a room; /meet/{kind}/{id} is a meeting's page: a chat
// channel's call, a calendar event's meeting or a room.

import "@livekit/components-styles";
import "./meet.css";
import { LiveKitRoom, PreJoin, VideoConference, useConnectionState, useRoomContext, type LocalUserChoices } from "@livekit/components-react";
import { useQuery } from "@tanstack/react-query";
import { ConnectionState, DisconnectReason, type RoomOptions } from "livekit-client";
import { Copy, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { CHAT } from "@/lib/chat";
import { MEET, meetLink, useMeetAvailable, type MeetKind, type MeetPass } from "@/lib/meet";
import { useMe } from "@/lib/meta";
import { EmptyState, ErrorState, toast } from "@/ui/kit";
import { goBack } from "../studio/dashboard/ui";

const KINDS: MeetKind[] = ["channel", "event", "room"];

/** Where leaving a meeting goes when the page was opened directly. */
const home = (kind: MeetKind, id: string) => (kind === "channel" ? `/chat/${id}` : kind === "event" ? "/calendar" : "/meet");

export function MeetPage() {
  const { kind = "", id = "" } = useParams();
  const navigate = useNavigate();
  const me = useMe().data;
  const valid = (KINDS as string[]).includes(kind);
  const pass = useQuery({
    queryKey: ["meet", kind, id],
    queryFn: () => api.post<MeetPass>(`${MEET}/${kind}/${id}/token`),
    enabled: valid,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const [choices, setChoices] = useState<LocalUserChoices | null>(null);
  const [left, setLeft] = useState<DisconnectReason | undefined | null>(null);
  const options = useMemo<RoomOptions>(
    () => ({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { deviceId: choices?.videoDeviceId || undefined },
      audioCaptureDefaults: { deviceId: choices?.audioDeviceId || undefined },
    }),
    [choices],
  );

  if (!valid) return <EmptyState title="Meeting not found" />;
  if (pass.error) return <ErrorState title="You can't join this meeting" error={pass.error} onRetry={() => void pass.refetch()} />;
  const meetKind = kind as MeetKind;
  const leave = () => goBack(navigate, home(meetKind, id));
  const copy = async () => {
    const link = meetLink(meetKind, id);
    try {
      await navigator.clipboard.writeText(link);
      toast("Meeting link copied");
    } catch {
      toast(`Copy this link: ${link}`);
    }
  };

  return (
    <div data-fullbleed className="grid h-[calc(100dvh-var(--topbar-h))] min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Video className="size-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="min-w-0 flex-1 truncate font-semibold">{pass.data?.title ?? "Meeting"}</h1>
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          <Copy /> Copy link
        </Button>
      </header>
      <div data-lk-theme="default" className="ferrum-meet min-h-0">
        {!pass.data ? (
          <Skeleton className="m-6 h-64" />
        ) : left !== null ? (
          <div className="grid h-full place-content-center justify-items-center gap-4 p-6 text-center">
            <p className="text-lg">{left === DisconnectReason.CLIENT_INITIATED ? "You left the meeting." : "You were disconnected from the meeting."}</p>
            <div className="flex gap-2">
              <Button onClick={() => void pass.refetch().then(() => setLeft(null))}>Rejoin</Button>
              <Button variant="outline" onClick={leave}>
                Back
              </Button>
            </div>
          </div>
        ) : !choices ? (
          <div className="grid h-full place-items-center overflow-auto p-4">
            <PreJoin
              defaults={{ username: me?.user.full_name || me?.user.email || "", videoEnabled: true, audioEnabled: true }}
              // The name others see comes from the token, so the field is hidden and never checked.
              onValidate={() => true}
              onSubmit={setChoices}
              onError={(e) => toast(e.message, "error")}
              joinLabel="Join now"
            />
          </div>
        ) : (
          <LiveKitRoom
            serverUrl={pass.data.url}
            token={pass.data.token}
            connect
            options={options}
            video={choices.videoEnabled}
            audio={choices.audioEnabled}
            onDisconnected={(reason) => setLeft(reason)}
            onError={(e) => toast(e.message, "error")}
            onMediaDeviceFailure={() => toast("Your camera or microphone could not be used. Check the browser's permission for this site.", "error")}
            className="h-full"
          >
            <VideoConference />
            {meetKind === "channel" && <Announce channel={id} />}
          </LiveKitRoom>
        )}
      </div>
    </div>
  );
}

/** Tells a channel that a call started, when its first person joins. */
function Announce({ channel }: { channel: string }) {
  const room = useRoomContext();
  const state = useConnectionState();
  const done = useRef(false);
  useEffect(() => {
    if (state !== ConnectionState.Connected || done.current) return;
    done.current = true;
    if (room.remoteParticipants.size > 0) return;
    // Someone reading a public channel they have not joined cannot post: the call goes on.
    api.post(`${CHAT}/channels/${channel}/messages`, { body: `📞 Started a call. [Join the call](/app/meet/channel/${channel})` }).catch(() => undefined);
  }, [state, room, channel]);
  return null;
}

/** /meet: a room to meet in now, whose link admits anyone in the workspace. */
export function MeetHomePage() {
  const navigate = useNavigate();
  const available = useMeetAvailable();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const room = await api.post<{ id: string }>(`${MEET}/rooms`, { title: title.trim() || undefined });
      void navigate(`/meet/room/${room.id}`);
    } catch (err) {
      toast(errorMessage(err), "error");
      setBusy(false);
    }
  };
  if (available.isLoading) return <Skeleton className="mx-auto mt-10 h-48 max-w-md" />;
  if (!available.data)
    return (
      <EmptyState title="Video meetings are not set up" icon="video">
        An administrator of this server can set them up: see “Meetings” in Ferrum's operations guide.
      </EmptyState>
    );
  return (
    <div className="mx-auto grid max-w-md gap-4 py-10">
      <h1 className="text-xl font-semibold">Meet</h1>
      <p className="text-muted-foreground">
        Start a meeting now and share its link with people in your workspace. Chat channels have their own calls, and calendar events their own meetings.
      </p>
      <form onSubmit={(e) => void start(e)} className="grid gap-2">
        <Label htmlFor="meet-title">Name (optional)</Label>
        <Input id="meet-title" maxLength={140} placeholder="Meeting" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Button type="submit" disabled={busy}>
          <Video /> Start a meeting
        </Button>
      </form>
    </div>
  );
}
