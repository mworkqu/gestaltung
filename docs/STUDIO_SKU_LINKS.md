# Studio library part to store SKU links

Written 2026-10-11 from a read-only look at the published, unmerged store catalogue (1,323 products).
The links live in the code library (`lib/studio/library/parts/*.ts`, `storeSkus`), not in the database.
`studio_parts` currently has 0 rows, so no DB row overrides a code part and nothing carries `storeSkus`.
The Studio uses only the FIRST SKU for photo, price and stock; later SKUs are the other bought item of a combo part.
Prices are QAR. All chosen products are published, have a photo and (except where noted) show "in stock".

## Linked (34 of 40)

| Library part id | SKU | Store product | Price | Why |
|---|---|---|---|---|
| aa_holder_2 | VLT-39658425679974 | 2x AA Battery Holder - 3V Battery Case with Wire Leads | 5 | Exact: 2 x AA, 3 V, leads. |
| arduino_nano | VLT-39398727876710 | Arduino Nano Clone Development Board - Mini B USB | 25 | Nano (ATmega328P) clone; the shields and the 33 BLE are different. |
| arduino_uno | VLT-39705290276966 | Arduino UNO R3 Development Board - Voltaat Version | 45 | Exact: UNO R3 (not R4, not Q). |
| bh1750 | VLT-32268616302694 | BH1750 Digital Light Intensity Sensor Module - I2C, Lux Output | 13 | Exact. |
| boost_5v | VLT-32066279571558 | 1-5V to 5V DC-DC Boost Converter 1A USB Output Module | 15 | Fixed 5 V, 1 A step-up from a single cell. Input range 1-5 V vs 2.5-5.5 V in the library, and it has a USB output; same job. |
| buck_converter | VLT-12177679908966 | DC-DC Adjustable Buck Converter 3A 3.2-40V to 1.25-35V | 20 | Adjustable step-down with a trimmer. It is LM2596 based, so the board is larger than the MP1584 in the library. |
| button_6mm | VLT-12186719191142 | Push Button Switch 6mm - Momentary Tactile SPST (5 Pack) | 1 | 6 mm tactile. The 2-pin 6x6x5 pack was rejected (library part has 4 legs). |
| buzzer | VLT-39533592674406 | Active Buzzer - 5V | 2 | Active (self-oscillating) buzzer, 5 V. Passive ones rejected. |
| cell_18650 | VLT-31994281295974, VLT-39439341912166 | 18650 Li-ion 3.7V 3800mAh Flat Top, then 1x 18650 Battery Holder | 20 / 4 | The part is a cell plus its single holder. First SKU is the cell, second the holder. |
| dht22 | VLT-12177957683302 | DHT22 Digital Temperature and Humidity Sensor | 27 | Exact (DHT11 rejected). |
| ds18b20 | VLT-12686903771238, VLT-49966863778109 | DS18B20 Waterproof probe (stainless), then DS18B20 adapter with 4.7k | 13 / 4 | The part is the waterproof probe plus the adapter board. Plain DIP DS18B20 rejected. |
| esp32_devkit | VLT-39404697223270 | NodeMCU ESP32 Development Board - Wi-Fi & Bluetooth | 39 | ESP32 DevKit-class board. ESP32-CAM, S3 and bare WROOM modules rejected. |
| hcsr04 | VLT-12191967740006 | HC-SR04 Ultrasonic Distance Sensor Module | 17 | Exact. |
| lcd1602_i2c | VLT-12179048038502 | 2x16 LCD with I2C Module | 29 | 16x2 with I2C backpack, as in the library. |
| ldr_module | VLT-31509205942374 | Photoresistor Light Sensor Module - LM393, Analog Output | 7 | LM393 LDR module with AO + DO. Bare LDR pack rejected. |
| led_5mm | VLT-12363645747302 | Red 5mm LED - 5.0V 20mA (5 Pack) | 1 | The library LED is 5 mm red (accent #ff3b30). Other colours and 3 mm rejected. |
| level_shifter_4ch | VLT-12179093618790 | Logic Level Converter - Bi-Directional | 9 | BSS138-style bi-directional shifter. The name does not state the channel count (the board is 4-channel). |
| microsd_module | VLT-12186723942502 | MicroSD Card Module | 17 | Exact. The SD data-logger shield was rejected. |
| motor_driver | VLT-50432140345661 | DRV8833 Dual H-Bridge Motor Driver Module | 9 | Exact chip. |
| mpu6050 | VLT-12191956992102 | MPU-6050 6-Axis Gyro Accelerometer Module - I2C | 19 | Exact. |
| n20_motor | VLT-39837922558054 | 6V 300RPM DC Micro Metal Gearmotor - 3mm D Shaft | 17 | 6 V micro metal gearmotor with a 3 mm D shaft (the N20 form; the store also sells N20 wheels). NOTE: it has no delivery date today, so it shows "available on request". The 12 V variants were rejected (voltage). |
| oled_13_i2c | VLT-12192015777894 | White OLED Display module - 1.3" | 29 | 1.3" 128x64 I2C. |
| pico_w | VLT-49762818523453 | Raspberry Pi Pico Wireless Microcontroller Board - RP2040 | 17 | Pico W (RP2040 + Wi-Fi). The Pico 2 (RP2350) and the plain Pico were rejected. |
| pir_hcsr501 | VLT-12191844204646 | HC-SR501 PIR Motion Sensor | 17 | Exact (AM312 mini rejected). |
| pump_5v | VLT-39404718030950 | Mini Submersible Water Pump - 5V Brushless DC Micro Pump | 9 | Submersible, 2.5-6 V, about 120 L/h, as the library part. The USB pump (VLT-39404702892134, 14) is the alternative. |
| relay_module | VLT-12339538559078 | 1 Channel Relay Module | 13 | 1-channel 5 V-signal module (10 A, 250 VAC). Bare SRD relays and 2/4/8-channel boards rejected. |
| rotary_encoder | VLT-31976915828838 | Rotary Encoder Module - Incremental Rotation with Push Button | 7 | KY-040 type. |
| rtc_ds3231 | VLT-12191884935270 | Real Time Clock Memory Module - DS3231 | 14 | Exact. |
| sg90_servo | VLT-12186802913382 | SG90 Micro Servo Motor - 180 degrees | 20 | Exact (MG90S metal gear rejected). |
| slide_switch | VLT-32326837993574 | Mini Slide Switch - SPDT 3 Pin ON-ON (3 PCS) | 1 | Slide switch, SPDT. Rocker and DIP switches rejected. |
| soil_moisture_cap | VLT-39679645679718 | Capacitive Analog Soil Moisture Sensor - 3.3-5.5V | 16 | Capacitive, not the resistive module (VLT-12191954698342). |
| speaker_amp | VLT-32066932539494, VLT-31976493678694 | 3W PAM8403 Digital Amplifier Board, then 4R 3W Speaker | 2 / 8 | The part is a PAM8403 amplifier plus a speaker. First SKU is the amplifier board (photo and price show only the board). The speaker is a 4 ohm 3 W cone, not exactly 28 mm. |
| tp4056_usbc | VLT-30570301948006 | TP4056 Type-C Li-ion Battery Charging Module - 1A | 6 | Exact. The 2S BMS module was rejected. |
| usbc_breakout | VLT-39687267778662 | Female Type-C USB Breakout Board | 14 | Female USB-C receptacle on a small board with pads. The male breakout was rejected. |

## No match (6, storeSkus left empty)

| Library part id | Closest store candidates | Why rejected |
|---|---|---|
| esp32_c3_mini | VLT-48070957564221 Beetle ESP32-C6 Mini (29); VLT-49898164650301 ESP32-S3 DevKitC-1 (79) | No ESP32-C3 board in the catalogue. The C6 and S3 are different chips and different boards. |
| oled_096_i2c | VLT-45964890112317 White OLED 0.91" (23); VLT-12192015777894 White OLED 1.3" (29) | No 0.96" OLED. The 0.91" is a different (128x32) panel, the 1.3" is the other library part. |
| resistor_220 | DK-CF14JT330RCTND 330 ohm 1/4 W (pack of 10, 6); DK-CF14JT1K00CTND 1k (6); VLT-27946508288102 Resistors Kit, 24 values (29) | No 220 ohm resistor. The kit contains it, but it is a 480-piece kit and its price and photo would mislead. Add a 220 ohm listing, then link it. |
| usbc_power_5v | VLT-39687267778662 Female Type-C USB Breakout Board (14) | The listing does not say the board has 5.1 k CC resistors, so a charger giving 5 V is not guaranteed. Link it if the owner confirms the board has them. |
| ws2812_ring | VLT-39678091984998 Addressable LED Ring 35 WS2812B (29); VLT-39678092017766 Ring 45 (29) | Library part is a 12-LED, 37 mm ring. The store has only 35 and 45 LED rings (much larger). |
| lipo_1000 | VLT-51499718738237 Li-Po 3.7V 1100mAh JST-PH (25); VLT-51499702288701 1200mAh (25) | Library part is 1000 mAh, 603450 pouch (6 x 34 x 50 mm). The store lists other capacities with no pouch size, and none has a delivery date. A wrong capacity or size is worse than no link. |

## Review notes

- Weakest links, worth a glance: buck_converter (bigger LM2596 board), boost_5v (USB-output module), level_shifter_4ch (channel count not in the name), n20_motor (no delivery date), speaker_amp (photo is the amplifier only).
- Ranking: nothing in `in_own_stock` yet (0 rows, 0069 not used), so all links are Voltaat (VLT-) products, in stock where a date exists.
- To change a link without a deploy: Dashboard, Studio library, "link store SKUs". A DB row overrides the code part by id.

## Added 2026-10-13 (multi-actuator stage, Part C), read-only look at the live published catalogue

| Library part id | SKU | Store product | Price | Why |
|---|---|---|---|---|
| pca9685_servo | VLT-44494294942013 | PCA9685 16-Channel I2C PWM Servo Driver - 12-bit, 1.6kHz | 35 | Exact: 16-channel PCA9685 servo driver board. |
| psu_5v_5a | VLT-50223536570685 | Generic 5V 8A AC/DC Power Adapter EU Plug | 65 | 5 V wall adapter rated above 5 A (no exact 5 A listing). EU plug (Qatar uses UK type G, so a plug adapter may be needed); barrel size is not in the listing. The cheaper 5V 6A metal-case supply (VLT-32020985512038, 45) was rejected: it is a screw-terminal mains-input unit, not a wall adapter. |

No match (storeSkus left empty):

| Library part id | Closest store candidates | Why rejected |
|---|---|---|
| mg996r_servo | VLT-39353027264614 MG946R Metal Gear Servo (35); VLT-47079651246397 MG90S (25); VLT-27935828377702 DS3218 (75) | No MG996R in the catalogue. The MG946R is a different servo (different size and stall current); the MG90S is a micro servo. |
