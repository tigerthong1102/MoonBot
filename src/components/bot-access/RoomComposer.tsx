import type { ComponentProps } from "react";

import { roomThreadWorking } from "@/lib/room-threads";
import { useStoreSelector } from "@/state/store-select";
import { WorkflowWaits } from "../skill-burger/WorkflowWaits";
import { Composer } from "../Composer";
import { NewConversationInstead } from "../NewConversationInstead";

/** A room's composer, or, when this person can only view one of its bots, a line saying so: writing there makes every
 * bot in it answer. */
export function RoomComposer(props: ComponentProps<typeof Composer>) {
  const workflowAvailable = useStoreSelector(state => !state.config?.cloudHome || Boolean(state.config.team));
  const viewOnly = props.members?.find((bot) => bot.yourAccess === "view");
  if (viewOnly) return <NewConversationInstead bot={viewOnly} room onNew={() => {}} />;
  const { group, members } = props;
  const editors = members?.filter(member => !member.yourAccess || member.yourAccess === "edit") ?? [];
  return <>
    {workflowAvailable && group && editors.length > 0 && !props.locked &&
      <WorkflowWaits key={group.threadId} room={{ id: group.id, members: editors }} threadId={group.threadId} busy={roomThreadWorking(group, group.threadId)} />}
    <Composer {...props} />
  </>;
}
