#include "PacketDecoder.h"
#include "CRC16.h"

PacketDecoder::PacketDecoder() {
    _state = SYNC1;
    _bufferIndex = 0;
    _expectedLength = 0;
}

bool PacketDecoder::processByte(uint8_t b, ParsedPacket* outPacket) {
    switch (_state) {
        case SYNC1:
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
            
            if (_bufferIndex == 9) { // Full header received (SYNC(2) + VER(1) + TYPE(1) + FLAG(1) + SEQ(2) + LEN(2))
                if (_buffer[2] != PACKET_VERSION) {
                    _state = SYNC1; // Invalid version
                    break;
                }
                
                _expectedLength = (_buffer[7] << 8) | _buffer[8];
                
                if (_expectedLength > MAX_PAYLOAD_SIZE) {
                    _state = SYNC1; // Invalid length
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
                    outPacket->version = _buffer[2];
                    outPacket->type = _buffer[3];
                    outPacket->flags = _buffer[4];
                    outPacket->sequence = (_buffer[5] << 8) | _buffer[6];
                    outPacket->length = _expectedLength;
                    
                    if (_expectedLength > 0) {
                        memcpy(outPacket->payload, &_buffer[9], _expectedLength);
                    }
                    
                    _state = SYNC1;
                    return true;
                }
                
                _state = SYNC1; // CRC Failed
            }
            break;
    }
    
    return false;
}
