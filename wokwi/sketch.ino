#include <WiFi.h>
#include <HTTPClient.h>
#include <Keypad.h>
#include <LiquidCrystal_I2C.h>

#if __has_include("wokwi_env.h")
#include "wokwi_env.h"
#endif

// Configure via build flags or a local header (wokwi_env.h).
#ifndef WOKWI_SUPABASE_URL
#define WOKWI_SUPABASE_URL "https://YOUR_PROJECT.supabase.co/functions/v1/device_consume_code"
#endif
#ifndef WOKWI_DEVICE_SECRET
#define WOKWI_DEVICE_SECRET "YOUR_DEVICE_SECRET"
#endif

// Wokwi WiFi
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

// Supabase Edge Function (device_consume_code)
const char* SUPABASE_URL = WOKWI_SUPABASE_URL;
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

String codeBuffer;
const int CODE_LEN = 6;

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

String reasonToMessage(const String& reason) {
  if (reason == "ok") return "Acesso OK";
  if (reason == "expired") return "Expirado";
  if (reason == "revoked") return "Revogado";
  if (reason == "already_used") return "Ja usado";
  if (reason == "not_found") return "Nao existe";
  return "Negado";
}

void setup() {
  Serial.begin(115200);

  lcd.init();
  lcd.backlight();
  lcdStatus("A ligar WiFi");

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(200);
    if (millis() - start > 10000) break;
  }

  if (WiFi.status() == WL_CONNECTED) {
    lcdStatus("WiFi OK", "Digite codigo");
  } else {
    lcdStatus("WiFi falhou", "Tente de novo");
  }
}

void loop() {
  char key = keypad.getKey();
  if (!key) {
    delay(10);
    return;
  }

  if (key == '*') {
    codeBuffer = "";
    lcdStatus("Cancelado", "Digite codigo");
    return;
  }

  if (key == '#') {
    if (codeBuffer.length() != CODE_LEN) {
      lcdStatus("Codigo invalido", "6 digitos");
      codeBuffer = "";
      return;
    }

    lcdStatus("A validar...");
    String response;
    int status = 0;
    bool ok = postCodeToSupabase(codeBuffer, response, status);
    Serial.println(response);

    if (!ok || status != 200) {
      lcdStatus("Erro", "Tente de novo");
      codeBuffer = "";
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
      lcdStatus("Digite codigo");
    } else {
      lcdStatus("Acesso negado", reasonToMessage(reason));
      delay(2000);
      lcdStatus("Digite codigo");
    }

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
