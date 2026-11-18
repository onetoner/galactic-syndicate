// Zentrale Balancing-Konstanten.

export const TICKS_PER_SECOND = 4;
export const SAVE_VERSION = 2;
export const MAX_CATCHUP_TICKS = 60;
export const MAX_LOG_ENTRIES = 100;

export const START_CREDITS = 250;

// Anbau
export const WATER_TICKS = 220; // Ticks, bis ein voll gegossener Topf trocken ist
export const LAMP_GROWTH_BONUS = 1.35;
export const CARE_START = 0.5;
export const CARE_WATERED_PER_GROWTH = 0.14;
export const CARE_LAMP_PER_GROWTH = 0.16;
export const CARE_DRY_PER_TICK = 0.0015;
export const CARE_FERTILIZER = 0.2;
export const QUALITY_THRESHOLD_2 = 0.6;
export const QUALITY_THRESHOLD_3 = 0.85;
export const HARVESTER_INTERVAL_TICKS = 6;
export const MACHINE_BUFFER_CAP = 40;
export const INDUSTRIAL_SPEED = 1.25;
export const DEMOLISH_REFUND = 0.5;

// Straßenmarkt
export const STREET_SAT_PER_UNIT = 0.01;
export const STREET_SAT_MAX = 0.75;
export const STREET_SAT_RECOVERY_PER_TICK = 0.0012;
export const STREET_HEAT_PER_CREDIT = 1 / 450;
export const HUSTLE_REWARD = 25;
export const HUSTLE_COOLDOWN_TICKS = 60;
export const AUTO_BUY_INTERVAL_TICKS = 20;

// Heat / Razzien
export const HEAT_DECAY_PER_TICK = 0.008;
export const RAID_CHECK_INTERVAL_TICKS = 400;
export const RAID_HEAT_THRESHOLD = 60;
export const RAID_INVENTORY_SHARE = 0.3;

// Raumfahrt
export const BASE_SHIP_SPEED = 0.05; // Distanzeinheiten pro Tick bei Tempo 1
export const BERTHS_PER_SPACEPORT = 3;
export const SCRAP_REFUND = 0.4;
export const ENCOUNTER_TIMEOUT_TICKS = 240;
export const SPACE_HEAT_PER_CREDIT = 1 / 4000;
export const SYSTEM_BUY_MARKUP = 1.15;

// Galaxie
export const CHUNK_SIZE = 16;
export const SCAN_RANGE = 24;

// Markt / Syndikate
export const SAT_MIN = -0.3;
export const SAT_MAX = 0.85;
export const SAT_RECOVERY_PER_TICK = 0.0004;
export const SHARE_GAIN_FACTOR = 0.25;
export const SHARE_GAIN_MAX_PER_SALE = 0.05;
/** KI-Syndikate behalten immer einen Rest-Marktanteil (sonst gäbe es niemanden, der Gebühren zahlt) */
export const MAX_PLAYER_SHARE = 0.8;
export const SHARE_DRIFT_PER_TICK = 0.00005;
export const SYSTEM_UPDATE_INTERVAL_TICKS = 20;
export const INCOME_INTERVAL_TICKS = 40;
export const INCOME_FACTOR = 0.3;
export const DEFAULT_PLAYER_TAX = 0.2;
export const PROTECTION_DURATION_TICKS = 2400;
export const PROTECTION_COST_FACTOR = 0.08;
export const SABOTAGE_COOLDOWN_TICKS = 480;
export const PRESSURE_SCALE = 0.5;
