#include "PacketEncoder.h"
#include "CRC16.h"

size_t PacketEncoder::encode(uint8_t type, uint16_t sequence, const uint8_t* payload, uint16_t payloadLen, uint8_t* outBuffer) {
    if (payloadLen > MAX_PAYLOAD_SIZE) return 0;

    outBuffer[0] = PACKET_SYNC1;
    outBuffer[1] = PACKET_SYNC2;
    outBuffer[2] = PACKET_VERSION;
    outBuffer[3] = type;
    outBuffer[4] = 0; // Flags

    // Big Endian Sequence
    outBuffer[5] = (sequence >> 8) & 0xFF;
    outBuffer[6] = sequence & 0xFF;

    // Big Endian Length
    outBuffer[7] = (payloadLen >> 8) & 0xFF;
    outBuffer[8] = payloadLen & 0xFF;

    // Payload
    if (payloadLen > 0 && payload != nullptr) {
        memcpy(&outBuffer[9], payload, payloadLen);
    }

    // CRC16 from Version (byte 2) to end of payload
    uint16_t crc = CRC16::calculate(&outBuffer[2], 7 + payloadLen);
    
    // Big Endian CRC
    size_t crcIndex = 9 + payloadLen;
    outBuffer[crcIndex] = (crc >> 8) & 0xFF;
    outBuffer[crcIndex + 1] = crc & 0xFF;

    return PACKET_OVERHEAD + payloadLen;
}
