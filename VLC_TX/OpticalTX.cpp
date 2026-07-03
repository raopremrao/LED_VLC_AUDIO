#include "OpticalTX.h"

OpticalTX::OpticalTX(int txPin, uint32_t baudRate) {
    _txPin = txPin;
    _baudRate = baudRate;
    totalBytesSent = 0;
    totalPacketsSent = 0;
}

void OpticalTX::begin() {
    // True for inverted logic (Laser OFF when idle)
    Serial1.begin(_baudRate, SERIAL_8N1, -1, _txPin, true);
    Serial.printf("[OpticalTX] UART1 started. Baud: %d, TX Pin: %d, Inverted: true\n", _baudRate, _txPin);
}

void OpticalTX::writeData(const uint8_t* data, size_t length) {
    Serial1.write(data, length);
    
    // Note: Serial1.flush() was removed here because on some ESP32 core versions,
    // calling flush() repeatedly can interfere with the inverted UART pin state 
    // or cause the hardware FIFO to abort transmission prematurely.

    totalBytesSent += length;
    totalPacketsSent++;
}
