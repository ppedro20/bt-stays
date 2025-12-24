#include <WiFi.h>
#include <HTTPClient.h>
#include <Keypad.h>
#include <LiquidCrystal_I2C.h>
#include <SPI.h>
#include <MFRC522.h>

#if __has_include("wokwi_env.h")
#include "wokwi_env.h"
#endif

#ifndef WOKWI_SUPABASE_URL
#error "WOKWI_SUPABASE_URL not defined. Create wokwi_env.h from the example."
#endif
#ifndef WOKWI_DEVICE_SECRET
#error "WOKWI_DEVICE_SECRET not defined. Create wokwi_env.h from the example."
#endif

// Wokwi WiFi
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

// Supabase Edge Functions (device_consume_code / device_consume_rfid)
const char* SUPABASE_URL = WOKWI_SUPABASE_URL;
#ifdef WOKWI_SUPABASE_RFID_URL
const char* SUPABASE_RFID_URL = WOKWI_SUPABASE_RFID_URL;
#else
const char* SUPABASE_RFID_URL = WOKWI_SUPABASE_URL;
#endif
const char* DEVICE_SECRET = WOKWI_DEVICE_SECRET;

// Keypad wiring (matches diagram.json)
const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  { '1', '2', '3', 'A' },
  { '4', '5', '6', 'B' },
  { '7', '8', '9', 'C' },
  { '*', '0', '#', 'D' }
};
byte rowPins[ROWS] = { 13, 12, 14, 27 };
byte colPins[COLS] = { 26, 25, 33, 32 };
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// LCD 16x2 I2C (addr 0x27 is common in Wokwi)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// RC522 wiring (matches diagram.json)
constexpr uint8_t RFID_SS_PIN = 5;
constexpr uint8_t RFID_RST_PIN = 4;
MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

String codeBuffer;
const int CODE_LEN = 6;
unsigned long lastRfidReadMs = 0;

void lcdStatus(const String& line1, const String& line2 = "") {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1);
  if (line2.length() > 0) {
    lcd.setCursor(0, 1);
    lcd.print(line2);
  }
}

bool postCodeToSupabase(const String& code, String& responseOut, int& statusOut) {
  HTTPClient http;
  http.begin(SUPABASE_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-secret", DEVICE_SECRET);

  String payload = "{\"code\":\"" + code + "\"}";
  statusOut = http.POST(payload);
  responseOut = http.getString();
  http.end();
  return statusOut > 0;
}

bool postCardUidToSupabase(const String& cardUid, String& responseOut, int& statusOut) {
  HTTPClient http;
  http.begin(SUPABASE_RFID_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-secret", DEVICE_SECRET);

  String payload = "{\"card_uid\":\"" + cardUid + "\"}";
  statusOut = http.POST(payload);
  responseOut = http.getString();
  http.end();
  return statusOut > 0;
}

String uidToCode(const MFRC522::Uid& uid) {
  uint32_t value = 0;
  for (byte i = 0; i < uid.size; i++) {
    value = (value << 8) | uid.uidByte[i];
  }
  uint32_t code = value % 1000000;
  char buf[7];
  snprintf(buf, sizeof(buf), "%06lu", static_cast<unsigned long>(code));
  return String(buf);
}

String uidToHex(const MFRC522::Uid& uid) {
  String out;
  for (byte i = 0; i < uid.size; i++) {
    if (uid.uidByte[i] < 0x10) out += "0";
    out += String(uid.uidByte[i], HEX);
  }
  out.toUpperCase();
  return out;
}

String reasonToMessage(const String& reason) {
  if (reason == "ok") return "Acesso OK";
  if (reason == "expired") return "Expirado";
  if (reason == "revoked") return "Revogado";
  if (reason == "already_used") return "Ja usado";
  if (reason == "not_found") return "Nao existe";
  return "Negado";
}

void handleCardUidSubmit(const String& cardUid) {
  lcdStatus("A validar...");
  String response;
  int status = 0;
  bool ok = postCardUidToSupabase(cardUid, response, status);
  Serial.println(response);

  if (!ok || status != 200) {
    lcdStatus("Erro", "Tente de novo");
    return;
  }

  // Minimal response parsing to avoid heavy JSON libs.
  bool granted = response.indexOf("\"granted\":true") >= 0;
  String reason = "unknown";
  int reasonIdx = response.indexOf("\"reason\":\"");
  if (reasonIdx >= 0) {
    int start = reasonIdx + 10;
    int end = response.indexOf("\"", start);
    if (end > start) reason = response.substring(start, end);
  }

  if (granted) {
    lcdStatus("Acesso OK", "Abrindo...");
    delay(2000);
    lcdStatus("Digite codigo", "ou cartao");
  } else {
    lcdStatus("Acesso negado", reasonToMessage(reason));
    delay(2000);
    lcdStatus("Digite codigo", "ou cartao");
  }
}

void handleCodeSubmit(const String& code) {
  lcdStatus("A validar...");
  String response;
  int status = 0;
  bool ok = postCodeToSupabase(code, response, status);
  Serial.println(response);

  if (!ok || status != 200) {
    lcdStatus("Erro", "Tente de novo");
    return;
  }

  // Minimal response parsing to avoid heavy JSON libs.
  bool granted = response.indexOf("\"granted\":true") >= 0;
  String reason = "unknown";
  int reasonIdx = response.indexOf("\"reason\":\"");
  if (reasonIdx >= 0) {
    int start = reasonIdx + 10;
    int end = response.indexOf("\"", start);
    if (end > start) reason = response.substring(start, end);
  }

  if (granted) {
    lcdStatus("Acesso OK", "Abrindo...");
    delay(2000);
    lcdStatus("Digite codigo", "ou cartao");
  } else {
    lcdStatus("Acesso negado", reasonToMessage(reason));
    delay(2000);
    lcdStatus("Digite codigo", "ou cartao");
  }
}

void setup() {
  Serial.begin(115200);

  lcd.init();
  lcd.backlight();
  lcdStatus("A ligar WiFi");

  SPI.begin();
  rfid.PCD_Init();

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(200);
    if (millis() - start > 10000) break;
  }

  if (WiFi.status() == WL_CONNECTED) {
    lcdStatus("WiFi OK", "Codigo/cartao");
  } else {
    lcdStatus("WiFi falhou", "Tente de novo");
  }
}

void loop() {
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    unsigned long now = millis();
    if (now - lastRfidReadMs > 1500) {
      lastRfidReadMs = now;
      String uidHex = uidToHex(rfid.uid);
      Serial.print("RFID UID: ");
      Serial.println(uidHex);
      lcdStatus("Cartao lido", "A validar...");
      handleCardUidSubmit(uidHex);
    }
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    delay(50);
    return;
  }

  char key = keypad.getKey();
  if (!key) {
    delay(10);
    return;
  }

  if (key == '*') {
    codeBuffer = "";
    lcdStatus("Digite codigo", "ou cartao");
    return;
  }

  if (key == '#') {
    if (codeBuffer.length() != CODE_LEN) {
      lcdStatus("Codigo invalido", "6 digitos");
      codeBuffer = "";
      return;
    }

    handleCodeSubmit(codeBuffer);
    codeBuffer = "";
    return;
  }

  if (key >= '0' && key <= '9') {
    if (codeBuffer.length() < CODE_LEN) {
      codeBuffer += key;
      String masked(codeBuffer.length(), '*');
      lcdStatus("Codigo:", masked);
    }
  }
}
