/** The Today page's row filters, including failed tool calls. */
export const WORK_KINDS = "kind IN ('activity', 'digest', 'options')";
export const CARD_KINDS = "kind IN ('secret', 'signin', 'connector')";
export const FAILED_CALL = "kind = 'activity' AND instr(json, '\"ok\":false') > 0";
/** SQLite uses the partial ordering index when the query repeats these expressions. */
export const ORDERING_ROW = "((role = 'user' AND json_extract(json, '$.peerAsk') IS NULL) OR (role = 'bot' AND kind = 'text' AND (json_extract(json, '$.turnTerminal') = 1 OR json_extract(json, '$.turnId') IS NULL)))";
export const ORDERING_AT = "COALESCE(json_extract(json, '$.turnCompletedAt'), at)";
