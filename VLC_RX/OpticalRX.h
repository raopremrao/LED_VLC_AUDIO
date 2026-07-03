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

private:
    int _rxPin;
    uint32_t _baudRate;
};

#endif
