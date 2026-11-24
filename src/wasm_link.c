#if WASM
// Link cable over the internet.
//
// On a GBA the link cable swaps one 8-halfword command block between every
// connected player each frame. Each player's block goes into the same
// "round" (SIOMULTI0-3), and every Game Boy sees the same rounds in the same
// order, which is what keeps link battles and trades in step.
//
// The browser build has no serial port, so LinkVSync (link.c) hands off to
// WasmLinkVSync here. Instead of driving the serial hardware, it:
//   - moves one queued block per frame from gLink.sendQueue into an outbox
//     that web/link.js sends to the family link server, and
//   - moves rounds that the server put together (one block per player) into
//     gLink.recvQueue, just as the serial interrupt would have.
// The server is the "cable": it decides which blocks share a round and sends
// every round to every player, so all games still see identical rounds.
//
// Everything above this layer (handshake results, block transfers, battles,
// trades, records) is the original game code.

#include "global.h"
#include "link.h"

#define WASM_LINK_OUTBOX_MAX 64
#define WASM_LINK_PENDING_MAX 512
// After the server says a partner has gone, wait this many frames (once every
// round from them has been used) before calling it a link error. A partner
// that closed the link normally does so within a frame or two of this player.
#define WASM_LINK_LOST_GRACE_FRAMES 120

enum {
    WASM_LINK_CLOSED,
    WASM_LINK_HANDSHAKE,
    WASM_LINK_CONNECTED,
};

static u16 sOutbox[WASM_LINK_OUTBOX_MAX][CMD_LENGTH];
static u32 sOutboxCount;

static u16 sInbox[MAX_LINK_PLAYERS][CMD_LENGTH];
static u16 sPending[WASM_LINK_PENDING_MAX][MAX_LINK_PLAYERS][CMD_LENGTH];
static u32 sPendingPos;
static u32 sPendingCount;

static u8 sLobbyCount = 1;
static u8 sLobbyId;
static bool8 sStartRequested;
static bool8 sPeerLost;
static u16 sLostFrames;

static void SetSioTerminals(u8 id)
{
    u16 siocnt = REG_SIOCNT & ~(SIO_MULTI_SI | SIO_MULTI_SD | SIO_ID);
    siocnt |= SIO_MULTI_SD | ((id & 3) << 4);
    if (id != 0)
        siocnt |= SIO_MULTI_SI;
    REG_SIOCNT = siocnt;
}

static void ResetSession(void)
{
    sOutboxCount = 0;
    sPendingPos = 0;
    sPendingCount = 0;
    sStartRequested = FALSE;
    sPeerLost = FALSE;
    sLostFrames = 0;
}

// ---- Called by link.c --------------------------------------------------

static void HandshakeVSync(void)
{
    gLink.playerCount = sLobbyCount;
    gLink.localId = sLobbyId;
    SetSioTerminals(sLobbyId);

    // LinkMain1 sets this when the leader confirms "start the link".
    if (gLink.handshakeAsMaster)
    {
        gLink.handshakeAsMaster = FALSE;
        sStartRequested = TRUE;
    }
}

static void ConnectedVSync(void)
{
    u8 i, j;

    SetSioTerminals(gLink.localId);

    // Send at most one block per frame, like the cable does.
    if (gLink.sendQueue.count != 0 && sOutboxCount < WASM_LINK_OUTBOX_MAX)
    {
        for (j = 0; j < CMD_LENGTH; j++)
            sOutbox[sOutboxCount][j] = gLink.sendQueue.data[j][gLink.sendQueue.pos];
        sOutboxCount++;
        gLink.sendQueue.count--;
        if (++gLink.sendQueue.pos >= QUEUE_CAPACITY)
            gLink.sendQueue.pos = 0;
    }

    while (sPendingCount != 0 && gLink.recvQueue.count < QUEUE_CAPACITY)
    {
        u8 index = gLink.recvQueue.pos + gLink.recvQueue.count;
        if (index >= QUEUE_CAPACITY)
            index -= QUEUE_CAPACITY;
        for (i = 0; i < gLink.playerCount; i++)
        {
            for (j = 0; j < CMD_LENGTH; j++)
                gLink.recvQueue.data[i][j][index] = sPending[sPendingPos][i][j];
        }
        gLink.recvQueue.count++;
        sPendingCount--;
        if (++sPendingPos >= WASM_LINK_PENDING_MAX)
            sPendingPos = 0;
    }
    gLastRecvQueueCount = gLink.recvQueue.count;

    if (sPeerLost && sPendingCount == 0 && gLink.recvQueue.count == 0)
    {
        if (++sLostFrames > WASM_LINK_LOST_GRACE_FRAMES)
            gLink.lag = LAG_SLAVE; // shows the game's own link error screen
    }
}

