#include "PacketDecoder.h"
#include "CRC16.h"
#include <Arduino.h>

PacketDecoder::PacketDecoder() {
    _state = SYNC1;
    _bufferIndex = 0;
    _expectedLength = 0;
    _crcError = false;
    validPackets = 0;
    crcErrors = 0;
    invalidHeaders = 0;
    syncSearchBytes = 0;
}

bool PacketDecoder::processByte(uint8_t b, ParsedPacket* outPacket) {
    switch (_state) {
        case SYNC1:
            syncSearchBytes++;
            if (b == PACKET_SYNC1) {
                _buffer[0] = b;
                _bufferIndex = 1;
                _state = SYNC2;
            }
            break;

        case SYNC2:
            if (b == PACKET_SYNC2) {
                _buffer[1] = b;
                _bufferIndex = 2;
                _state = HEADER;
            } else if (b == PACKET_SYNC1) {
                // Keep buffer at 1, stay in SYNC2 (edge case of overlapping syncs)
            } else {
                _state = SYNC1;
            }
            break;

        case HEADER:
            _buffer[_bufferIndex++] = b;

            if (_bufferIndex == 9) { // Full header received
                if (_buffer[2] != PACKET_VERSION) {
                    invalidHeaders++;
                    Serial.printf("[PacketDecoder] Invalid version: 0x%02X (expected 0x%02X)\n", _buffer[2], PACKET_VERSION);
                    _state = SYNC1;
                    break;
                }

                _expectedLength = (_buffer[7] << 8) | _buffer[8];

                if (_expectedLength > MAX_PAYLOAD_SIZE) {
                    invalidHeaders++;
                    Serial.printf("[PacketDecoder] Invalid payload length: %d (max %d)\n", _expectedLength, MAX_PAYLOAD_SIZE);
                    _state = SYNC1;
                    break;
                }

                _state = PAYLOAD;
            }
            break;

        case PAYLOAD:
            _buffer[_bufferIndex++] = b;

            // Wait until we have Header(9) + Payload + CRC(2)
            if (_bufferIndex == 9 + _expectedLength + 2) {

                // Calculate CRC over Version(1) + Type(1) + Flags(1) + Seq(2) + Len(2) + Payload
                uint16_t calculatedCrc = CRC16::calculate(&_buffer[2], 7 + _expectedLength);

                uint16_t receivedCrc = (_buffer[_bufferIndex - 2] << 8) | _buffer[_bufferIndex - 1];

                if (calculatedCrc == receivedCrc) {
                    // Valid Packet!
                    validPackets++;
                    outPacket->version = _buffer[2];
                    outPacket->type = _buffer[3];
                    outPacket->flags = _buffer[4];
                    outPacket->sequence = (_buffer[5] << 8) | _buffer[6];
                    outPacket->length = _expectedLength;

                    if (_expectedLength > 0) {
                        memcpy(outPacket->payload, &_buffer[9], _expectedLength);
                    }

                    _state = SYNC1;
                    syncSearchBytes = 0; // Reset on successful decode
                    return true;
                } else {
                    crcErrors++;
                    Serial.printf("[PacketDecoder] CRC FAILED! Calc: %04X, Recv: %04X, Len: %d (Total CRC errors: %d)\n",
                                  calculatedCrc, receivedCrc, _expectedLength, crcErrors);
                    _crcError = true;
                }

                _state = SYNC1;
            }
            break;
    }

    return false;
}
