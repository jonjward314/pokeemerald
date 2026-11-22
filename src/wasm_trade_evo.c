#if WASM
// Trade evolutions without a trading partner.
//
// Kadabra, Machoke, Graveler, Haunter, and Pokémon holding a trade item
// (Onix + Metal Coat, Seadra + Dragon Scale, ...) only evolve when traded.
// A family that plays alone can't do that, so the page's More menu lists the
// party Pokémon that would evolve if traded right now, and picking one plays
// the game's own evolution scene, exactly as if it had just been traded back.
//
// web/app.js calls these between frames. The evolution only starts from the
// overworld while the player is free to move, so it never interrupts a
// script, battle, menu or link.

#include "global.h"
#include "data.h"
#include "evolution_scene.h"
#include "string_util.h"
#include "event_object_movement.h"
#include "field_screen_effect.h"
#include "link.h"
#include "main.h"
#include "overworld.h"
#include "palette.h"
#include "pokemon.h"
#include "script.h"
#include "task.h"
#include "constants/characters.h"
#include "constants/items.h"
#include "constants/rgb.h"

extern const struct Evolution gEvolutionTable[][EVOS_PER_MON];

#define LABEL_MAX 48

void Task_WasmTradeEvolve(u8 taskId);

static u8 sLabel[LABEL_MAX + 1];

static bool32 IsFreeInOverworld(void)
{
    return gMain.callback2 == CB2_Overworld
        && gMain.callback1 == CB1_Overworld
        && !ArePlayerFieldControlsLocked()
        && !ScriptContext_IsEnabled()
        && !gPaletteFade.active
        && !gReceivedRemoteLinkPlayers
        && FuncIsActiveTask(Task_WasmTradeEvolve) == FALSE;
}

// The species this party Pokémon would become if traded now, or SPECIES_NONE.
// Unlike GetEvolutionTargetSpecies, this leaves its held item alone.
static u16 TradeEvoTarget(u32 slot)
{
    struct Pokemon *mon;
    u16 species, heldItem;
    int i;

    if (slot >= gPlayerPartyCount)
        return SPECIES_NONE;
    mon = &gPlayerParty[slot];
    if (GetMonData(mon, MON_DATA_IS_EGG, NULL))
        return SPECIES_NONE;
    species = GetMonData(mon, MON_DATA_SPECIES, NULL);
    heldItem = GetMonData(mon, MON_DATA_HELD_ITEM, NULL);
    for (i = 0; i < EVOS_PER_MON; i++)
    {
        switch (gEvolutionTable[species][i].method)
        {
        case EVO_TRADE:
            return gEvolutionTable[species][i].targetSpecies;
        case EVO_TRADE_ITEM:
            if (gEvolutionTable[species][i].param == heldItem)
                return gEvolutionTable[species][i].targetSpecies;
            break;
        }
    }
    return SPECIES_NONE;
}

static u8 *AppendText(u8 *dest, const u8 *src, u32 max)
{
    u32 i;

    for (i = 0; i < max && src[i] != EOS && dest < sLabel + LABEL_MAX; i++)
    {
        u8 c = src[i];

        if (c >= CHAR_A && c <= CHAR_Z)
            *dest++ = 'A' + c - CHAR_A;
        else if (c >= CHAR_a && c <= CHAR_z)
            *dest++ = 'a' + c - CHAR_a;
        else if (c >= CHAR_0 && c <= CHAR_9)
            *dest++ = '0' + c - CHAR_0;
        else if (c == CHAR_SPACE)
            *dest++ = ' ';
        else if (c == CHAR_HYPHEN)
            *dest++ = '-';
        else if (c == CHAR_PERIOD)
            *dest++ = '.';
    }
    return dest;
}

static u8 *AppendAscii(u8 *dest, const char *src)
{
    while (*src && dest < sLabel + LABEL_MAX)
        *dest++ = *src++;
    return dest;
}

// ---- Called by web/app.js -----------------------------------------------

u32 WasmTradeEvoTarget(u32 slot)
{
    return TradeEvoTarget(slot);
}

// "NICK (Kadabra) -> Alakazam" as plain ASCII, or "" if it can't evolve.
u8 *WasmTradeEvoLabel(u32 slot)
{
    u8 nickname[POKEMON_NAME_BUFFER_SIZE];
    u16 target = TradeEvoTarget(slot);
    u16 species;
    u8 *end = sLabel;

    if (target != SPECIES_NONE)
    {
        species = GetMonData(&gPlayerParty[slot], MON_DATA_SPECIES, NULL);
        GetMonData(&gPlayerParty[slot], MON_DATA_NICKNAME, nickname);
        end = AppendText(end, nickname, POKEMON_NAME_LENGTH);
        if (StringCompare(nickname, gSpeciesNames[species]) != 0)
        {
            end = AppendAscii(end, " (");
            end = AppendText(end, gSpeciesNames[species], POKEMON_NAME_LENGTH);
            end = AppendAscii(end, ")");
        }
        end = AppendAscii(end, " -> ");
        end = AppendText(end, gSpeciesNames[target], POKEMON_NAME_LENGTH);
    }
    *end = '\0';
    return sLabel;
}

u32 WasmTradeEvoCanStart(void)
{
    return IsFreeInOverworld();
}

#define tSlot data[0]
#define tTarget data[1]

void Task_WasmTradeEvolve(u8 taskId)
{
    struct Task *task = &gTasks[taskId];
    u8 slot = task->tSlot;
    u16 target;

    if (gPaletteFade.active)
        return;

    // Same as a real trade: this also uses up a trade item (Metal Coat, ...).
    target = GetEvolutionTargetSpecies(&gPlayerParty[slot], EVO_MODE_TRADE, ITEM_NONE);
    DestroyTask(taskId);
    CleanupOverworldWindowsAndTilemaps();
    // Back on the map: fade in, restart the map music, free the player.
    gFieldCallback = FieldCB_ReturnToFieldNoScriptCheckMusic;
    if (target == SPECIES_NONE)
    {
        SetMainCallback2(CB2_ReturnToField);
        return;
    }
    gCB2_AfterEvolution = CB2_ReturnToField;
    BeginEvolutionScene(&gPlayerParty[slot], target, FALSE, slot);
}

// 0 = started, 1 = not now (walk around freely first), 2 = can't evolve.
u32 WasmTradeEvolve(u32 slot)
{
    u8 taskId;

    if (TradeEvoTarget(slot) == SPECIES_NONE)
        return 2;
    if (!IsFreeInOverworld())
        return 1;
    LockPlayerFieldControls();
    FreezeObjectEvents();
    BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
    taskId = CreateTask(Task_WasmTradeEvolve, 10);
    gTasks[taskId].tSlot = slot;
    return 0;
}

#endif // WASM