void WasmLinkVSync(void)
{
    switch (gLink.state)
    {
    case LINK_STATE_HANDSHAKE:
        HandshakeVSync();
        break;
    case LINK_STATE_INIT_TIMER:
    case LINK_STATE_CONN_ESTABLISHED:
        ConnectedVSync();
        break;
    }
}

// ---- Called by web/link.js between frames ------------------------------

u32 WasmLinkState(void)
{
    if (gWirelessCommType != 0)
        return WASM_LINK_CLOSED;
    switch (gLink.state)
    {
    case LINK_STATE_HANDSHAKE:
        return WASM_LINK_HANDSHAKE;
    case LINK_STATE_INIT_TIMER:
    case LINK_STATE_CONN_ESTABLISHED:
        return WASM_LINK_CONNECTED;
    default:
        return WASM_LINK_CLOSED;
    }
}

void WasmLinkReset(void)
{
    ResetSession();
    sLobbyCount = 1;
    sLobbyId = 0;
}

// Who else has their link open on this cable, and this player's place on it.
void WasmLinkSetLobby(u32 count, u32 id)
{
    if (count < 1)
        count = 1;
    if (count > MAX_LINK_PLAYERS)
        count = MAX_LINK_PLAYERS;
    sLobbyCount = count;
    sLobbyId = id < count ? id : 0;
}

u32 WasmLinkTakeStartRequest(void)
{
    u32 requested = sStartRequested;
    sStartRequested = FALSE;
    return requested;
}

// The server has joined these players together; the handshake is done.
void WasmLinkStart(u32 count, u32 id)
{
    if (gLink.state != LINK_STATE_HANDSHAKE)
        return;
    WasmLinkSetLobby(count, id);
    ResetSession();
    gLink.playerCount = sLobbyCount;
    gLink.localId = sLobbyId;
    gLink.isMaster = sLobbyId == 0 ? LINK_MASTER : LINK_SLAVE;
    gLink.handshakeAsMaster = FALSE;
    gLink.link_field_F = 0;
    SetSioTerminals(sLobbyId);
    gLink.state = LINK_STATE_CONN_ESTABLISHED;
}

u16 *WasmLinkOutbox(void)
{
    return &sOutbox[0][0];
}

u32 WasmLinkOutboxCount(void)
{
    return sOutboxCount;
}

void WasmLinkOutboxClear(void)
{
    sOutboxCount = 0;
}

// web/link.js writes one round (MAX_LINK_PLAYERS x CMD_LENGTH halfwords)
// here, then calls WasmLinkPushRound.
u16 *WasmLinkInbox(void)
{
    return &sInbox[0][0];
}

u32 WasmLinkPushRound(void)
{
    u32 slot;
    u8 i, j;

    if (WasmLinkState() != WASM_LINK_CONNECTED || sPendingCount >= WASM_LINK_PENDING_MAX)
        return FALSE;
    slot = sPendingPos + sPendingCount;
    if (slot >= WASM_LINK_PENDING_MAX)
        slot -= WASM_LINK_PENDING_MAX;
    for (i = 0; i < MAX_LINK_PLAYERS; i++)
    {
        for (j = 0; j < CMD_LENGTH; j++)
            sPending[slot][i][j] = sInbox[i][j];
    }
    sPendingCount++;
    return TRUE;
}

void WasmLinkPeerLost(void)
{
    if (WasmLinkState() == WASM_LINK_CONNECTED)
        sPeerLost = TRUE;
}

#endif // WASM
