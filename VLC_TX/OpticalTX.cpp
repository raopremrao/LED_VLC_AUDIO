#include "OpticalTX.h"

OpticalTX::OpticalTX(int txPin, uint32_t baudRate) {
    _txPin = txPin;
    _baudRate = baudRate;
}

void OpticalTX::begin() {
    // True for inverted logic (Laser OFF when idle)
    Serial1.begin(_baudRate, SERIAL_8N1, -1, _txPin, true);
}

void OpticalTX::writeData(const uint8_t* data, size_t length) {
    // Write blocks until the hardware buffer has space.
    // In FreeRTOS, this will yield if the TX buffer is full,
    // assuming HardwareSerial is implemented to yield.
    Serial1.write(data, length);
}
