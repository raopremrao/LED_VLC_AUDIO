#ifndef PACKET_DECODER_H
#define PACKET_DECODER_H

#include <Arduino.h>

#define PACKET_SYNC1 0xAA
#define PACKET_SYNC2 0x55
#define PACKET_VERSION 0x01

#define MAX_PAYLOAD_SIZE 240
#define RX_BUFFER_SIZE (MAX_PAYLOAD_SIZE + 16)

typedef struct {
    uint8_t version;
    uint8_t type;
    uint8_t flags;
    uint16_t sequence;
    uint16_t length;
    uint8_t payload[MAX_PAYLOAD_SIZE];
} ParsedPacket;

class PacketDecoder {
public:
    PacketDecoder();
    
    // Feed one byte into the state machine. Returns true if a full valid packet was decoded.
    bool processByte(uint8_t b, ParsedPacket* outPacket);
    
    bool hasCrcError() const { return _crcError; }
    void clearCrcError() { _crcError = false; }

private:
    enum State { SYNC1, SYNC2, HEADER, PAYLOAD };
    State _state;
    
    uint8_t _buffer[RX_BUFFER_SIZE];
    uint16_t _bufferIndex;
    
    uint16_t _expectedLength;
    bool _crcError;
};

#endif
