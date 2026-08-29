# Chal Jhootha Contracts

This repository contains the wire contracts for the Chal Jhootha game protocol.

## Protocol Version: 1.0.0

### Server -> Client Events

#### room_state
```json
{
  "type": "room_state",
  "seq": 1,
  "players": [],
  "hostId": "p1",
  "phase": "lobby"
}
```

#### game_state
```json
{
  "type": "game_state",
  "seq": 2,
  "hands": {"p1": 5, "p2": 5},
  "stackCount": 0,
  "claimedRank": null,
  "currentTurnPlayerId": "p1",
  "roundOpenerId": "p1"
}
```

### Client -> Server Events

#### join_room
```json
{
  "type": "join_room",
  "clientMsgId": "msg123",
  "protocolVersion": "1.0.0",
  "roomCode": "ABCD",
  "playerName": "Guest123"
}
```

#### play_cards
```json
{
  "type": "play_cards",
  "clientMsgId": "msg123",
  "cardIds": ["As", "Ah"],
  "claimedRank": "A",
  "expectedSeq": 2
}
```
