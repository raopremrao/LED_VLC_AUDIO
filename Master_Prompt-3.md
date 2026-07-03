# MASTER PROMPT – PART 3/3

# Engineering Standards, Deliverables, Testing & Generation Workflow

---

# SOFTWARE ENGINEERING PRINCIPLES

Write this project exactly like a professional software engineer working in an industrial R&D laboratory.

Every design decision must be technically justified.

Always optimize for

Reliability

Maintainability

Scalability

Readability

Modularity

Never optimize only for shorter code.

Never sacrifice architecture for fewer lines of code.

---

# CODING STANDARDS

Follow modern software engineering practices.

JavaScript

Use ES2023

Use modules

Use classes

Avoid global variables

Avoid duplicated code

Use async/await

Proper exception handling

Meaningful variable names

No anonymous magic functions

Arduino / ESP32

Use modern C++

Avoid Arduino String where unnecessary

Prefer fixed-size buffers

Avoid heap fragmentation

Prefer constexpr

Separate .cpp and .h files

Meaningful comments

Consistent formatting

---

# CODE ORGANIZATION

Every module must have a single responsibility.

Example:

BLEManager

Only BLE.

PacketBuilder

Only builds packets.

PacketParser

Only parses packets.

CRC16

Only CRC calculations.

Logger

Only logging.

Player

Only browser audio.

TransferManager

Coordinates transfer.

Never mix responsibilities.

---

# LOGGING

Implement a structured logging system.

Support log levels

INFO

WARNING

ERROR

DEBUG

Allow DEBUG logging to be disabled easily.

Browser logs and ESP32 logs should follow similar formatting.

Example

[INFO]

BLE Connected

[WARNING]

Packet Timeout

[ERROR]

CRC Failure Packet 154

---

# CONFIGURATION

Never hardcode important values.

Create configuration constants.

Example

BLE MTU

Packet Size

UART Baud

Window Size

Retry Count

Timeout

Buffer Size

CRC Polynomial

Transfer Timeout

Keep configuration centralized.

---

# FILE GENERATION ORDER

Generate files in the following order.

1.

README.md

2.

config.js

3.

crc16.js

4.

packet.js

5.

logger.js

6.

utils.js

7.

ble.js

8.

player.js

9.

audio-script.js

10.

audio.html

11.

PacketEncoder.h

12.

PacketEncoder.cpp

13.

PacketDecoder.h

14.

PacketDecoder.cpp

15.

CRC16.h

16.

CRC16.cpp

17.

QueueManager.h

18.

QueueManager.cpp

19.

OpticalTX.h

20.

OpticalTX.cpp

21.

OpticalRX.h

22.

OpticalRX.cpp

23.

TransferManager.h

24.

TransferManager.cpp

25.

VLC_TX.ino

26.

VLC_RX.ino

---

# GENERATION RULES

Before generating any code

Analyze entire project.

Explain architecture.

Explain packet protocol.

Explain FreeRTOS design.

Explain BLE design.

Explain browser architecture.

Wait for approval.

Only after approval begin code generation.

Generate ONE COMPLETE FILE at a time.

Never generate partial files.

Never skip files.

Never merge unrelated modules.

Every generated file must compile with previously generated files.

Never change the protocol after code generation begins.

Maintain complete compatibility.

---

# TESTING REQUIREMENTS

Create a testing plan.

Test

Small files

Large files

Empty files

Corrupted packets

BLE disconnect

UART disconnect

Power interruption

CRC failure

Packet loss

Duplicate packets

Out-of-order packets

Timeout

Noise

Recovery

Document expected behavior.

---

# PERFORMANCE METRICS

Measure

Transfer speed

BLE throughput

UART throughput

Packet loss

Retransmissions

CRC failures

Transfer time

Memory usage

CPU usage

Queue occupancy

Include statistics in browser UI.

---

# MEMORY REQUIREMENTS

Avoid memory leaks.

Avoid heap fragmentation.

Reuse buffers.

Use ring buffers.

Use queues.

Never allocate memory repeatedly during transfer.

Minimize copying.

Document memory usage.

---

# FUTURE EXPANSION

Design protocol so future features require minimal changes.

Possible future features

Image transfer

Video transfer

Text messages

Folder transfer

Resume interrupted transfer

Encryption

Compression

Authentication

OTA updates

Mesh networking

Do not hardcode anything that prevents future expansion.

---

# README REQUIREMENTS

README must include

Project Overview

Architecture Diagram

Communication Flow

Packet Format

BLE Services

UART Configuration

GPIO Connections

Libraries Required

Compilation Steps

Browser Requirements

Testing Procedure

Troubleshooting

Known Limitations

Future Improvements

Screenshots (placeholder)

License

Version History

---

# CODE QUALITY CHECKLIST

Before considering the project complete, verify:

✓ No compiler warnings

✓ No TODO comments

✓ No placeholder code

✓ No duplicated logic

✓ No blocking UART

✓ No blocking BLE

✓ Proper FreeRTOS task separation

✓ CRC implemented correctly

✓ Packet validation implemented

✓ Modular architecture

✓ Browser UI functional

✓ Audio playback functional

✓ Download functional

✓ Progress reporting functional

✓ Logging functional

✓ Memory optimized

✓ Documentation complete

---

# FINAL REQUIREMENT

This project should look like it was developed by an experienced embedded systems team.

The code should be suitable for:

University research

Engineering portfolio

Industrial demonstration

Hackathons

Open-source publication

GitHub showcase

Professional interviews

The final project should be clean, robust, extensible, and production-quality.

Do not compromise architecture for simplicity.

Always prefer engineering correctness over shorter code.

If the response length limit is reached, continue exactly where you stopped without rewriting previous content.

Do not change previously generated modules unless explicitly requested.

Continue until the entire project is complete.
