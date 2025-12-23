# Wokwi (ESP32 + keypad + LCD) integration

Guiao modular para integrar o projeto atual com um dispositivo simulado no Wokwi. Este guiao descreve apenas instrucoes (sem codigo).

## Cenario Wokwi

- A app-user emite um codigo no Supabase (fluxo de compra).
- O ESP32 (Wokwi) recebe o codigo via keypad e envia para a Edge Function `device_consume_code`.
- O Supabase valida o codigo e devolve o estado (`granted`/`reason`).
- O LCD mostra o resultado e, se valido, simula "abrir portao".
- Nao existe ligacao direta app-user -> Wokwi; a ponte e sempre o Supabase.

## Modulo 0 - Objetivo e fluxo

- Definir o fluxo: keypad recebe codigo, ESP32 valida via Supabase, LCD mostra estado; se valido, regista "abrir portao".
- Definir ambientes: Supabase cloud (recomendado) vs local (Wokwi nao acede local).

## Modulo 1 - Preparar Supabase

- Confirmar que as migrations estao aplicadas e as Edge Functions em prod/local estao a funcionar.
- Criar uma Edge Function especifica para dispositivo (sem JWT) que valida um segredo de device.
- Definir `DEVICE_SECRET` nas secrets do Supabase (nunca no repo).
- Deploy da function do device e confirmar que responde com HTTP 401 sem o header correto.
- Definir endpoint e metodo de chamada para o device (HTTP POST).

## Modulo 2 - Definir contrato do device

- Payload minimo: JSON com `code` (string, 6 digitos, sem espacos).
- Headers obrigatorios: `Content-Type: application/json` e `x-device-secret`.
- Resposta esperada (sucesso): `ok`, `granted`, `reason`, `valid_until`.
- Resposta esperada (erro): `error` com motivo (`unauthorized`, `missing_code`, `invalid_json`, `empty_result`, etc.).
- Timeouts: 5s de conexao, 10s total por request.
- Retries: 2 tentativas com backoff simples (ex.: 300ms, 900ms); nao repetir se `unauthorized`.

## Modulo 3 - Configurar Wokwi

- Criar projeto Wokwi com ESP32, keypad 4x4 e LCD I2C.
- Mapear pinos do keypad e LCD (documentar no guiao).
- Garantir que o LCD tem endereco I2C correto (verificar no Wokwi).

## Modulo 4 - UX no device

- Tela inicial "Introduza codigo".
- Mask/eco do input no LCD.
- Confirmacao com tecla dedicada (ex.: "#") e cancelamento ("*").
- Mensagens de erro claras (formato invalido, expirado, usado, revogado).

## Modulo 5 - Integracao com Supabase

- Testar chamada direta ao endpoint com `x-device-secret` usando um cliente HTTP (fora do Wokwi).
- No Wokwi, enviar o codigo quando confirmado (tecla de confirmacao).
- Se `granted: true`, mostrar "Acesso ok" e iniciar abertura (LED/tempo).
- Se `granted: false`, mostrar mensagem baseada em `reason` (ex.: `expired`, `revoked`, `already_used`, `not_found`).
- Em caso de sucesso, acionar "abertura" e registar o tempo de abertura localmente.

## Modulo 6 - Seguranca e limites

- Rotacionar `DEVICE_SECRET` periodicamente.
- Limitar tentativas por minuto no endpoint do device.
- Bloquear logs de codigo completo (mostrar so ultimos 2 digitos).

## Modulo 7 - Testes

- Testar codigo valido, expirado, ja usado, revogado e formato invalido.
- Testar falta de internet e timeouts.
- Validar que eventos ficam registrados no Supabase.

## Modulo 8 - Operacao e deploy

- Documentar a URL da function e o segredo.
- Guardar diagrama de fluxo e checklist de configuracao.
- Incluir instrucoes de como trocar o endpoint (dev/prod).

## Build do sketch (VS Code + PlatformIO)

Prereqs:
- VS Code
- Extensao PlatformIO IDE (VS Code)

Passos:
- Abrir o repo no VS Code.
- Instalar/abrir o PlatformIO IDE.
- Criar um novo projeto PlatformIO:
  - Board: "Espressif ESP32 Dev Module" (esp32dev)
  - Framework: Arduino
  - Location: `wokwi/` (usar como pasta do projeto)
- Garantir que o `platformio.ini` aponta para `src_dir = .` e usa `sketch.ino`.
- Compilar o projeto (PlatformIO: "Build").

Outputs esperados:
- `.pio/build/esp32dev/firmware.bin`
- `.pio/build/esp32dev/firmware.elf`

Validacao:
- Confirmar que existem os ficheiros em `.pio/build/esp32dev/`.
- Confirmar que o `wokwi.toml` (na pasta `wokwi/`) aponta para esses ficheiros.
