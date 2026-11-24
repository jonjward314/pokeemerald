#if WASM

// House rules for the web build: EXP, prize money and encounter rate
// multipliers, plus a real-time clock fed by the browser. See
// include/wasm_rules.h for the layout the page writes.

#include "global.h"
#include "main.h"
#include "overworld.h"
#include "random.h"
#include "rtc.h"
#include "wasm_rules.h"

struct WasmRules gWasmRules = {
    .version = 0,
    .expPercent = 100,
    .moneyPercent = 100,
    .encounterPercent = 100,
    .dayNight = 0,
    .hostSeconds = 0,
    .catchPercent = 100,
};

struct WasmEncounterOverride gWasmEncounterOverrides[WASM_ENCOUNTER_OVERRIDE_MAPS];

u16 WasmOverrideWildSpecies(u16 species)
{
    s32 i;
    s8 group = gSaveBlock1Ptr->location.mapGroup;
    s8 num = gSaveBlock1Ptr->location.mapNum;

    for (i = 0; i < WASM_ENCOUNTER_OVERRIDE_MAPS; i++)
    {
        const struct WasmEncounterOverride *entry = &gWasmEncounterOverrides[i];
        if (entry->count == 0 || entry->mapGroup != (u8)group || entry->mapNum != (u8)num)
            continue;
        if (entry->count > WASM_ENCOUNTER_OVERRIDE_SPECIES)
            return species;
        return entry->species[Random() % entry->count];
    }
    return species;
}

static u32 Scale(u32 value, u16 percent)
{
    return (u32)(((u64)value * percent) / 100);
}

u32 WasmApplyExpRule(u32 exp)
{
    // The battle controller carries EXP as a u16.
    exp = Scale(exp, gWasmRules.expPercent);
    if (exp > 0xFFFF)
        exp = 0xFFFF;
    return exp;
}

u32 WasmApplyMoneyRule(u32 money)
{
    return Scale(money, gWasmRules.moneyPercent);
}

// odds above 254 is a sure catch; lower odds decide the shakes.
u32 WasmApplyCatchRule(u32 odds)
{
    if (gWasmRules.catchPercent >= 10000)
        return 255;
    if (gWasmRules.catchPercent > 100 && odds == 0)
        odds = 1;
    odds = Scale(odds, gWasmRules.catchPercent);
    return odds > 255 ? 255 : odds;
}

u32 WasmApplyEncounterRule(u32 encounterRate)
{
    return Scale(encounterRate, gWasmRules.encounterPercent);
}

bool8 WasmRtcAvailable(void)
{
    return gWasmRules.hostSeconds != 0;
}

static u8 ToBcd(u32 value)
{
    return ((value / 10) << 4) | (value % 10);
}

static bool8 IsLeap(u32 year)
{
    return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
}

// Fills the date and time the way the cartridge's S-3511A clock reports
// them (BCD, 24-hour, year counted from 2000).
void WasmRtcFill(struct SiiRtcInfo *rtc)
{
    static const u8 sDaysInMonth[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    u32 seconds = gWasmRules.hostSeconds;
    u32 days = seconds / 86400;
    u32 secondOfDay = seconds % 86400;
    u32 year = 2000;
    u32 month = 0;

    rtc->dayOfWeek = (days + 6) % 7; // 2000-01-01 was a Saturday
    while (days >= (IsLeap(year) ? 366u : 365u))
    {
        days -= IsLeap(year) ? 366 : 365;
        year++;
    }
    while (1)
    {
        u32 length = sDaysInMonth[month] + (month == 1 && IsLeap(year));
        if (days < length)
            break;
        days -= length;
        month++;
    }
    if (year > 2099)
        year = 2099;

    rtc->year = ToBcd(year - 2000);
    rtc->month = ToBcd(month + 1);
    rtc->day = ToBcd(days + 1);
    rtc->hour = ToBcd(secondOfDay / 3600);
    rtc->minute = ToBcd((secondOfDay / 60) % 60);
    rtc->second = ToBcd(secondOfDay % 60);
    rtc->status = SIIRTCINFO_24HOUR;
}

// 0 = no tint, 1 = dawn, 2 = evening, 3 = night. Only on outdoor maps in
// the overworld, so menus, battles and buildings stay as they were.
u8 WasmDayNightPhase(void)
{
    u8 hour;

    if (!gWasmRules.dayNight || !WasmRtcAvailable())
        return 0;
    if (gMain.callback2 != CB2_Overworld || !IsMapTypeOutdoors(gMapHeader.mapType))
        return 0;

    RtcCalcLocalTime();
    hour = gLocalTime.hours;
    if (hour >= 20 || hour < 5)
        return 3;
    if (hour < 7)
        return 1;
    if (hour >= 18)
        return 2;
    return 0;
}

#endif // WASM
