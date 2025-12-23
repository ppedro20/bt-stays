# Wokwi runbook (passo a passo)

Guia pratico para correr o fluxo completo app-user -> Supabase -> Wokwi.

## 1) Supabase (cloud)

Objetivo: ter a function do device ativa e com segredo definido.

Passos:
- Definir a secret `DEVICE_SECRET` no projeto Supabase.
- Fazer deploy das Edge Functions (inclui `device_consume_code`).
- Confirmar o endpoint: `https://<project>.supabase.co/functions/v1/device_consume_code`.

## 2) App-user (browser)

Objetivo: gerar um codigo valido para testar.

Passos:
- Abrir a app-user.
- Fazer o fluxo de compra para gerar um codigo.
- Guardar o codigo de 6 digitos.

## 3) Wokwi (config local)

Objetivo: apontar o ESP32 para o Supabase sem expor secrets no repo.

Passos:
- Criar `wokwi/wokwi_env.h` a partir de `wokwi/wokwi_env.h.example`.
- Preencher `WOKWI_SUPABASE_URL` e `WOKWI_DEVICE_SECRET`.

## 4) Wokwi (build com PlatformIO no VS Code)

Objetivo: gerar os binarios que o Wokwi CLI usa.

Passos:
- Instalar a extensao "PlatformIO IDE" no VS Code.
- Abrir a pasta `wokwi/` no VS Code.
- Abrir o painel do PlatformIO e clicar em "Build" no ambiente `esp32dev`.
- Verificar a existencia dos ficheiros:
  - `wokwi/.pio/build/esp32dev/firmware.bin`
  - `wokwi/.pio/build/esp32dev/firmware.elf`

## 5) Wokwi (execucao)

Objetivo: correr a simulacao e validar o fluxo no LCD.

Passos:
- Usar o Wokwi CLI com o `wokwi/wokwi.toml`.
- Inserir o codigo no keypad e confirmar com `#`.
- Validar que o LCD mostra "Acesso OK" para codigos validos.

## 6) Diagnostico rapido

- Se o LCD mostrar erro, confirmar:
  - `WOKWI_SUPABASE_URL` correto.
  - `DEVICE_SECRET` igual ao das secrets do Supabase.
  - Function `device_consume_code` deployada.
