# MASTER PROMPT – PART 2/3

# Communication Protocol, ESP32 Firmware Architecture & Browser Design

---

# DATA LINK PROTOCOL

Design a custom packet protocol that sits above UART.

The UART channel should only transport bytes.

Reliability must be achieved through software.

Every packet shall contain:

```
+------------+--------------+
| Field      | Size         |
+------------+--------------+
| SYNC1      | 1 byte       |
| SYNC2      | 1 byte       |
| VERSION    | 1 byte       |
| TYPE       | 1 byte       |
| FLAGS      | 1 byte       |
| SEQUENCE   | 2 bytes      |
| LENGTH     | 2 bytes      |
| PAYLOAD    | 0-240 bytes  |
| CRC16      | 2 bytes      |
+------------+--------------+
```

SYNC bytes must allow receiver resynchronization after corruption.

Protocol version allows future upgrades.

Maximum payload should be chosen to optimize BLE MTU and ESP32 memory.

---

# PACKET TYPES

Support at least:

```
FILE_START

DATA

FILE_END

HEARTBEAT

ACK

NAK

ERROR
```

Future packet types should be easy to add.

---

# FILE_START

Contains

Filename

Extension

MIME Type

File Size

Packet Count

Transfer ID

Timestamp

Optional Overall CRC32

---

# DATA PACKETS

Contain

Sequence Number

Payload

CRC16

Receiver shall validate every packet before accepting it.

---

# FILE_END

Contains

Final packet number

Overall checksum

Transfer completion flag

Receiver compares

Expected packet count

Expected file size

Expected checksum

Only then should reconstruction be considered successful.

---

# ACKNOWLEDGEMENT

If ACK mode is enabled

Receiver sends ACK containing

Sequence Number

Transfer ID

Sender transmits next packet only after ACK.

---

# FLOW CONTROL

Implement sliding window support.

Window size should be configurable.

Support

1 packet

4 packets

8 packets

16 packets

This allows future optimization.

---

# ERROR DETECTION

Detect

CRC failure

Packet length mismatch

Unknown packet

Missing packet

Duplicate packet

Unexpected sequence

Invalid header

Invalid sync

Unexpected FILE_END

Unexpected FILE_START

---

# ERROR RECOVERY

Recover from

BLE disconnect

Temporary UART noise

Lost packets

Out-of-order packets

Unexpected reboot

Receiver timeout

Sender timeout

Packet corruption

Receiver should gracefully abort incomplete transfers.

---

# CRC

Use CRC16-CCITT.

Do not invent a custom CRC.

Implement CRC as reusable module.

Avoid duplicate CRC code.

---

# BUFFERING STRATEGY

Use ring buffers everywhere.

Never allocate memory continuously.

Separate buffers for

BLE RX

BLE TX

UART RX

UART TX

Packet Queue

File Buffer

Console Logs

---

# ESP32 ARCHITECTURE

Implement using FreeRTOS.

Separate responsibilities.

Recommended tasks

BLE Receive Task

BLE Send Task

UART TX Task

UART RX Task

Packet Parser

Packet Builder

Transfer Manager

Watchdog Task

Logger Task

Every task should communicate through queues.

Never share mutable memory without synchronization.

---

# TASK PRIORITIES

Assign priorities logically.

UART tasks should have higher priority than UI logging.

Packet validation should never block UART.

BLE notifications should never block packet reception.

---

# UART

Use HardwareSerial.

Avoid SoftwareSerial.

Configure RX buffer properly.

Prevent overflow.

Support configurable baud rate.

Default

115200 baud

Future

230400

460800

921600

Code should allow changing baud without architecture changes.

---

# BLE

Use Nordic UART Service.

Negotiate maximum MTU.

Implement write queue.

Implement notify queue.

Support automatic reconnect.

Detect disconnect gracefully.

Recover automatically.

---

# BROWSER ARCHITECTURE

Use modern JavaScript.

Use ES6 modules.

Avoid global variables.

Organize into classes.

Example

BLEManager

PacketBuilder

PacketParser

TransferManager

Player

Logger

ProgressBar

CRC16

Utilities

---

# FILE RECONSTRUCTION

Browser should never assume packet order.

Use sequence numbers.

Store packets correctly.

Reassemble only after FILE_END validation.

Verify

Size

Checksum

Packet count

If validation fails

Reject file.

---

# USER INTERFACE

Modern responsive design.

Dark theme.

Large progress bar.

Transfer statistics.

Estimated remaining time.

Connection indicator.

Transfer speed.

Packet statistics.

Error count.

Retry count.

Current packet number.

Audio player.

Download button.

Reset transfer button.

Clear logs button.

---

# AUDIO PLAYER

Support

Play

Pause

Seek

Volume

Current time

Duration

Playback speed

Browser native player is acceptable.

Do not decode on ESP32.

---

# MEMORY MANAGEMENT

Avoid heap fragmentation.

Prefer static allocation.

Reuse buffers.

Minimize copies.

Avoid unnecessary String objects in Arduino.

Prefer std::array or fixed buffers where practical.

---

# PERFORMANCE TARGETS

No packet corruption.

Low RAM usage.

Stable BLE.

Stable UART.

Support multi-megabyte files.

Support interrupted transfers.

Support future resume functionality.

Optimize for robustness rather than maximum throughput.

Document every design decision with comments.

The firmware should resemble production-quality embedded software rather than demonstration code.
