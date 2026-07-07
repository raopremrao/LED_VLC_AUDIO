#ifndef PACKET_ENCODER_H
#define PACKET_ENCODER_H

#include <Arduino.h>

#define PACKET_SYNC1 0xAA
#define PACKET_SYNC2 0x55
#define PACKET_VERSION 0x01

#define MAX_PAYLOAD_SIZE 512
#define PACKET_HEADER_SIZE 9
#define PACKET_OVERHEAD 11 // Header + 2 byte CRC

class PacketEncoder {
public:
    static size_t encode(uint8_t type, uint16_t sequence, const uint8_t* payload, uint16_t payloadLen, uint8_t* outBuffer);
};

#endif
