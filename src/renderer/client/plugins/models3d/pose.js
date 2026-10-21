// Facing and action-state handling shared by every model.
import { ActionState } from "@highlite/core";

// Direction enum order in the client: N, E, S, W, NE, SE, SW, NW.
// North is +Z and east is +X; Babylon's yaw turns +Z toward +X.
export const DIRECTION_YAW = [
  0,
  Math.PI / 2,
  Math.PI,
  -Math.PI / 2,
  Math.PI / 4,
  (3 * Math.PI) / 4,
  (-3 * Math.PI) / 4,
  -Math.PI / 4
];

export const TURN_RATE = 0.012;
export const WALK_CYCLE_SPEED = 0.011;

// The sprite's action animation (one swing per skilling tick or attack) lasts
// four 100ms frames; our swing follows the same timing.
export const STRIKE_DURATION_MS = 450;

// Pose families; each game action state maps onto one of these.
export const Activity = { Idle: 0, Chop: 1, Melee: 2, Ranged: 3, Magic: 4, Fish: 5, Work: 6, Dead: 7 };
export const ACTIVITY_BY_STATE = new Map([
  [ActionState.WoodcuttingState, Activity.Chop],
  [ActionState.MiningState, Activity.Chop],
  [ActionState.MineThroughRocksState, Activity.Chop],
  [ActionState.SmithingState, Activity.Chop],
  [ActionState.DiggingState, Activity.Chop],
  [ActionState.MeleeCombatState, Activity.Melee],
  [ActionState.RangeCombatState, Activity.Ranged],
  [ActionState.MagicCombatState, Activity.Magic],
  [ActionState.EnchantingState, Activity.Magic],
  [ActionState.FishingState, Activity.Fish],
  [ActionState.CookingState, Activity.Work],
  [ActionState.HarvestingState, Activity.Work],
  [ActionState.TreeShakingState, Activity.Work],
  [ActionState.SmeltingState, Activity.Work],
  [ActionState.SmeltingKilnState, Activity.Work],
  [ActionState.CraftingState, Activity.Work],
  [ActionState.PotionMakingState, Activity.Work],
  [ActionState.UsingSpinningWheelState, Activity.Work],
  [ActionState.CreatingNonSkillItemsState, Activity.Work],
  [ActionState.PickpocketingState, Activity.Work],
  [ActionState.PicklockingState, Activity.Work],
  [ActionState.UsingItemOnEntityState, Activity.Work],
  [ActionState.PlayerDeadState, Activity.Dead],
  [ActionState.NPCDeadState, Activity.Dead]
]);

// The game only fires an action every few seconds while skilling. OSRS loops
// these animations continuously, so these activities also swing on their own
// rhythm, restarting whenever the game fires a real action.
export const LOOP_INTERVAL_MS = new Map([
  [Activity.Chop, 1200],
  [Activity.Work, 1500]
]);

// Swing shape over strike progress 0-1: hold, strike fast, hold, then recover.
// Returns 0 (wound up) to 1 (impact); 0 when not striking.
export function strikeCurve(progress) {
  if (progress === null) return 0;
  if (progress < 0.2) return 0;
  if (progress < 0.45) return (progress - 0.2) / 0.25;
  if (progress < 0.75) return 1;
  return 1 - (progress - 0.75) / 0.25;
}

// Moves value toward target at a rate (per ms) proportional to the distance.
export function approach(value, target, deltaMs, rate) {
  return value + (target - value) * Math.min(1, deltaMs * rate);
}
