#ifndef GUARD_WASM_RULES_H
#define GUARD_WASM_RULES_H

#if WASM

#include "siirtc.h"

// House rules for the web build, written by web/app.js from the admin page
// (worker/index.js). The page writes fields by byte offset, so keep this
// layout in sync with writeGameRules() in web/app.js.
struct WasmRules
{
    /*0x00*/ u32 version;          // bumped by the page each time it writes
    /*0x04*/ u16 expPercent;       // EXP from battles, 100 = normal
    /*0x06*/ u16 moneyPercent;     // prize money from trainers, 100 = normal
    /*0x08*/ u16 encounterPercent; // wild encounter rate, 100 = normal
    /*0x0A*/ u8 dayNight;          // 1 = report the time of day for the overworld tint
    /*0x0B*/ u8 padding;
    /*0x0C*/ u32 hostSeconds;      // local time as seconds since 2000-01-01 00:00; 0 = no clock
    /*0x10*/ u16 catchPercent;     // Poke Ball catch odds, 100 = normal, 10000 = always catch
    /*0x12*/ u16 padding2;
};

extern struct WasmRules gWasmRules;

// Per-map wild encounter overrides from the admin page: on a listed map,
// grass and surfing encounters pick evenly from `species` (levels stay as
// the map's own). Written by writeEncounterOverrides() in web/app.js;
// an entry with count 0 is unused.
#define WASM_ENCOUNTER_OVERRIDE_MAPS 64
#define WASM_ENCOUNTER_OVERRIDE_SPECIES 32

struct WasmEncounterOverride
{
    /*0x00*/ u8 mapGroup;
    /*0x01*/ u8 mapNum;
    /*0x02*/ u8 count;
    /*0x03*/ u8 padding;
    /*0x04*/ u16 species[WASM_ENCOUNTER_OVERRIDE_SPECIES];
}; // 0x44 bytes

extern struct WasmEncounterOverride gWasmEncounterOverrides[WASM_ENCOUNTER_OVERRIDE_MAPS];

u32 WasmApplyExpRule(u32 exp);
u32 WasmApplyMoneyRule(u32 money);
u32 WasmApplyCatchRule(u32 odds);
u32 WasmApplyEncounterRule(u32 encounterRate);
u16 WasmOverrideWildSpecies(u16 species);
bool8 WasmRtcAvailable(void);
void WasmRtcFill(struct SiiRtcInfo *rtc);
u8 WasmDayNightPhase(void);

#endif // WASM

#endif // GUARD_WASM_RULES_H
