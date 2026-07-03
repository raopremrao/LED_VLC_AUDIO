#include "OpticalRX.h"
#include "driver/uart.h"

OpticalRX::OpticalRX(int rxPin, uint32_t baudRate) {
    _rxPin = rxPin;
    _baudRate = baudRate;
    overflowCount = 0;
    framingErrors = 0;
}

void OpticalRX::begin() {
    // CRITICAL FIX: setRxBufferSize MUST be called BEFORE begin() on ESP32
    Serial1.setRxBufferSize(4096);
    // True for inverted logic
    Serial1.begin(_baudRate, SERIAL_8N1, _rxPin, -1, true);
    Serial.printf("[OpticalRX] UART1 started. Baud: %d, RX Pin: %d, Buffer: 4096, Inverted: true\n", _baudRate, _rxPin);
}

size_t OpticalRX::readData(uint8_t* buffer, size_t maxLen) {
    size_t len = 0;
    while (Serial1.available() && len < maxLen) {
        buffer[len++] = Serial1.read();
    }

    // Check for UART hardware errors
    uint32_t uartErrors = 0;
    uart_get_buffered_data_len(UART_NUM_1, &uartErrors);

    // Detect potential overflow: if hardware buffer is near capacity
    if (Serial1.available() > 3072) { // 75% of 4096
        overflowCount++;
        Serial.printf("[OpticalRX] WARNING: UART buffer near overflow! Available: %d, Overflow count: %d\n",
                       Serial1.available(), overflowCount);
    }

    return len;
}

int OpticalRX::available() {
    return Serial1.available();
}
