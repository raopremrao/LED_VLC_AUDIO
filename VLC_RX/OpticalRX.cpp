#include "OpticalRX.h"

OpticalRX::OpticalRX(int rxPin, uint32_t baudRate) {
    _rxPin = rxPin;
    _baudRate = baudRate;
    overflowCount = 0;
    framingErrors = 0;
}

void OpticalRX::begin() {
    // CRITICAL FIX: setRxBufferSize MUST be called BEFORE begin() on ESP32.
    // Calling it after begin() recreates the UART driver on some core versions, 
    // which SILENTLY CLEARS the invert=true flag, breaking the optical logic completely!
    Serial1.setRxBufferSize(4096);
    
    // True for inverted logic (Crucial for photodiode: Darkness = LOW -> Idle)
    Serial1.begin(_baudRate, SERIAL_8N1, _rxPin, -1, true);
    
    Serial.printf("[OpticalRX] UART1 started. Baud: %d, RX Pin: %d, Buffer: 4096, Inverted: true\n", _baudRate, _rxPin);
}

size_t OpticalRX::readData(uint8_t* buffer, size_t maxLen) {
    size_t len = 0;
    while (Serial1.available() && len < maxLen) {
        buffer[len++] = Serial1.read();
    }

    // Detect potential overflow: if hardware buffer is near capacity (75% of 4096)
    int remaining = Serial1.available();
    if (remaining > 3072) {
        overflowCount++;
        Serial.printf("[OpticalRX] WARNING: UART buffer near overflow! Available: %d, Count: %d\n",
                       remaining, overflowCount);
    }

    return len;
}

int OpticalRX::available() {
    return Serial1.available();
}
