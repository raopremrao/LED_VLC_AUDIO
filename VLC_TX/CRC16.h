#ifndef CRC16_H
#define CRC16_H

#include <Arduino.h>

class CRC16 {
public:
    // Calculates CRC16-CCITT (Poly: 0x1021, Init: 0xFFFF)
    static uint16_t calculate(const uint8_t* data, size_t length);
};

#endif
