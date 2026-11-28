export function exactGrantMessage(input: {
  origin: string;
  owner: string;
  pairing: string;
  id: string;
  twin: string;
  revision: number;
  lesson: string;
  question: string;
  answer: string;
  rooms: string[];
  expires: number;
}): string;
export function exactPostMessage(input: {
  origin: string;
  owner: string;
  pairing: string;
  id: string;
  source: number;
  room: string;
  nonce: string;
  expires: number;
}): string;
