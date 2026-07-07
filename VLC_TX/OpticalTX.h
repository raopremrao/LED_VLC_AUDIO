#ifndef OPTICAL_TX_H
#define OPTICAL_TX_H

#include <Arduino.h>

class OpticalTX {
public:
    OpticalTX(int txPin, uint32_t baudRate);
    void begin();
    void updateBaudRate(uint32_t newBaud);
    void writeData(const uint8_t* data, size_t length);

    // Statistics
    uint32_t totalBytesSent;
    uint32_t totalPacketsSent;

private:
    int _txPin;
    uint32_t _baudRate;
};

#endif
