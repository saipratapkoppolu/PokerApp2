/**
 * Fixed Splitwise mapping for "Add to Splitwise" (see src/utils/splitwise.ts).
 * IDs are not secret — safe to commit. No Splitwise secrets here (they live in the worker).
 *
 * Find the IDs on secure.splitwise.com: a group's ID is the number in its address
 * (#/groups/12345678); a friend's user ID is the number in #/friends/11111111.
 */

/**
 * Splitwise group the expense goes to. When set, ONLY this group is used (no picker) and
 * "Open Splitwise" opens it. 0 = pick any of the connected user's groups in the app.
 */
export const SPLITWISE_GROUP_ID = 66133405;

/**
 * Poker player name (as typed in the app, any case) → Splitwise user ID.
 * Players not listed are matched by name, or picked in the app.
 */
export const SPLITWISE_PLAYER_IDS: Record<string, number> = {};

/**
 * "Add to Splitwise" shows only when the room admin is one of these users (app display name, any case).
 * Empty = nobody. Everyone still sees the table and Copy / Share.
 */
export const SPLITWISE_ADDERS: string[] = ['Adi', 'Bharath', 'Naresh', 'Sai', 'BhuvR', 'Ram', 'Reddy'];
