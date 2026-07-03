#include "OpticalRX.h"

OpticalRX::OpticalRX(int rxPin, uint32_t baudRate) {
    _rxPin = rxPin;
    _baudRate = baudRate;
}

void OpticalRX::begin() {
    // True for inverted logic
    Serial1.begin(_baudRate, SERIAL_8N1, _rxPin, -1, true);
    // Large hardware buffer to prevent overflow before task schedules
    Serial1.setRxBufferSize(4096); 
}

size_t OpticalRX::readData(uint8_t* buffer, size_t maxLen) {
    size_t len = 0;
    while (Serial1.available() && len < maxLen) {
        buffer[len++] = Serial1.read();
    }
    return len;
}

int OpticalRX::available() {
    return Serial1.available();
}
