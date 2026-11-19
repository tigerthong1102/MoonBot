export interface TurnStartLog {
  botId: string;
  images: number;
  depth: number;
  card: boolean;
  spoken: boolean;
}

export function turnStartLogLine(turn: TurnStartLog): string {
  const input = turn.spoken ? "spoken" : "typed";
  return `[omb-turn] bot=${turn.botId} input=${input} images=${turn.images} depth=${turn.depth} card=${turn.card}`;
}
