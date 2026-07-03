#ifndef OPTICAL_RX_H
#define OPTICAL_RX_H

#include <Arduino.h>

class OpticalRX {
public:
    OpticalRX(int rxPin, uint32_t baudRate);
    void begin();

    // Returns number of bytes read into buffer
    size_t readData(uint8_t* buffer, size_t maxLen);

    int available();

    // UART error statistics
    uint32_t overflowCount;
    uint32_t framingErrors;

private:
    int _rxPin;
    uint32_t _baudRate;
};

#endif
